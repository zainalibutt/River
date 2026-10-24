import {
  DEFAULT_HAND_REALISATION,
  type HandRealisation,
  handFeatures,
  type Position,
  type PotType,
  parseRealisation,
} from './bot-preflop-solve-realisation.js'
export interface RealisationObservation {
  schema: 'river-realisation-observation-v1'
  handId: string
  postflopPolicyId: string
  opponentPolicyId: string
  equityTableHash: string
  nodeId: string
  handClass: string
  position: Position
  potType: PotType
  effectiveStackBb: number
  potBb: number
  ownPreflopContributionBb: number
  /** Optional explicit copy; v1 contract rows without it derive the same value. */
  spr?: number
  equityVsOpponentRange: number
  netFromHandStartBb: number
  weight: number
}
const POTS: PotType[] = ['limped', 'single-raised', 'three-bet-plus']
const POSITIONS: Position[] = ['ip', 'oop']
const FEATURES = ['pair', 'suited', 'connected', 'highCard'] as const
export const PARAMETER_NAMES = [
  ...POTS.flatMap((p) => POSITIONS.flatMap((s) => [`${p}.${s}.base`, `${p}.${s}.equitySlope`])),
  ...FEATURES,
]
const N = PARAMETER_NAMES.length
const zeros = () => Array<number>(N).fill(0)
const matrix = () => Array.from({ length: N }, zeros)
const dot = (a: number[], b: number[]) => a.reduce((s, v, j) => s + v * (b[j] ?? 0), 0)
function coefficients(c: HandRealisation): number[] {
  return [
    ...POTS.flatMap((p) => POSITIONS.flatMap((s) => [c.pots[p][s].base, c.pots[p][s].equitySlope])),
    ...FEATURES.map((f) => c.features[f]),
  ]
}
function configFrom(b: number[], prior: HandRealisation): HandRealisation {
  const c = structuredClone(prior)
  for (const [p, pot] of POTS.entries())
    for (const [s, pos] of POSITIONS.entries()) {
      const i = p * 4 + s * 2
      Object.assign(c.pots[pot][pos], { base: b[i], equitySlope: b[i + 1] })
    }
  FEATURES.forEach((f, i) => {
    Object.assign(c.features, { [f]: b[12 + i] })
  })
  parseRealisation(c)
  return c
}
function inverse(a: number[][]): number[][] | null {
  const m = a.map((row, i) => [...row, ...zeros().map((_, j) => Number(i === j))])
  for (let k = 0; k < N; k++) {
    let pivot = k
    for (let i = k + 1; i < N; i++)
      if (Math.abs(m[i]?.[k] ?? 0) > Math.abs(m[pivot]?.[k] ?? 0)) pivot = i
    ;[m[k], m[pivot]] = [m[pivot] as number[], m[k] as number[]]
    const row = m[k] as number[]
    const d = row[k] as number
    if (Math.abs(d) < 1e-10) return null
    for (let j = 0; j < 2 * N; j++) row[j] = (row[j] as number) / d
    for (let i = 0; i < N; i++) {
      if (i === k) continue
      const other = m[i] as number[]
      const scale = other[k] as number
      for (let j = 0; j < 2 * N; j++) other[j] = (other[j] as number) - scale * (row[j] as number)
    }
  }
  return m.map((row) => row.slice(N))
}
/** Fit the 16 amplitudes. Shape, saturation bounds and SPR half-life stay fixed. */
export function fitRealisation(
  observations: readonly RealisationObservation[],
  prior = DEFAULT_HAND_REALISATION,
) {
  parseRealisation(prior)
  if (observations.length === 0) throw new Error('no observations')
  const policies = new Set(
    observations.map((o) =>
      JSON.stringify([o.postflopPolicyId, o.opponentPolicyId, o.equityTableHash]),
    ),
  )
  if (policies.size !== 1) throw new Error('cannot pool different policies/equity estimators')
  const seen = new Set<string>()
  const rows = observations.map((o) => {
    if (
      o.schema !== 'river-realisation-observation-v1' ||
      !o.handId ||
      !o.nodeId ||
      !o.postflopPolicyId ||
      !o.opponentPolicyId ||
      !o.equityTableHash ||
      !POTS.includes(o.potType) ||
      !POSITIONS.includes(o.position) ||
      ![
        o.weight,
        o.effectiveStackBb,
        o.potBb,
        o.ownPreflopContributionBb,
        o.equityVsOpponentRange,
        o.netFromHandStartBb,
      ].every(Number.isFinite) ||
      o.weight <= 0 ||
      o.potBb <= 0 ||
      o.equityVsOpponentRange < 0 ||
      o.equityVsOpponentRange > 1 ||
      o.ownPreflopContributionBb < 0 ||
      o.ownPreflopContributionBb > o.effectiveStackBb ||
      Math.abs(o.potBb - 2 * o.ownPreflopContributionBb) > 1e-8
    )
      throw new Error('invalid observation (matched HU flop contributions required)')
    const key = `${o.handId}:${o.position}`
    if (seen.has(key)) throw new Error(`duplicate observation ${key}`)
    seen.add(key)
    const e = o.equityVsOpponentRange
    const spr = (o.effectiveStackBb - o.ownPreflopContributionBb) / o.potBb
    if (o.spr !== undefined && (!Number.isFinite(o.spr) || Math.abs(o.spr - spr) > 1e-8))
      throw new Error('observation SPR disagrees with chip origin')
    const p = spr / (spr + prior.sprHalfLife)
    const q =
      Math.min(
        1,
        Math.max(0, (e - prior.equity.floor) / (prior.equity.ceiling - prior.equity.floor)),
      ) ** prior.equity.power
    const f = handFeatures(o.handClass, prior)
    const x = zeros()
    const i = POTS.indexOf(o.potType) * 4 + POSITIONS.indexOf(o.position) * 2
    x[i] = e * p
    x[i + 1] = e * p * q
    FEATURES.forEach((name, j) => {
      x[12 + j] = e * p * f[name]
    })
    return {
      o,
      x,
      offset: e * (1 - p),
      lo: e * prior.bounds.min,
      hi: e * prior.bounds.max,
      y: (o.netFromHandStartBb + o.ownPreflopContributionBb) / o.potBb,
    }
  })
  const predict = (r: (typeof rows)[number], b: number[]) =>
    Math.max(r.lo, Math.min(r.hi, r.offset + dot(r.x, b)))
  const loss = (b: number[]) =>
    rows.reduce((s, r) => s + r.o.weight * (r.y - predict(r, b)) ** 2, 0)
  const limits = (j: number, b: number[]) => {
    let lo = 0
    let hi = j < 12 ? 3 : 1
    if (j < 12) {
      const i = Math.floor(j / 4) * 4
      const [ib, is, ob, os] = b.slice(i, i + 4) as [number, number, number, number]
      if (j === i) lo = Math.max(lo, ob, ob + os - is)
      if (j === i + 1) lo = Math.max(lo, ob + os - ib)
      if (j === i + 2) hi = Math.min(hi, ib, ib + is - os)
      if (j === i + 3) hi = Math.min(hi, ib + is - ob)
    }
    return [lo, hi] as const
  }
  let b = coefficients(prior)
  let converged = false
  let iterations = 0
  for (; iterations < 80; iterations++) {
    const h = matrix(),
      g = zeros()
    for (const r of rows) {
      const raw = r.offset + dot(r.x, b)
      if (raw <= r.lo || raw >= r.hi) continue
      const target = r.y - r.offset
      for (let i = 0; i < N; i++) {
        g[i] = (g[i] as number) + r.o.weight * (r.x[i] as number) * target
        for (let j = 0; j < N; j++)
          required(h[i])[j] =
            required(required(h[i])[j]) + r.o.weight * required(r.x[i]) * required(r.x[j])
      }
    }
    const candidate = [...b]
    for (let sweep = 0; sweep < 4000; sweep++) {
      let change = 0
      for (let j = 0; j < N; j++) {
        const d = required(required(h[j])[j])
        if (d < 1e-12) continue
        const [lo, hi] = limits(j, candidate)
        const next = Math.max(
          lo,
          Math.min(
            hi,
            required(candidate[j]) + (required(g[j]) - dot(required(h[j]), candidate)) / d,
          ),
        )
        change = Math.max(change, Math.abs(next - required(candidate[j])))
        candidate[j] = next
      }
      if (change < 1e-10) break
    }
    const before = loss(b)
    let step = 1
    let next = candidate
    while (loss(next) > before + 1e-12 && step > 1e-8) {
      step /= 2
      next = b.map((v, j) => v + step * (required(candidate[j]) - v))
    }
    const change = Math.max(...next.map((v, j) => Math.abs(v - required(b[j]))))
    b = next
    if (change < 1e-8) {
      converged = true
      break
    }
  }
  const bread = matrix(),
    meat = matrix()
  const clusters = new Map<string, number[]>()
  const hands = new Set(rows.map((r) => r.o.handId)).size
  for (const r of rows) {
    const raw = r.offset + dot(r.x, b)
    if (raw <= r.lo || raw >= r.hi) continue
    const score = clusters.get(r.o.handId) ?? zeros()
    for (let i = 0; i < N; i++) {
      score[i] = required(score[i]) + r.o.weight * required(r.x[i]) * (r.y - predict(r, b))
      for (let j = 0; j < N; j++)
        required(bread[i])[j] =
          required(required(bread[i])[j]) + r.o.weight * required(r.x[i]) * required(r.x[j])
    }
    clusters.set(r.o.handId, score)
  }
  for (const score of clusters.values())
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++)
        required(meat[i])[j] =
          required(required(meat[i])[j]) + required(score[i]) * required(score[j])
  const inv = inverse(bread)
  const parameters = PARAMETER_NAMES.map((name, i) => {
    const [lo, hi] = limits(i, b)
    const atBound = required(b[i]) - lo < 1e-6 || hi - required(b[i]) < 1e-6
    let variance = 0
    if (inv)
      for (let j = 0; j < N; j++)
        for (let k = 0; k < N; k++)
          variance +=
            required(required(inv[i])[j]) *
            required(required(meat[j])[k]) *
            required(required(inv[i])[k])
    const se =
      inv && hands > N && !atBound ? Math.sqrt((Math.max(0, variance) * hands) / (hands - 1)) : null
    return {
      name,
      prior: coefficients(prior)[i],
      fitted: b[i],
      standardError: se,
      atBound,
      projectedFlopHandsForSE003: se === null ? null : Math.ceil(hands * (se / 0.03) ** 2),
    }
  })
  return {
    config: configFrom(b, prior),
    parameters,
    observations: rows.length,
    hands,
    converged,
    iterations: Math.min(iterations + 1, 80),
    weightedSSE: loss(b),
    identifiable: inv !== null,
    uncertainty:
      'hand-cluster sandwich; null for rank deficiency, small samples or active constraints; use independent held-out runs',
  }
}

function required<T>(value: T): NonNullable<T> {
  if (value === null || value === undefined) throw new Error('missing required calibration value')
  return value
}

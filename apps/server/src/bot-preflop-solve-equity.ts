import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const RANKS = 'AKQJT98765432'
export const EQUITY_VERSION = 'hu-preflop-equity-v1'
export type Hole = readonly [number, number]
export interface HandClass {
  readonly name: string
  /** Engine card keys: suit * 13 + rank (2=0 ... A=12). */
  readonly combos: readonly Hole[]
}
export const HAND_CLASSES: readonly HandClass[] = Array.from({ length: 169 }, (_, index) => {
  const row = Math.floor(index / 13)
  const col = index % 13
  const hi = 12 - Math.min(row, col)
  const lo = 12 - Math.max(row, col)
  const suited = row < col
  const combos: Hole[] = []
  for (let s = 0; s < 4; s += 1) {
    for (let t = 0; t < 4; t += 1) {
      if (hi === lo ? s < t : suited ? s === t : s !== t) combos.push([s * 13 + hi, t * 13 + lo])
    }
  }
  return {
    name: `${RANKS[Math.min(row, col)]}${RANKS[Math.max(row, col)]}${row === col ? '' : suited ? 's' : 'o'}`,
    combos,
  }
})
export function compatible(a: Hole, b: Hole): boolean {
  return a[0] !== b[0] && a[0] !== b[1] && a[1] !== b[0] && a[1] !== b[1]
}
/** Exact number of ordered physical deals, with no independent-class approximation. */
export function classDealCounts(classes: readonly HandClass[]): number[] {
  return classes.flatMap((a) =>
    classes.map((b) => {
      let count = 0
      for (const first of a.combos)
        for (const second of b.combos) if (compatible(first, second)) count += 1
      return count
    }),
  )
}
// Canonicalise ONLY global suit permutations and within-hole card order. Seats stay ordered.
export function matchupKey(a: Hole, b: Hole): number {
  let best = Number.POSITIVE_INFINITY
  for (let flip = 0; flip < 4; flip += 1) {
    const cards = [
      a[flip & 1] as number,
      a[1 - (flip & 1)] as number,
      b[(flip >> 1) & 1] as number,
      b[1 - ((flip >> 1) & 1)] as number,
    ]
    const suits = [-1, -1, -1, -1]
    let next = 0
    let key = 0
    for (const card of cards) {
      const suit = Math.floor(card / 13)
      if (suits[suit] === -1) suits[suit] = next++
      key = key * 64 + (card % 13) * 4 + (suits[suit] as number)
    }
    best = Math.min(best, key)
  }
  return best
}
const high = new Int32Array(8192)
const topFive = new Int32Array(8192)
const straight = new Int32Array(8192)
const bitCount = new Int32Array(8192)
for (let mask = 1; mask < 8192; mask += 1) {
  let packed = 0
  let taken = 0
  for (let rank = 12; rank >= 0; rank -= 1) {
    if (mask & (1 << rank)) {
      if (taken === 0) high[mask] = rank + 2
      if (taken < 5) packed = packed * 16 + rank + 2
      taken += 1
    }
  }
  bitCount[mask] = taken
  topFive[mask] = packed * 16 ** Math.max(0, 5 - taken)
  for (let rank = 12; rank >= 4; rank -= 1) {
    if ((mask & (31 << (rank - 4))) === 31 << (rank - 4)) {
      straight[mask] = rank + 2
      break
    }
  }
  if (straight[mask] === 0 && (mask & 4111) === 4111) straight[mask] = 5
}
/** Allocation-free seven-card evaluator, parity-tested against the engine's evaluator. */
export function scoreSeven(cards: Int32Array): number {
  let mask = 0
  let pairs = 0
  let trips = 0
  let quads = 0
  let s0 = 0
  let s1 = 0
  let s2 = 0
  let s3 = 0
  for (let i = 0; i < 7; i += 1) {
    const card = cards[i] as number
    const bit = 1 << (card % 13)
    quads |= trips & bit
    trips |= pairs & bit
    pairs |= mask & bit
    mask |= bit
    const suit = Math.floor(card / 13)
    if (suit === 0) s0 |= bit
    else if (suit === 1) s1 |= bit
    else if (suit === 2) s2 |= bit
    else s3 |= bit
  }
  const flush =
    (bitCount[s0] as number) >= 5
      ? s0
      : (bitCount[s1] as number) >= 5
        ? s1
        : (bitCount[s2] as number) >= 5
          ? s2
          : (bitCount[s3] as number) >= 5
            ? s3
            : 0
  const unit = 16 ** 5
  if (flush && straight[flush]) return 8 * unit + (straight[flush] as number) * 65536
  if (quads)
    return 7 * unit + (high[quads] as number) * 65536 + (high[mask & ~quads] as number) * 4096
  if (trips && pairs & ~(1 << ((high[trips] as number) - 2))) {
    const trip = high[trips] as number
    return 6 * unit + trip * 65536 + (high[pairs & ~(1 << (trip - 2))] as number) * 4096
  }
  if (flush) return 5 * unit + (topFive[flush] as number)
  if (straight[mask]) return 4 * unit + (straight[mask] as number) * 65536
  if (trips) {
    const trip = high[trips] as number
    const rest = mask & ~(1 << (trip - 2))
    const kicker = high[rest] as number
    return (
      3 * unit + trip * 65536 + kicker * 4096 + (high[rest & ~(1 << (kicker - 2))] as number) * 256
    )
  }
  if (pairs) {
    const pair = high[pairs] as number
    const second = high[pairs & ~(1 << (pair - 2))] as number
    if (second)
      return (
        2 * unit +
        pair * 65536 +
        second * 4096 +
        (high[mask & ~(1 << (pair - 2)) & ~(1 << (second - 2))] as number) * 256
      )
    const rest = mask & ~pairs
    // topFive holds five nibbles, of which only the first three are needed.
    return unit + pair * 65536 + Math.floor((topFive[rest] as number) / 256) * 16
  }
  return topFive[mask] as number
}
function randomSource(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}
export function sampleEquity(
  a: Hole,
  b: Hole,
  samples: number,
  seed: number,
): {
  equity: number
  variance: number
} {
  if (!compatible(a, b)) throw new Error('blocked matchup')
  if (!Number.isInteger(samples) || samples < 2) throw new Error('at least two samples required')
  const deck = Int32Array.from(
    Array.from({ length: 52 }, (_, i) => i).filter((c) => !a.includes(c) && !b.includes(c)),
  )
  const first = new Int32Array([a[0], a[1], 0, 0, 0, 0, 0])
  const second = new Int32Array([b[0], b[1], 0, 0, 0, 0, 0])
  const picked = new Int32Array(5)
  const random = randomSource(seed)
  let sum = 0
  let squareSum = 0
  for (let n = 0; n < samples; n += 1) {
    for (let k = 0; k < 5; k += 1) {
      const j = k + Math.floor(random() * (48 - k))
      picked[k] = j
      const card = deck[j] as number
      deck[j] = deck[k] as number
      deck[k] = card
      first[k + 2] = card
      second[k + 2] = card
    }
    const one = scoreSeven(first)
    const two = scoreSeven(second)
    const won = one > two ? 1 : one === two ? 0.5 : 0
    sum += won
    squareSum += won * won
    for (let k = 4; k >= 0; k -= 1) {
      const j = picked[k] as number
      const saved = deck[k] as number
      deck[k] = deck[j] as number
      deck[j] = saved
    }
  }
  return { equity: sum / samples, variance: (squareSum - (sum * sum) / samples) / (samples - 1) }
}
export interface EquityTable {
  readonly version: string
  readonly classes: readonly string[]
  readonly multiplicities: readonly number[]
  readonly deals: readonly number[]
  /** Row-major conditional equity, uniformly averaged over ALL legal suit matchups. */
  readonly equity: readonly number[]
  readonly seed: number
  readonly samplesPerOrbit: number
  readonly orbits: number
  readonly error: {
    readonly maxCellStandardError: number
    readonly maxCell95Radius: number
    readonly simultaneous95HoeffdingRadius: number
    readonly meaning: string
  }
  readonly generationSeconds: number
  readonly hash: string
}
export function equityHash(table: Omit<EquityTable, 'hash' | 'generationSeconds'>): string {
  return createHash('sha256').update(JSON.stringify(table)).digest('hex')
}
export function validateEquityTable(table: EquityTable): void {
  const { hash, generationSeconds: _seconds, ...payload } = table
  if (table.version !== EQUITY_VERSION || equityHash(payload) !== hash)
    throw new Error('equity cache version/hash mismatch')
  if (
    table.classes.join() !== HAND_CLASSES.map((h) => h.name).join() ||
    table.deals.length !== 169 * 169 ||
    table.equity.length !== 169 * 169
  )
    throw new Error('equity cache dimensions/order mismatch')
  for (let a = 0; a < 169; a += 1) {
    if (table.multiplicities[a] !== (HAND_CLASSES[a] as HandClass).combos.length)
      throw new Error('invalid multiplicity')
    for (let b = 0; b < 169; b += 1) {
      const e = table.equity[a * 169 + b] as number
      if (
        !Number.isFinite(e) ||
        e < 0 ||
        e > 1 ||
        Math.abs(e + (table.equity[b * 169 + a] as number) - 1) > 1e-12
      )
        throw new Error('invalid equity/complement')
      if (table.deals[a * 169 + b] !== table.deals[b * 169 + a])
        throw new Error('asymmetric deal counts')
    }
  }
  if (table.deals.reduce((a, b) => a + b, 0) !== 1326 * 1225) throw new Error('deal mass mismatch')
}
/** Ignored cache is explicit and deterministic. A mismatched cache is rejected, never silently reused. */
export function loadOrGenerateEquity(
  path: string,
  samples = 8192,
  seed = 0x51a7c0de,
  maxSeconds = 480,
): EquityTable {
  if (existsSync(path)) {
    const table = JSON.parse(readFileSync(path, 'utf8')) as EquityTable
    validateEquityTable(table)
    if (table.seed !== seed || table.samplesPerOrbit !== samples)
      throw new Error('equity cache seed/sample mismatch; choose another cache path')
    return table
  }
  const started = performance.now()
  const deals = classDealCounts(HAND_CLASSES)
  const equity = new Array<number>(169 * 169).fill(0.5)
  let orbits = 0
  let maxVariance = 0
  let maxWeightSquare = 0
  for (let a = 0; a < 169; a += 1) {
    const first = (HAND_CLASSES[a] as HandClass).combos[0] as Hole
    for (let b = a + 1; b < 169; b += 1) {
      const groups = new Map<
        number,
        {
          hole: Hole
          weight: number
        }
      >()
      let count = 0
      for (const second of (HAND_CLASSES[b] as HandClass).combos) {
        if (!compatible(first, second)) continue
        const key = matchupKey(first, second)
        const group = groups.get(key)
        if (group) group.weight += 1
        else groups.set(key, { hole: second, weight: 1 })
        count += 1
      }
      let mean = 0
      let variance = 0
      let weightsSquared = 0
      for (const [key, group] of groups) {
        const estimate = sampleEquity(first, group.hole, samples, seed ^ key)
        const weight = group.weight / count
        mean += weight * estimate.equity
        variance += (weight * weight * estimate.variance) / samples
        weightsSquared += weight * weight
        orbits += 1
      }
      equity[a * 169 + b] = mean
      equity[b * 169 + a] = 1 - mean
      maxVariance = Math.max(maxVariance, variance)
      maxWeightSquare = Math.max(maxWeightSquare, weightsSquared)
      if ((performance.now() - started) / 1000 > maxSeconds)
        throw new Error('equity generation time budget reached; no partial cache written')
    }
    if (a % 13 === 0)
      process.stdout.write(
        `equity row ${a}/169, ${((performance.now() - started) / 1000).toFixed(1)}s\n`,
      )
  }
  const payload = {
    version: EQUITY_VERSION,
    classes: HAND_CLASSES.map((h) => h.name),
    multiplicities: HAND_CLASSES.map((h) => h.combos.length),
    deals,
    equity,
    seed,
    samplesPerOrbit: samples,
    orbits,
    error: {
      maxCellStandardError: Math.sqrt(maxVariance),
      maxCell95Radius: 1.96 * Math.sqrt(maxVariance),
      simultaneous95HoeffdingRadius: Math.sqrt(
        (Math.log((2 * 14196) / 0.05) * maxWeightSquare) / (2 * samples),
      ),
      meaning:
        'Monte Carlo board error only; per-cell 95% is normal-approximate; simultaneous bound uses Hoeffding and a union bound. Diagonal equity is exactly 0.5 by seat symmetry. Does not bound continuation-model error.',
    },
  }
  const table: EquityTable = {
    ...payload,
    generationSeconds: (performance.now() - started) / 1000,
    hash: equityHash(payload),
  }
  validateEquityTable(table)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(table)}\n`)
  return table
}

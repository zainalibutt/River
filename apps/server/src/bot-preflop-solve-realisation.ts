/** Parameters are priors, not fitted HU postflop measurements. See preflop/v2/README.md. */
export type Position = 'ip' | 'oop'
export type PotType = 'limped' | 'single-raised' | 'three-bet-plus'
export interface FlatRealisation {
  readonly ip: number
  readonly oop: number
}
export interface HandRealisation {
  readonly model: 'hand-equity-v2'
  readonly bounds: { readonly min: number; readonly max: number }
  readonly equity: { readonly floor: number; readonly ceiling: number; readonly power: number }
  readonly sprHalfLife: number
  readonly features: {
    readonly pair: number
    readonly suited: number
    readonly connected: number
    readonly highCard: number
    readonly connectivitySpan: number
    readonly wheelConnectivity: number
  }
  readonly pots: Readonly<
    Record<
      PotType,
      Readonly<
        Record<
          Position,
          {
            readonly base: number
            readonly equitySlope: number
          }
        >
      >
    >
  >
}
export type Realisation = FlatRealisation | HandRealisation

/** Legacy v1 mutation / reproducibility mode. */
export const DEFAULT_REALISATION: FlatRealisation = { ip: 1.05, oop: 0.95 }
/** All coefficients of the v2 functional form live in this serialisable object. */
export const DEFAULT_HAND_REALISATION: HandRealisation = {
  model: 'hand-equity-v2',
  bounds: { min: 0.4, max: 1.5 },
  equity: { floor: 0.2, ceiling: 0.8, power: 1 },
  sprHalfLife: 4,
  features: {
    pair: 0.08,
    suited: 0.1,
    connected: 0.06,
    highCard: 0.04,
    connectivitySpan: 4,
    wheelConnectivity: 0.5,
  },
  pots: {
    limped: { ip: { base: 0.78, equitySlope: 0.65 }, oop: { base: 0.43, equitySlope: 0.8 } },
    'single-raised': {
      ip: { base: 0.74, equitySlope: 0.7 },
      oop: { base: 0.39, equitySlope: 0.9 },
    },
    'three-bet-plus': {
      ip: { base: 0.7, equitySlope: 0.75 },
      oop: { base: 0.36, equitySlope: 0.95 },
    },
  },
}
export function isHandRealisation(config: Realisation): config is HandRealisation {
  return 'model' in config
}

/** Strict JSON validation, including unknown keys (a misspelled calibration must fail). */
export function parseRealisation(value: unknown): Realisation {
  const object = (v: unknown, keys: readonly string[]): Record<string, unknown> => {
    if (v === null || typeof v !== 'object' || Array.isArray(v))
      throw new Error('realisation config must be an object')
    const record = v as Record<string, unknown>
    if (Object.keys(record).sort().join() !== [...keys].sort().join())
      throw new Error(`realisation config keys must be ${keys.join(', ')}`)
    return record
  }
  const finite = (v: unknown, min: number, max = Number.MAX_VALUE): number => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
      throw new Error('realisation parameters must be finite and within documented bounds')
    return v
  }
  if (value !== null && typeof value === 'object' && !('model' in value)) {
    const flat = object(value, ['ip', 'oop'])
    if (finite(flat.ip, 0) === 0 || finite(flat.oop, 0) === 0)
      throw new Error('realisation factors must be positive')
    return value as FlatRealisation
  }
  const c = object(value, ['model', 'bounds', 'equity', 'sprHalfLife', 'features', 'pots'])
  if (c.model !== 'hand-equity-v2') throw new Error('unknown realisation model')
  const bounds = object(c.bounds, ['min', 'max'])
  if (finite(bounds.min, Number.MIN_VALUE, 1) > finite(bounds.max, 1))
    throw new Error('invalid realisation bounds')
  const eq = object(c.equity, ['floor', 'ceiling', 'power'])
  if (finite(eq.floor, 0, 1) >= finite(eq.ceiling, 0, 1))
    throw new Error('realisation equity floor must be below ceiling')
  finite(eq.power, Number.MIN_VALUE)
  finite(c.sprHalfLife, Number.MIN_VALUE)
  const features = object(c.features, [
    'pair',
    'suited',
    'connected',
    'highCard',
    'connectivitySpan',
    'wheelConnectivity',
  ])
  for (const key of ['pair', 'suited', 'connected', 'highCard']) finite(features[key], 0)
  finite(features.connectivitySpan, Number.MIN_VALUE)
  finite(features.wheelConnectivity, 0, 1)
  const pots = object(c.pots, ['limped', 'single-raised', 'three-bet-plus'])
  for (const pot of Object.values(pots)) {
    const positions = object(pot, ['ip', 'oop'])
    const ip = object(positions.ip, ['base', 'equitySlope'])
    const oop = object(positions.oop, ['base', 'equitySlope'])
    for (const pos of [ip, oop]) {
      finite(pos.base, 0)
      finite(pos.equitySlope, 0)
    }
    // Linear curves may have different slopes; compare BOTH endpoints.
    if (
      (ip.base as number) < (oop.base as number) ||
      (ip.base as number) + (ip.equitySlope as number) <
        (oop.base as number) + (oop.equitySlope as number)
    )
      throw new Error('realisation IP curve must dominate OOP')
  }
  return value as HandRealisation
}
export function validateRealisation(config: Realisation): void {
  parseRealisation(config)
}

const RANKS = '23456789TJQKA'
export function handFeatures(
  hand: string,
  config: HandRealisation,
): {
  pair: number
  suited: number
  connected: number
  highCard: number
} {
  if (!/^(?:([2-9TJQKA])\1|[2-9TJQKA]{2}[so])$/.test(hand))
    throw new Error(`invalid hand class ${hand}`)
  const a = RANKS.indexOf(hand[0] as string) + 2
  const b = RANKS.indexOf(hand[1] as string) + 2
  const hi = Math.max(a, b)
  const lo = Math.min(a, b)
  const pair = Number(a === b)
  if (pair && hand.length !== 2) throw new Error(`invalid hand class ${hand}`)
  const connected = (gap: number) => Math.max(0, 1 - (gap - 1) / config.features.connectivitySpan)
  return {
    pair,
    suited: Number(hand.endsWith('s')),
    connected: pair
      ? 0
      : Math.max(
          connected(hi - lo),
          hi === 14 ? config.features.wheelConnectivity * connected(lo - 1) : 0,
        ),
    highCard: (hi - 2) / 12,
  }
}

/** Monotone in range equity for fixed hand/position/pot/SPR; R -> 1 as SPR -> 0. */
export function realisationFactor(
  hand: string,
  equity: number,
  position: Position,
  potType: PotType,
  spr: number,
  config: HandRealisation,
): number {
  if (!Number.isFinite(equity) || equity < 0 || equity > 1 || !Number.isFinite(spr) || spr < 0)
    throw new Error('invalid equity or SPR')
  const f = handFeatures(hand, config)
  const q =
    Math.min(
      1,
      Math.max(0, (equity - config.equity.floor) / (config.equity.ceiling - config.equity.floor)),
    ) ** config.equity.power
  const curve = config.pots[potType][position]
  const deep =
    curve.base +
    curve.equitySlope * q +
    config.features.pair * f.pair +
    config.features.suited * f.suited +
    config.features.connected * f.connected +
    config.features.highCard * f.highCard
  return Math.min(
    config.bounds.max,
    Math.max(config.bounds.min, 1 + (spr / (spr + config.sprHalfLife)) * (deep - 1)),
  )
}

/** This finite tree closes at matched contributions 1, 2.5, 4, 9, or 22 bb. */
export function flopContext(
  paid: readonly [number, number],
  depth: number,
): {
  potType: PotType
  spr: number
} {
  const contribution = Math.max(...paid)
  return {
    potType: contribution <= 1 ? 'limped' : contribution <= 4 ? 'single-raised' : 'three-bet-plus',
    spr: Math.max(0, depth - contribution) / (paid[0] + paid[1]),
  }
}

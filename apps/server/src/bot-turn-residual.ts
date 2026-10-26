import { readFileSync } from 'node:fs'
import { cardKey } from '@river/engine'
import { COMBOS, comboIndex52 } from './bot-river-value-data.js'
import { HOLDING_CARDS } from './bot-turn-end-data.js'
import type { RiverLeafEvaluator } from './bot-turn-river-leaves.js'
import {
  type BucketLayout,
  bucketInputs,
  bucketsFromRanks,
  forwardBatch,
  loadValueNetwork,
  type RiverValueNetwork,
  rangeWeights,
} from './bot-value-network.js'

/** Versioned, suit-invariant D8 turn-start features. No teacher values enter these. */
export const TURN_RESIDUAL_VERSION = 1
export const TURN_STATIC_NAMES = [
  'strength',
  'riverCategoryMean',
  'riverCategorySpread',
  'madeCategory',
  'flushDraw',
  'straightDraw',
  'suited',
  'highRank',
  'lowRank',
  'pocketPair',
  'boardSuitMax',
  'boardSuitMin',
  'nutFlushBlocker',
  'boardRankMatches',
  'straightOuts',
  'flushOuts',
  'boardPaired',
  'boardMaxSuit',
  'rankGap',
] as const
export const TURN_STATIC = TURN_STATIC_NAMES.length
export const TURN_DYNAMIC = 5
// bucket prediction, position, log SPR; local static and blocker features; own/opponent pools.
export const TURN_RESIDUAL_INPUTS = 3 + 3 * TURN_STATIC + TURN_DYNAMIC
export type TurnRanges = readonly [ArrayLike<number>, ArrayLike<number>]

const straight = new Uint8Array(8192)
for (let mask = 0; mask < straight.length; mask++) {
  if ((mask & 0x100f) === 0x100f) straight[mask] = 1
  for (let low = 0; low <= 8; low++) {
    if (((mask >>> low) & 31) === 31) straight[mask] = 1
  }
}

function rankCategory(pairs: number, trips: number, quads: number, mask: number): number {
  if (quads) return 7
  if (trips >= 2 || (trips && pairs)) return 6
  if (straight[mask]) return 4
  if (trips) return 3
  return Math.min(pairs, 2)
}

export interface TurnCardFeatures {
  readonly layout: BucketLayout
  /** Row-major [1326, TURN_STATIC], zero for blocked holdings. */
  readonly holding: Float32Array
}

/**
 * Exact mean/spread of FINAL HAND CATEGORY over the 46 legal rivers, not
 * showdown-percentile variance. The saved rank supplies expected-strength
 * percentile separately. Category moments are an intentionally cheap potential proxy.
 */
export function turnCardFeatures(board: readonly number[], ranks: Uint16Array): TurnCardFeatures {
  if (board.length !== 4 || new Set(board).size !== 4 || board.some((k) => k < 0 || k >= 52)) {
    throw new Error('D8 needs four distinct turn cards')
  }
  if (ranks.length !== COMBOS) throw new Error('D8 needs 1326 strength ranks')
  const blocked = new Set(board)
  const layout = bucketsFromRanks(ranks, 128)
  const out = new Float32Array(COMBOS * TURN_STATIC)
  const br = new Uint8Array(13)
  const bs = new Uint8Array(4)
  const bm = new Uint16Array(4)
  for (const k of board) {
    br[k % 13] = (br[k % 13] as number) + 1
    bs[Math.floor(k / 13)] = (bs[Math.floor(k / 13)] as number) + 1
    bm[Math.floor(k / 13)] = (bm[Math.floor(k / 13)] as number) | (1 << (k % 13))
  }
  const boardPair = Number(br.some((n) => n > 1))
  const maxSuit = Math.max(...bs)
  const counts = new Uint8Array(13)
  const suits = new Uint8Array(4)
  const masks = new Uint16Array(4)
  for (let h = 0; h < COMBOS; h++) {
    const [a, b] = HOLDING_CARDS[h] as readonly [number, number]
    const live = !blocked.has(a) && !blocked.has(b)
    if (live !== (ranks[h] as number) > 0) throw new Error('board/ranks legality mismatch')
    if (!live) continue
    counts.set(br)
    suits.set(bs)
    masks.set(bm)
    const ar = a % 13,
      arSuit = Math.floor(a / 13),
      cr = b % 13,
      crSuit = Math.floor(b / 13)
    counts[ar] = (counts[ar] as number) + 1
    counts[cr] = (counts[cr] as number) + 1
    suits[arSuit] = (suits[arSuit] as number) + 1
    suits[crSuit] = (suits[crSuit] as number) + 1
    masks[arSuit] = (masks[arSuit] as number) | (1 << ar)
    masks[crSuit] = (masks[crSuit] as number) | (1 << cr)
    let pairs = 0,
      trips = 0,
      quads = 0,
      mask = 0,
      flushSuit = -1
    for (let r = 0; r < 13; r++) {
      const n = counts[r] as number
      if (n) mask |= 1 << r
      pairs += Number(n === 2)
      trips += Number(n === 3)
      quads += Number(n === 4)
    }
    for (let s = 0; s < 4; s++) if ((suits[s] as number) >= 4) flushSuit = s
    const baseMade = rankCategory(pairs, trips, quads, mask)
    let made = baseMade
    if (flushSuit >= 0 && (suits[flushSuit] as number) >= 5) {
      made = Math.max(made, straight[masks[flushSuit] as number] ? 8 : 5)
    }
    let sum = 0,
      sum2 = 0,
      straightOuts = 0,
      flushOuts = 0
    for (let r = 0; r < 13; r++) {
      const count = counts[r] as number
      const available = 4 - count
      const afterMask = mask | (1 << r)
      let cat = rankCategory(
        pairs + Number(count === 1) - Number(count === 2),
        trips + Number(count === 2) - Number(count === 3),
        quads + Number(count === 3),
        afterMask,
      )
      // A flush (or straight flush) already present in six cards survives an
      // off-suit river as well. Only a four-flush needs a matching river suit.
      if (flushSuit >= 0 && (suits[flushSuit] as number) >= 5) cat = Math.max(cat, made)
      sum += available * cat
      sum2 += available * cat * cat
      if (!straight[mask] && straight[afterMask]) straightOuts += available
      if (flushSuit >= 0 && !((masks[flushSuit] as number) & (1 << r))) {
        const flushCat = Math.max(cat, straight[(masks[flushSuit] as number) | (1 << r)] ? 8 : 5)
        sum += flushCat - cat
        sum2 += flushCat * flushCat - cat * cat
        if ((suits[flushSuit] as number) === 4) flushOuts++
      }
    }
    const hasFlushCard = arSuit === flushSuit || crSuit === flushSuit
    const fd = flushSuit >= 0 && suits[flushSuit] === 4 && hasFlushCard
    let nut = 0
    for (const k of [a, b]) {
      const s = Math.floor(k / 13)
      // Highest suit card absent from the board; well-defined even if the ace is on board.
      let high = 12
      while ((bm[s] as number) & (1 << high)) high--
      if ((bs[s] as number) >= 2 && k % 13 === high) nut++
    }
    const values = [
      // Midpoint strength is filled below, preserving tie groups exactly.
      0,
      sum / (46 * 8),
      Math.sqrt(Math.max(0, sum2 / 46 - (sum / 46) ** 2)) / 8,
      made / 8,
      Number(fd),
      Number(straightOuts > 0),
      Number(arSuit === crSuit),
      Math.max(ar, cr) / 12,
      Math.min(ar, cr) / 12,
      Number(ar === cr),
      Math.max(bs[arSuit] as number, bs[crSuit] as number) / 4,
      Math.min(bs[arSuit] as number, bs[crSuit] as number) / 4,
      nut / 2,
      ((br[ar] as number) + (br[cr] as number)) / 8,
      straightOuts / 46,
      fd ? flushOuts / 46 : 0,
      boardPair,
      maxSuit / 4,
      Math.abs(ar - cr) / 12,
    ]
    out.set(values, h * TURN_STATIC)
  }
  // Use the original midpoint definition, including tie groups, in full precision.
  const count = new Uint16Array(COMBOS + 1)
  for (const rank of ranks) if (rank > 0) count[rank] = (count[rank] as number) + 1
  let below = 0
  const percentile = new Float64Array(COMBOS + 1)
  for (let r = 1; r <= COMBOS; r++) {
    percentile[r] = (below + (count[r] as number) / 2) / layout.live
    below += count[r] as number
  }
  for (let h = 0; h < COMBOS; h++)
    if ((ranks[h] as number) > 0) out[h * TURN_STATIC] = percentile[ranks[h] as number] as number
  // Deliberately do not expose raw suit identifiers: all 24 suit augmentations
  // yield the same features after undoing their holding permutation.
  return { layout, holding: out }
}

/** Normalise over live cards, as bucketInputs does; reject invalid range weights. */
export function normaliseTurnRanges(
  cards: TurnCardFeatures,
  ranges: TurnRanges,
): readonly [Float64Array, Float64Array] {
  return ranges.map((range) => {
    if (range.length !== COMBOS) throw new Error('D8 needs 1326 range weights')
    const out = new Float64Array(COMBOS)
    let mass = 0
    for (let h = 0; h < COMBOS; h++) {
      const w = range[h] as number
      if (!Number.isFinite(w) || w < 0) throw new Error('invalid range weight')
      if ((cards.layout.bucketOf[h] as number) >= 0) mass += w
    }
    if (mass)
      for (let h = 0; h < COMBOS; h++)
        if ((cards.layout.bucketOf[h] as number) >= 0) out[h] = (range[h] as number) / mass
    return out
  }) as unknown as readonly [Float64Array, Float64Array]
}

export function turnResidualInputs(
  cards: TurnCardFeatures,
  ranges: TurnRanges,
  bucketValues: ArrayLike<number>,
  stack: number,
  pot: number,
  buffer?: Float32Array,
): Float32Array {
  const weights = normaliseTurnRanges(cards, ranges)
  const pool = [new Float64Array(TURN_STATIC), new Float64Array(TURN_STATIC)] as const
  // Per card: all mass, top-decile strength mass, drawing mass.
  const mass = [new Float64Array(156), new Float64Array(156)] as const
  for (const p of [0, 1] as const)
    for (let h = 0; h < COMBOS; h++) {
      const w = weights[p][h] as number
      if (!w) continue
      const at = h * TURN_STATIC
      for (let f = 0; f < TURN_STATIC; f++)
        pool[p][f] = (pool[p][f] as number) + w * (cards.holding[at + f] as number)
      const strong = Number((cards.holding[at] as number) >= 0.9)
      const draw = Math.max(cards.holding[at + 4] as number, cards.holding[at + 5] as number)
      for (const k of HOLDING_CARDS[h] as readonly [number, number]) {
        mass[p][k] = (mass[p][k] as number) + w
        mass[p][52 + k] = (mass[p][52 + k] as number) + w * strong
        mass[p][104 + k] = (mass[p][104 + k] as number) + w * draw
      }
    }
  const out = buffer ?? new Float32Array(2 * COMBOS * TURN_RESIDUAL_INPUTS)
  if (out.length !== 2 * COMBOS * TURN_RESIDUAL_INPUTS)
    throw new Error('invalid residual input buffer')
  out.fill(0)
  const logSPR = Math.log(Math.min(50, Math.max(0.05, stack / pot)))
  for (const p of [0, 1] as const)
    for (let h = 0; h < COMBOS; h++) {
      const b = cards.layout.bucketOf[h] as number
      if (b < 0) continue
      const opp = p === 0 ? 1 : 0
      const [a, c] = HOLDING_CARDS[h] as readonly [number, number]
      const f = h * TURN_STATIC
      let at = (p * COMBOS + h) * TURN_RESIDUAL_INPUTS
      out[at++] = bucketValues[p * 128 + b] as number
      out[at++] = p
      out[at++] = logSPR
      for (let j = 0; j < TURN_STATIC; j++) out[at++] = cards.holding[f + j] as number
      const ma = mass[opp][a] as number,
        mc = mass[opp][c] as number,
        own = weights[opp][h] as number
      out[at++] = Math.max(ma, mc)
      out[at++] = Math.min(ma, mc)
      out[at++] = ma + mc - own
      out[at++] =
        (mass[opp][52 + a] as number) +
        (mass[opp][52 + c] as number) -
        own * Number((cards.holding[f] as number) >= 0.9)
      out[at++] =
        (mass[opp][104 + a] as number) +
        (mass[opp][104 + c] as number) -
        own * Math.max(cards.holding[f + 4] as number, cards.holding[f + 5] as number)
      out.set(pool[p], at)
      out.set(pool[opp], at + TURN_STATIC)
    }
  return out
}

export interface TurnResidualNetwork {
  readonly bucket: RiverValueNetwork
  readonly residual: RiverValueNetwork
}

export function loadTurnResidualNetwork(stem: string): TurnResidualNetwork {
  const meta = JSON.parse(readFileSync(`${stem}.json`, 'utf8')) as {
    version: number
    target: string
    inputs: number
  }
  if (
    meta.version !== TURN_RESIDUAL_VERSION ||
    meta.target !== 'turn-start/per-river-v1' ||
    meta.inputs !== TURN_RESIDUAL_INPUTS
  )
    throw new Error('incompatible D8 model')
  const bucket = loadValueNetwork(`${stem}-bucket`)
  const residual = loadValueNetwork(`${stem}-head`)
  if (
    bucket.buckets !== 128 ||
    bucket.layers[0]?.columns !== 385 ||
    bucket.layers.at(-1)?.rows !== 256 ||
    residual.layers[0]?.columns !== TURN_RESIDUAL_INPUTS ||
    residual.layers.at(-1)?.rows !== 1
  )
    throw new Error('incompatible D8 tensor dimensions')
  return { bucket, residual }
}

const layerScratch = new WeakMap<RiverValueNetwork, { n: number; layers: Float32Array[] }>()
const featureScratch = new WeakMap<TurnResidualNetwork, Float32Array>()

// Like the existing WASM backend, scratch is synchronous and non-reentrant.
// Returned holding values are fresh arrays and stay valid after later calls.
function batch(network: RiverValueNetwork, input: Float32Array, n: number): Float32Array {
  let scratch = layerScratch.get(network)
  if (scratch === undefined || scratch.n !== n) {
    scratch = { n, layers: network.layers.map((l) => new Float32Array(n * l.rows)) }
    layerScratch.set(network, scratch)
  }
  return forwardBatch(network, input, n, scratch.layers)
}

/** Prepared card features are reusable across every range visit to this turn board. */
export function turnResidualValues(
  network: TurnResidualNetwork,
  cards: TurnCardFeatures,
  ranges: TurnRanges,
  stack: number,
  pot: number,
  dropResidual = false,
): readonly [Float32Array, Float32Array] {
  const bucket = batch(network.bucket, bucketInputs(cards.layout, ranges, stack, pot), 1)
  let delta: Float32Array | undefined
  if (!dropResidual) {
    let buffer = featureScratch.get(network)
    if (buffer === undefined) {
      buffer = new Float32Array(2 * COMBOS * TURN_RESIDUAL_INPUTS)
      featureScratch.set(network, buffer)
    }
    const input = turnResidualInputs(cards, ranges, bucket, stack, pot, buffer)
    delta = batch(network.residual, input, 2 * COMBOS)
  }
  const out = [new Float32Array(COMBOS), new Float32Array(COMBOS)] as const
  for (const p of [0, 1] as const)
    for (let h = 0; h < COMBOS; h++) {
      const b = cards.layout.bucketOf[h] as number
      if (b >= 0) out[p][h] = (bucket[p * 128 + b] as number) + (delta?.[p * COMBOS + h] ?? 0)
    }
  return out
}

export function permuteHolding(h: number, suits: readonly number[]): number {
  const [a, b] = HOLDING_CARDS[h] as readonly [number, number]
  return comboIndex52(
    (suits[Math.floor(a / 13)] as number) * 13 + (a % 13),
    (suits[Math.floor(b / 13)] as number) * 13 + (b % 13),
  )
}

/** Opt-in adapter accepted directly by perTurnShowdown; no production default changes. */
export function turnResidualLeaf(network: TurnResidualNetwork): RiverLeafEvaluator {
  const prepared = new Map<string, TurnCardFeatures>()
  return (spot, ranks) => {
    const board = spot.board.map(cardKey)
    const key = board.join(',')
    let cards = prepared.get(key)
    if (cards === undefined) {
      cards = turnCardFeatures(board, ranks)
      prepared.set(key, cards)
      if (prepared.size > 64) prepared.delete(prepared.keys().next().value as string)
    }
    return turnResidualValues(network, cards, rangeWeights(spot), spot.stack, spot.pot)
  }
}

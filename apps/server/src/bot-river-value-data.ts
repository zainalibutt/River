import { type Card, cardKey, handScore, makeDeck, mulberry32, seedFromString } from '@river/engine'
import {
  type RangeCombo,
  type RiverSpot,
  riverReport,
  riverValues,
  solveRiver,
} from './bot-river-solver.js'

/**
 * Training data for v9's river value network (docs/bots.md): random river
 * spots, each solved by the river solver, with every holding's value for both
 * players. A spot is a random board, pot and stack, and two random ranges
 * shaped like real ones. Records are fixed-size and little-endian, so the
 * Python training script reads them straight into arrays.
 */

/** Two-card holdings in a 52-card deck. */
export const COMBOS = 1326

/**
 * A holding's place among all 1,326, from its two card keys (`cardKey`, which
 * is also the card's place in `makeDeck()`): (0, 1) is 0, (0, 2) is 1, and
 * (50, 51) is 1,325.
 */
export function comboIndex52(a: number, b: number): number {
  const low = Math.min(a, b)
  const high = Math.max(a, b)
  return low * 51 - (low * (low - 1)) / 2 + (high - low - 1)
}

export interface RiverDataSettings {
  /** Solver rounds for a spot, and for a deep one, where errors in pots grow with the stack. */
  readonly iterations: number
  readonly deepIterations: number
  /** A spot is deep when stack over pot is above this. */
  readonly deepStackToPot: number
  readonly betSizes: readonly number[]
  readonly allIn: boolean
  readonly maxRaises: number
  /** Chips in the pot before the river: large, so rounding a bet to the chip changes nothing. */
  readonly pot: number
  /** Stacks behind are drawn so that stack over pot is log-uniform between these. */
  readonly minStackToPot: number
  readonly maxStackToPot: number
}

/**
 * The live river solver's tree (the v8z tuning in bot-river-policy.ts). At
 * 200 rounds a holding's value is within about 0.7% of the pot of a 2,000-round
 * solve where the stack is up to ten pots, and 2% beyond; 400 rounds halve the
 * deep error. Measured with bot-river-value-calibrate.ts on 1 October 2026.
 */
export const RIVER_DATA_SETTINGS: RiverDataSettings = {
  iterations: 200,
  deepIterations: 400,
  deepStackToPot: 10,
  betSizes: [0.5, 1],
  allIn: true,
  maxRaises: 2,
  pot: 10_000,
  minStackToPot: 0.05,
  maxStackToPot: 50,
}

/**
 * A random range shaped like a real one, after DeepStack's generator: the
 * holdings, weakest first, are split into a weaker and a stronger half, the
 * mass is split between the halves at random, and so on down to single
 * holdings. Real ranges lean towards strong or weak hands, or both at once,
 * and these do too, in every proportion. Every holding keeps some weight, so
 * each has a value. Returns one weight per position, summing to one.
 */
export function randomRangeWeights(count: number, rng: () => number): Float64Array {
  const weights = new Float64Array(count)
  const split = (start: number, end: number, mass: number) => {
    if (end - start === 1) {
      weights[start] = mass
      return
    }
    const middle = start + Math.floor((end - start) / 2)
    const share = 1e-6 + (1 - 2e-6) * rng()
    split(start, middle, mass * share)
    split(middle, end, mass * (1 - share))
  }
  if (count > 0) split(0, count, 1)
  return weights
}

/**
 * A random river spot: a uniform board, a stack drawn so stack over pot is
 * log-uniform, and two independent random ranges over every holding the board
 * leaves possible. Holdings of equal strength are taken in random order, so no
 * suit is favoured. The same seed always gives the same spot.
 */
export function sampleRiverSpot(seed: string, settings: RiverDataSettings): RiverSpot {
  return sampleSpot(seed, settings, 5)
}

/**
 * A random spot at the end of the turn's betting, before the river card: as
 * `sampleRiverSpot` with four board cards, the ranges ordered by the hand each
 * holding has made so far. It is not a river spot to solve; see
 * `solveTurnTruthRecord`.
 */
export function sampleTurnEndSpot(seed: string, settings: RiverDataSettings): RiverSpot {
  return sampleSpot(seed, settings, 4)
}

function sampleSpot(seed: string, settings: RiverDataSettings, boardCards: number): RiverSpot {
  const rng = mulberry32(seedFromString(seed))
  const deck = makeDeck()
  shuffle(deck, rng)
  const board = deck.slice(0, boardCards)
  const live = deck.slice(boardCards)
  const holdings: [Card, Card][] = []
  for (let a = 0; a < live.length; a += 1) {
    for (let b = a + 1; b < live.length; b += 1) holdings.push([live[a] as Card, live[b] as Card])
  }
  shuffle(holdings, rng)
  const strength = holdings.map((hole) => handScore([...hole, ...board]))
  const order = Array.from(holdings.keys()).sort(
    (x, y) => (strength[x] as number) - (strength[y] as number),
  )
  const range = (): RangeCombo[] => {
    const weights = randomRangeWeights(order.length, rng)
    return order.map((index, position) => ({
      hole: holdings[index] as [Card, Card],
      weight: weights[position] as number,
    }))
  }
  const ranges = [range(), range()] as const
  const low = Math.log(settings.minStackToPot)
  const high = Math.log(settings.maxStackToPot)
  const stackToPot = Math.exp(low + rng() * (high - low))
  return {
    board,
    pot: settings.pot,
    stack: Math.max(1, Math.round(settings.pot * stackToPot)),
    ranges,
    betSizes: settings.betSizes,
    allIn: settings.allIn,
    maxRaises: settings.maxRaises,
  }
}

/** How many solver rounds a spot gets. */
export function roundsFor(spot: RiverSpot, settings: RiverDataSettings): number {
  return spot.stack / spot.pot > settings.deepStackToPot
    ? settings.deepIterations
    : settings.iterations
}

export interface RiverRecord {
  /** Card keys. */
  readonly board: readonly number[]
  readonly pot: number
  readonly stack: number
  /** The spot's number in its worker's stream of seeds. */
  readonly spot: number
  readonly worker: number
  readonly iterations: number
  /** What a perfect counter would gain, as a share of the pot; NaN when not measured. */
  readonly exploitability: number
  readonly solveMs: number
  /** Each player's range by `comboIndex52`, summing to one; zero where the board blocks. */
  readonly ranges: readonly [Float32Array, Float32Array]
  /** Each holding's value from the river on, in pots; zero where the board blocks. */
  readonly values: readonly [Float32Array, Float32Array]
  /** Each holding's showdown rank on the board, 1 for the weakest, ties sharing; 0 where blocked. */
  readonly strengthRank: Uint16Array
}

/** Solves a spot and records it. `measure` also works out how exploitable the solution is. */
export function solveRiverRecord(
  spot: RiverSpot,
  iterations: number,
  meta: { readonly spot: number; readonly worker: number; readonly measure: boolean },
): RiverRecord {
  const started = performance.now()
  const solution = solveRiver(spot, iterations)
  const solveMs = performance.now() - started
  const { hands, values } = riverValues(solution)
  const ranges = [new Float32Array(COMBOS), new Float32Array(COMBOS)] as const
  const scaled = [new Float32Array(COMBOS), new Float32Array(COMBOS)] as const
  for (const player of [0, 1] as const) {
    const held = hands[player]
    let total = 0
    held.weights.forEach((weight) => {
      total += weight
    })
    for (let h = 0; h < held.combos.length; h += 1) {
      const index = comboIndex52(held.cards[2 * h] as number, held.cards[2 * h + 1] as number)
      ranges[player][index] = (held.weights[h] as number) / total
      scaled[player][index] = (values[player][h] as number) / spot.pot
    }
  }
  return {
    board: spot.board.map(cardKey),
    pot: spot.pot,
    stack: spot.stack,
    spot: meta.spot,
    worker: meta.worker,
    iterations,
    exploitability: meta.measure ? riverReport(solution).exploitability : Number.NaN,
    solveMs,
    ranges,
    values: scaled,
    strengthRank: strengthRanks(spot.board),
  }
}

/**
 * The value of a turn spot at the end of its betting, worked out exactly: the
 * river is solved for every card that can come, with each card taken out of
 * the holdings it clashes with, and each holding's value is averaged over the
 * rivers weighted by the opponent's holdings it can meet on each, which is how
 * the deal falls. It is about 48 river solves, so these spots are few and
 * serve as the answers networks are checked against. The record's fifth board
 * card is 255, for none.
 */
export function solveTurnTruthRecord(
  turn: RiverSpot,
  settings: RiverDataSettings,
  meta: { readonly spot: number; readonly worker: number },
): RiverRecord {
  const started = performance.now()
  const blocked = new Set(turn.board.map(cardKey))
  const sums = [new Float64Array(COMBOS), new Float64Array(COMBOS)] as const
  const weights = [new Float64Array(COMBOS), new Float64Array(COMBOS)] as const
  let rounds = settings.iterations
  for (const river of makeDeck()) {
    const key = cardKey(river)
    if (blocked.has(key)) continue
    const without = (range: readonly RangeCombo[]) =>
      range.filter((combo) => cardKey(combo.hole[0]) !== key && cardKey(combo.hole[1]) !== key)
    const spot: RiverSpot = {
      ...turn,
      board: [...turn.board, river],
      ranges: [without(turn.ranges[0]), without(turn.ranges[1])],
    }
    rounds = roundsFor(spot, settings)
    const { hands, values, masses } = riverValues(solveRiver(spot, rounds))
    for (const player of [0, 1] as const) {
      const held = hands[player]
      for (let h = 0; h < held.combos.length; h += 1) {
        const index = comboIndex52(held.cards[2 * h] as number, held.cards[2 * h + 1] as number)
        const mass = masses[player][h] as number
        sums[player][index] = (sums[player][index] as number) + mass * (values[player][h] as number)
        weights[player][index] = (weights[player][index] as number) + mass
      }
    }
  }
  const ranges = [new Float32Array(COMBOS), new Float32Array(COMBOS)] as const
  const scaled = [new Float32Array(COMBOS), new Float32Array(COMBOS)] as const
  for (const player of [0, 1] as const) {
    let total = 0
    for (const combo of turn.ranges[player]) total += combo.weight
    for (const combo of turn.ranges[player]) {
      const index = comboIndex52(cardKey(combo.hole[0]), cardKey(combo.hole[1]))
      ranges[player][index] = combo.weight / total
      const weight = weights[player][index] as number
      scaled[player][index] = weight > 0 ? (sums[player][index] as number) / weight / turn.pot : 0
    }
  }
  return {
    board: [...turn.board.map(cardKey), 255],
    pot: turn.pot,
    stack: turn.stack,
    spot: meta.spot,
    worker: meta.worker,
    iterations: rounds,
    exploitability: Number.NaN,
    solveMs: performance.now() - started,
    ranges,
    values: scaled,
    strengthRank: strengthRanks(turn.board),
  }
}

/**
 * Every holding's showdown rank on a board, 1 for the weakest, ties sharing;
 * 0 where blocked. On a turn board it ranks the hand made so far.
 */
export function strengthRanks(board: readonly Card[]): Uint16Array {
  const blocked = new Set(board.map(cardKey))
  const live = makeDeck().filter((card) => !blocked.has(cardKey(card)))
  const scored: { index: number; score: number }[] = []
  for (let a = 0; a < live.length; a += 1) {
    for (let b = a + 1; b < live.length; b += 1) {
      const first = live[a] as Card
      const second = live[b] as Card
      scored.push({
        index: comboIndex52(cardKey(first), cardKey(second)),
        score: handScore([first, second, ...board]),
      })
    }
  }
  scored.sort((x, y) => x.score - y.score)
  const ranks = new Uint16Array(COMBOS)
  let rank = 0
  let previous = Number.NEGATIVE_INFINITY
  for (const { index, score } of scored) {
    if (score > previous) {
      rank += 1
      previous = score
    }
    ranks[index] = rank
  }
  return ranks
}

const HEADER_BYTES = 32

/** Bytes in one record: a 32-byte header, four rows of 1,326 floats and one of 1,326 ranks. */
export const RIVER_RECORD_BYTES = HEADER_BYTES + 4 * 4 * COMBOS + 2 * COMBOS

/**
 * The record's layout, for the run's manifest and the Python reader. All
 * numbers are little-endian; rows are indexed by `comboIndex52`; player 0 acts
 * first, out of position.
 */
export const RIVER_RECORD_LAYOUT = [
  { field: 'board', type: 'uint8', count: 5, offset: 0 },
  { field: 'pot', type: 'float32', count: 1, offset: 8 },
  { field: 'stack', type: 'float32', count: 1, offset: 12 },
  { field: 'spot', type: 'uint32', count: 1, offset: 16 },
  { field: 'worker', type: 'uint16', count: 1, offset: 20 },
  { field: 'iterations', type: 'uint16', count: 1, offset: 22 },
  { field: 'exploitability', type: 'float32', count: 1, offset: 24 },
  { field: 'solveMs', type: 'float32', count: 1, offset: 28 },
  { field: 'ranges', type: 'float32', count: 2 * COMBOS, offset: HEADER_BYTES },
  { field: 'values', type: 'float32', count: 2 * COMBOS, offset: HEADER_BYTES + 8 * COMBOS },
  { field: 'strengthRank', type: 'uint16', count: COMBOS, offset: HEADER_BYTES + 16 * COMBOS },
] as const

export function encodeRiverRecord(record: RiverRecord): Uint8Array {
  const bytes = new Uint8Array(RIVER_RECORD_BYTES)
  const view = new DataView(bytes.buffer)
  record.board.forEach((card, index) => {
    view.setUint8(index, card)
  })
  view.setFloat32(8, record.pot, true)
  view.setFloat32(12, record.stack, true)
  view.setUint32(16, record.spot, true)
  view.setUint16(20, record.worker, true)
  view.setUint16(22, record.iterations, true)
  view.setFloat32(24, record.exploitability, true)
  view.setFloat32(28, record.solveMs, true)
  const rows = [record.ranges[0], record.ranges[1], record.values[0], record.values[1]]
  rows.forEach((row, r) => {
    const start = HEADER_BYTES + r * 4 * COMBOS
    for (let i = 0; i < COMBOS; i += 1) view.setFloat32(start + 4 * i, row[i] as number, true)
  })
  const ranks = HEADER_BYTES + 16 * COMBOS
  for (let i = 0; i < COMBOS; i += 1) {
    view.setUint16(ranks + 2 * i, record.strengthRank[i] as number, true)
  }
  return bytes
}

export function decodeRiverRecord(bytes: Uint8Array, offset = 0): RiverRecord {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, RIVER_RECORD_BYTES)
  const row = (r: number) =>
    Float32Array.from({ length: COMBOS }, (_, i) =>
      view.getFloat32(HEADER_BYTES + r * 4 * COMBOS + 4 * i, true),
    )
  const ranks = HEADER_BYTES + 16 * COMBOS
  return {
    board: Array.from({ length: 5 }, (_, i) => view.getUint8(i)),
    pot: view.getFloat32(8, true),
    stack: view.getFloat32(12, true),
    spot: view.getUint32(16, true),
    worker: view.getUint16(20, true),
    iterations: view.getUint16(22, true),
    exploitability: view.getFloat32(24, true),
    solveMs: view.getFloat32(28, true),
    ranges: [row(0), row(1)],
    values: [row(2), row(3)],
    strengthRank: Uint16Array.from({ length: COMBOS }, (_, i) =>
      view.getUint16(ranks + 2 * i, true),
    ),
  }
}

function shuffle<T>(items: T[], rng: () => number): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const swap = items[i] as T
    items[i] = items[j] as T
    items[j] = swap
  }
}

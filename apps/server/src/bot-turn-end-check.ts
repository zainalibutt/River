import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  COMBOS,
  decodeRiverRecord,
  RIVER_DATA_SETTINGS,
  RIVER_RECORD_BYTES,
  type RiverRecord,
  sampleTurnEndSpot,
} from './bot-river-value-data.js'
import { turnEndValues, turnLayout, turnRivers } from './bot-turn-end-data.js'
import {
  bucketInputs,
  holdingValues,
  type RiverValueNetwork,
  rangeWeights,
  riverHoldingValues,
  type ValueNetworkDescription,
  valueNetworkFrom,
} from './bot-value-network.js'

// Usage: tsx bot-turn-end-check.ts <truth dir> <river network> <turn-end network> [spots]
//
// How good v9's answers where the turn ends are, against the turn truth set
// (docs/bots.md). Each truth spot is rebuilt from its seed, and every
// holding's value is compared three ways, in pots: the exact truth, the river
// network averaged over the river cards (what the turn-end network is taught),
// and the turn-end network itself. Errors are over every holding and over
// held hands, weighted by how often each is held, by stack depth.
const [truthDir, riverStem, turnStem, limitText] = process.argv.slice(2)
if (!truthDir || !riverStem || !turnStem) {
  throw new Error('usage: <truth dir> <river network> <turn-end network> [spots]')
}
const limit = limitText === undefined ? Number.POSITIVE_INFINITY : Number(limitText)

function load(stem: string): RiverValueNetwork {
  const description = JSON.parse(readFileSync(`${stem}.json`, 'utf8')) as ValueNetworkDescription
  const raw = readFileSync(`${stem}.bin`)
  return valueNetworkFrom(
    description,
    new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4),
  )
}

const river = load(riverStem)
const turnEnd = load(turnStem)
const manifest = JSON.parse(readFileSync(join(truthDir, 'manifest.json'), 'utf8')) as {
  runSeed: string
}
const records: RiverRecord[] = []
for (const file of readdirSync(truthDir)
  .filter((name) => /^turn-w\d\d-\d+\.bin$/.test(name))
  .sort()) {
  const bytes = new Uint8Array(readFileSync(join(truthDir, file)))
  for (let offset = 0; offset + RIVER_RECORD_BYTES <= bytes.length; offset += RIVER_RECORD_BYTES) {
    if (records.length < limit) records.push(decodeRiverRecord(bytes, offset))
  }
}

const bands = [
  { name: 'all spots', low: 0, high: Number.POSITIVE_INFINITY },
  { name: 'under 1 pot behind', low: 0, high: 1 },
  { name: '1 to 10 pots', low: 1, high: 10 },
  { name: 'over 10 pots', low: 10, high: Number.POSITIVE_INFINITY },
]
const tally = (pairs: string[]) =>
  new Map(
    pairs.flatMap((pair) =>
      bands.map((band) => [`${pair}|${band.name}`, { every: 0, live: 0, held: 0, spots: 0 }]),
    ),
  )
const comparisons = [
  'river network averaged vs truth',
  'turn-end network vs truth',
  'turn-end network vs averaged',
]
const totals = tally(comparisons)
const started = Date.now()
for (const record of records) {
  const spot = sampleTurnEndSpot(
    `${manifest.runSeed}:${record.worker}:${record.spot}`,
    RIVER_DATA_SETTINGS,
  )
  const rivers = turnRivers(spot.board)
  const averaged = turnEndValues(spot, rivers, (riverSpot, ranks) =>
    riverHoldingValues(river, riverSpot, ranks),
  )
  const layout = turnLayout(rivers, turnEnd)
  const predicted = holdingValues(
    turnEnd,
    layout,
    bucketInputs(layout, rangeWeights(spot), spot.stack, spot.pot),
  )
  const sets: [
    string,
    readonly [ArrayLike<number>, ArrayLike<number>],
    readonly [ArrayLike<number>, ArrayLike<number>],
  ][] = [
    [comparisons[0] as string, averaged, record.values],
    [comparisons[1] as string, predicted, record.values],
    [comparisons[2] as string, predicted, averaged],
  ]
  const depth = spot.stack / spot.pot
  for (const [name, values, truth] of sets) {
    for (const band of bands) {
      if (depth < band.low || depth >= band.high) continue
      const entry = totals.get(`${name}|${band.name}`)
      if (entry === undefined) continue
      entry.spots += 1
      for (const player of [0, 1] as const) {
        for (let index = 0; index < COMBOS; index += 1) {
          const weight = record.ranges[player][index] as number
          if (weight <= 0) continue
          const error = Math.abs(
            (values[player][index] as number) - (truth[player][index] as number),
          )
          entry.every += error
          entry.live += 1
          entry.held += weight * error
        }
      }
    }
  }
}
process.stdout.write(
  `${records.length} truth spots, checked in ${((Date.now() - started) / 1000).toFixed(0)} s; errors in pots\n`,
)
for (const name of comparisons) {
  process.stdout.write(`${name}:\n`)
  for (const band of bands) {
    const entry = totals.get(`${name}|${band.name}`)
    if (entry === undefined || entry.spots === 0) continue
    process.stdout.write(
      `  ${band.name.padEnd(20)} ${String(entry.spots).padStart(5)} spots | every holding ${((entry.every / entry.live) * 100).toFixed(2)}% | held hands ${((entry.held / (2 * entry.spots)) * 100).toFixed(2)}%\n`,
    )
  }
}

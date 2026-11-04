import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Card, makeDeck } from '@river/engine'
import { flopLayout } from './bot-flop-buckets.js'
import {
  COMBOS,
  decodeRiverRecord,
  RIVER_RECORD_BYTES,
  type RiverRecord,
} from './bot-river-value-data.js'
import { bucketInputs, holdingValues, loadValueNetwork } from './bot-value-network.js'

// Usage: tsx bot-flop-end-check.ts <exam dir> <flop-end network> [spots]
//
// How good a flop-end network is, against the flop exam (bot-flop-end-data-run.ts
// with every turn card solved): each exam record's ranges, stack and pot go to
// the network, bucketed by the record's rank row as in training, and every
// holding's answer is compared with the exam's, in pots, over every holding and
// over held hands weighted by how often each is held, by stack depth.
const [examDir, networkStem, limitText] = process.argv.slice(2)
if (!examDir || !networkStem) throw new Error('usage: <exam dir> <flop-end network> [spots]')
const limit = limitText === undefined ? Number.POSITIVE_INFINITY : Number(limitText)
const network = loadValueNetwork(networkStem)
const deck = makeDeck()
if (network.checked !== undefined)
  throw new Error('a flop-end network takes no checked-down values')

const records: RiverRecord[] = []
for (const file of readdirSync(examDir)
  .filter((name) => /^flopend-w\d\d-\d+\.bin$/.test(name))
  .sort()) {
  const bytes = new Uint8Array(readFileSync(join(examDir, file)))
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
const totals = new Map(bands.map((band) => [band.name, { every: 0, live: 0, held: 0, spots: 0 }]))
const started = Date.now()
for (const record of records) {
  if (record.board[3] !== 255) throw new Error(`spot ${record.spot} is not a flop-end record`)
  const layout = flopLayout(
    record.board.slice(0, 3).map((key) => deck[key] as Card),
    record.strengthRank,
    network,
  )
  const predicted = holdingValues(
    network,
    layout,
    bucketInputs(layout, record.ranges, record.stack, record.pot),
  )
  const depth = record.stack / record.pot
  for (const band of bands) {
    if (depth < band.low || depth >= band.high) continue
    const entry = totals.get(band.name)
    if (entry === undefined) continue
    entry.spots += 1
    for (const player of [0, 1] as const) {
      for (let index = 0; index < COMBOS; index += 1) {
        const weight = record.ranges[player][index] as number
        if (weight <= 0) continue
        const error = Math.abs(
          (predicted[player][index] as number) - (record.values[player][index] as number),
        )
        entry.every += error
        entry.live += 1
        entry.held += weight * error
      }
    }
  }
}
process.stdout.write(
  `${records.length} exam spots, checked in ${((Date.now() - started) / 1000).toFixed(0)} s; errors in pots\nflop-end network vs exam:\n`,
)
for (const band of bands) {
  const entry = totals.get(band.name)
  if (entry === undefined || entry.spots === 0) continue
  process.stdout.write(
    `  ${band.name.padEnd(20)} ${String(entry.spots).padStart(5)} spots | every holding ${((entry.every / entry.live) * 100).toFixed(2)}% | held hands ${((entry.held / (2 * entry.spots)) * 100).toFixed(2)}%\n`,
  )
}

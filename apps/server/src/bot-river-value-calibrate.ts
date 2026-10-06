import { writeFileSync } from 'node:fs'
import {
  RIVER_DATA_SETTINGS,
  type RiverRecord,
  sampleRiverSpot,
  solveRiverRecord,
} from './bot-river-value-data.js'

// Usage: tsx bot-river-value-calibrate.ts <run seed> <first spot> <spots> <out.json> [reference rounds]
//
// How many solver rounds the river value network's answers need
// (docs/bots.md). Each spot is solved at 100, 200 and 400 rounds and once
// for long, and every holding's value is compared with the long solve's, in
// pots: on average, on average weighted by how often the hand is held, and at
// worst. The spots come from the data factory's own sampler.
const [runSeed, firstText, spotsText, out, referenceText] = process.argv.slice(2)
const first = Number(firstText)
const spots = Number(spotsText)
const reference = referenceText === undefined ? 2000 : Number(referenceText)
if (
  !runSeed ||
  !out ||
  ![first, spots, reference].every(Number.isSafeInteger) ||
  spots < 1 ||
  reference < 1
) {
  throw new Error('usage: <run seed> <first spot> <spots> <out.json> [reference rounds]')
}

function errors(record: RiverRecord, truth: RiverRecord) {
  let count = 0
  let sum = 0
  let weighted = 0
  let worst = 0
  for (const player of [0, 1] as const) {
    record.strengthRank.forEach((rank, index) => {
      if (rank === 0) return
      const error = Math.abs(
        (record.values[player][index] as number) - (truth.values[player][index] as number),
      )
      count += 1
      sum += error
      weighted += (truth.ranges[player][index] as number) * error
      worst = Math.max(worst, error)
    })
  }
  return { meanError: sum / count, weightedError: weighted / 2, maxError: worst }
}

const rows: object[] = []
for (let n = first; n < first + spots; n += 1) {
  const spot = sampleRiverSpot(`${runSeed}:calibrate:${n}`, RIVER_DATA_SETTINGS)
  const truth = solveRiverRecord(spot, reference, { spot: n, worker: 0, measure: true })
  for (const rounds of [100, 200, 400]) {
    const record = solveRiverRecord(spot, rounds, { spot: n, worker: 0, measure: true })
    rows.push({
      spot: n,
      stackToPot: spot.stack / spot.pot,
      rounds,
      solveMs: record.solveMs,
      exploitability: record.exploitability,
      referenceExploitability: truth.exploitability,
      ...errors(record, truth),
    })
  }
  process.stderr.write(`spot ${n} done\n`)
}
writeFileSync(out, `${JSON.stringify(rows)}\n`)

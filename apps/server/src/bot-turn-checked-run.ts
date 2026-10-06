import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Card, makeDeck } from '@river/engine'
import type { RangeCombo, RiverSpot } from './bot-river-solver.js'
import { COMBOS, decodeRiverRecord, RIVER_RECORD_BYTES } from './bot-river-value-data.js'
import { checkedDownValues, turnRivers } from './bot-turn-end-data.js'

// Usage: tsx bot-turn-checked-run.ts <data dir> <worker> <workers>
//
// Writes each turn shard's checked-down values beside it: for X.bin, X.checked
// holds one row per record of 2 x 1,326 float32, each holding's value in pots
// if nobody bets again (checkedDownValues), the first player's then the
// second's, 0 where the board blocks the holding. They depend only on each
// record's board and ranges, so the stored answers need no remaking. Shards
// are shared out by their place in name order; a finished side file is skipped.
const [dir, workerText, workersText] = process.argv.slice(2)
const worker = Number(workerText)
const workers = Number(workersText)
if (
  !dir ||
  ![worker, workers].every(Number.isSafeInteger) ||
  workers < 1 ||
  worker < 0 ||
  worker >= workers
) {
  throw new Error('usage: <data dir> <worker> <workers>')
}
const deck = makeDeck()
const holdings: (readonly [Card, Card])[] = []
for (let a = 0; a < 52; a += 1) {
  for (let b = a + 1; b < 52; b += 1) holdings.push([deck[a] as Card, deck[b] as Card])
}
const shards = readdirSync(dir)
  .filter((name) => /-w\d\d-\d+\.bin$/.test(name))
  .sort()
for (const [place, name] of shards.entries()) {
  if (place % workers !== worker) continue
  const out = join(dir, name.replace(/\.bin$/, '.checked'))
  if (existsSync(out)) continue
  const started = Date.now()
  const bytes = new Uint8Array(readFileSync(join(dir, name)))
  const count = Math.floor(bytes.length / RIVER_RECORD_BYTES)
  const values = new Float32Array(count * 2 * COMBOS)
  for (let r = 0; r < count; r += 1) {
    const record = decodeRiverRecord(bytes, r * RIVER_RECORD_BYTES)
    const board = record.board.slice(0, 4).map((key) => deck[key] as Card)
    const range = (weights: Float32Array): RangeCombo[] =>
      holdings.flatMap((hole, index) => {
        const weight = weights[index] as number
        return weight > 0 ? [{ hole: hole as [Card, Card], weight }] : []
      })
    const turn: RiverSpot = {
      board,
      pot: record.pot,
      stack: record.stack,
      ranges: [range(record.ranges[0]), range(record.ranges[1])],
      betSizes: [],
      allIn: false,
      maxRaises: 0,
    }
    const checked = checkedDownValues(turn, turnRivers(board))
    values.set(checked[0], 2 * r * COMBOS)
    values.set(checked[1], (2 * r + 1) * COMBOS)
  }
  writeFileSync(`${out}.part`, values)
  renameSync(`${out}.part`, out)
  process.stderr.write(
    `worker ${worker}: ${name}, ${count} records, ${((Date.now() - started) / count).toFixed(0)} ms each\n`,
  )
}

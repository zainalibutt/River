import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Card, makeDeck } from '@river/engine'
import { COMBOS, decodeRiverRecord, RIVER_RECORD_BYTES } from './bot-river-value-data.js'
import { turnBucketIds, turnRivers } from './bot-turn-end-data.js'

// Usage: tsx bot-turn-buckets-run.ts <data dir> <worker> <workers> [strength bins] [potential bins]
//
// Writes each turn shard's two-dimensional bucket ids beside it (docs/bots.md):
// for X.bin, X.buckets<S>x<P> holds one row of 1,326 bytes per record, the
// holding's bucket by expected strength and potential (turnBucketIds), 255
// where the board blocks it. They depend only on each record's board, so the
// stored answers need no remaking. Shards are shared out by their place in
// name order; a finished side file is skipped.
const [dir, workerText, workersText, strengthText, potentialText] = process.argv.slice(2)
const worker = Number(workerText)
const workers = Number(workersText)
const strength = strengthText === undefined ? 32 : Number(strengthText)
const potential = potentialText === undefined ? 4 : Number(potentialText)
if (
  !dir ||
  ![worker, workers, strength, potential].every(Number.isSafeInteger) ||
  workers < 1 ||
  worker < 0 ||
  worker >= workers ||
  strength * potential > 255
) {
  throw new Error('usage: <data dir> <worker> <workers> [strength bins] [potential bins]')
}
const deck = makeDeck()
const shards = readdirSync(dir)
  .filter((name) => /-w\d\d-\d+\.bin$/.test(name))
  .sort()
for (const [place, name] of shards.entries()) {
  if (place % workers !== worker) continue
  const out = join(dir, name.replace(/\.bin$/, `.buckets${strength}x${potential}`))
  if (existsSync(out)) continue
  const bytes = new Uint8Array(readFileSync(join(dir, name)))
  const count = Math.floor(bytes.length / RIVER_RECORD_BYTES)
  const ids = new Uint8Array(count * COMBOS)
  for (let r = 0; r < count; r += 1) {
    const record = decodeRiverRecord(bytes, r * RIVER_RECORD_BYTES)
    const board = record.board.slice(0, 4).map((key) => deck[key] as Card)
    ids.set(turnBucketIds(turnRivers(board), strength, potential), r * COMBOS)
  }
  writeFileSync(`${out}.part`, ids)
  renameSync(`${out}.part`, out)
  process.stderr.write(`worker ${worker}: ${name}, ${count} records\n`)
}

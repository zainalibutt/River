import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Card, makeDeck } from '@river/engine'
import { flopBucketIds } from './bot-flop-buckets.js'
import { COMBOS, decodeRiverRecord, RIVER_RECORD_BYTES } from './bot-river-value-data.js'
import { turnRivers } from './bot-turn-end-data.js'

// Only operates on an explicitly prepared worktree snapshot; never writes source data.
// Each shard commits atomically. A source hash, algorithm version and output hash
// make restarts reject stale/corrupt caches, rather than silently trusting file size.
const [dir] = process.argv.slice(2)
if (!dir) throw new Error('usage: <D3 snapshot directory>')
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
if (manifest.kind !== 'flop-end' || manifest.d3Snapshot !== 1)
  throw new Error('requires D3 flop-end snapshot')
const deck = makeDeck()
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const started = Date.now()
for (const name of readdirSync(dir)
  .filter((n) => /^flopend-w\d+-\d+\.bin$/.test(n))
  .sort()) {
  const raw = readFileSync(join(dir, name))
  if (raw.length % RIVER_RECORD_BYTES !== 0) throw new Error(`incomplete shard ${name}`)
  const count = raw.length / RIVER_RECORD_BYTES
  const out = join(dir, name.replace(/\.bin$/, '.flop-buckets-v1-32x4'))
  const source = hash(raw)
  if (existsSync(out) && existsSync(`${out}.json`)) {
    const meta = JSON.parse(readFileSync(`${out}.json`, 'utf8'))
    const cached = readFileSync(out)
    if (
      meta.version === 1 &&
      meta.source === source &&
      meta.sha256 === hash(cached) &&
      cached.length === count * COMBOS
    )
      continue
  }
  const ids = new Uint8Array(count * COMBOS)
  for (let r = 0; r < count; r += 1) {
    const record = decodeRiverRecord(raw, r * RIVER_RECORD_BYTES)
    if (record.board[3] !== 255 || record.board[4] !== 255) throw new Error('not a flop record')
    const board = record.board.slice(0, 3).map((key) => deck[key] as Card)
    const next = turnRivers(board).rivers.map((river) => river.ranks)
    ids.set(flopBucketIds(record.strengthRank, next), r * COMBOS)
  }
  writeFileSync(`${out}.part`, ids)
  renameSync(`${out}.part`, out)
  writeFileSync(
    `${out}.json.part`,
    `${JSON.stringify({ version: 1, source, sha256: hash(ids) })}\n`,
  )
  renameSync(`${out}.json.part`, `${out}.json`)
  process.stdout.write(
    `${name}: ${count} rows; elapsed ${((Date.now() - started) / 1000).toFixed(1)} s\n`,
  )
}

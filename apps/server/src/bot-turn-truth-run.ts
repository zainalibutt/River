import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  encodeRiverRecord,
  RIVER_DATA_SETTINGS,
  RIVER_RECORD_BYTES,
  RIVER_RECORD_LAYOUT,
  sampleTurnEndSpot,
  solveTurnTruthRecord,
} from './bot-river-value-data.js'

// Usage: tsx bot-turn-truth-run.ts <out dir> <run seed> <worker> <shards> <spots a shard> [stop at, ms since 1970]
//
// One worker of v9's turn truth set (docs/bots.md): random spots at the end
// of the turn's betting, each worked out exactly by solving the river for
// every card that can come (solveTurnTruthRecord). They are the answers the
// turn-end network and the turn solver are checked against. Records use the
// river layout with the fifth board card 255. Shards, seeds and the stop time
// work as in bot-river-value-data-run.ts.
const [out, runSeed, workerText, shardsText, perShardText, stopText] = process.argv.slice(2)
const worker = Number(workerText)
const shards = Number(shardsText)
const perShard = Number(perShardText)
const stopAt = stopText === undefined ? Number.POSITIVE_INFINITY : Number(stopText)
if (
  !out ||
  !runSeed ||
  ![worker, shards, perShard].every(Number.isSafeInteger) ||
  worker < 0 ||
  worker > 65_535 ||
  shards < 1 ||
  perShard < 1 ||
  Number.isNaN(stopAt)
) {
  throw new Error(
    'usage: <out dir> <run seed> <worker> <shards> <spots a shard> [stop at, ms since 1970]',
  )
}
mkdirSync(out, { recursive: true })
const manifest = join(out, 'manifest.json')
if (worker === 0 && !existsSync(manifest)) {
  let commit = 'unknown'
  try {
    commit = execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    // Outside a checkout the manifest still describes the data.
  }
  writeFileSync(
    manifest,
    `${JSON.stringify(
      {
        kind: 'turn-truth',
        runSeed,
        spotSeed: '<run seed>:<worker>:<spot>',
        note: 'Turn spots at the end of the betting; the fifth board card is 255; values are averaged over every river card.',
        settings: RIVER_DATA_SETTINGS,
        recordBytes: RIVER_RECORD_BYTES,
        layout: RIVER_RECORD_LAYOUT,
        commit,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  )
}

const name = (shard: number) =>
  `turn-w${String(worker).padStart(2, '0')}-${String(shard).padStart(5, '0')}.bin`
for (let shard = 0; shard < shards; shard += 1) {
  const path = join(out, name(shard))
  if (existsSync(path)) continue
  if (Date.now() >= stopAt) break
  const started = Date.now()
  const bytes = new Uint8Array(perShard * RIVER_RECORD_BYTES)
  for (let i = 0; i < perShard; i += 1) {
    const n = shard * perShard + i
    const spot = sampleTurnEndSpot(`${runSeed}:${worker}:${n}`, RIVER_DATA_SETTINGS)
    const record = solveTurnTruthRecord(spot, RIVER_DATA_SETTINGS, { spot: n, worker })
    bytes.set(encodeRiverRecord(record), i * RIVER_RECORD_BYTES)
  }
  writeFileSync(`${path}.part`, bytes)
  renameSync(`${path}.part`, path)
  const seconds = (Date.now() - started) / 1000
  process.stderr.write(
    `worker ${worker} shard ${shard}: ${perShard} turn spots in ${seconds.toFixed(0)} s, ${(seconds / perShard).toFixed(0)} s a spot\n`,
  )
}

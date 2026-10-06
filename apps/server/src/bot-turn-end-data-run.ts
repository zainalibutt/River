import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  encodeRiverRecord,
  RIVER_DATA_SETTINGS,
  RIVER_RECORD_BYTES,
  RIVER_RECORD_LAYOUT,
  sampleTurnEndSpot,
} from './bot-river-value-data.js'
import { turnEndRecord } from './bot-turn-end-data.js'
import { type ValueNetworkDescription, valueNetworkFrom } from './bot-value-network.js'

// Usage: tsx bot-turn-end-data-run.ts <out dir> <run seed> <worker> <shards> <spots a shard> <river network, without .bin> [stop at, ms since 1970]
//
// One worker making training data for v9's turn-end network (docs/bots.md):
// random turn spots at the end of the turn's betting, each answered by the
// river network averaged over every river card (turnEndRecord). No solving,
// so it is quick. Records use the river layout: the fifth board card is 255
// and the rank row holds each holding's rank by expected strength. Shards,
// seeds and the stop time work as in bot-river-value-data-run.ts.
const [out, runSeed, workerText, shardsText, perShardText, model, stopText] = process.argv.slice(2)
const worker = Number(workerText)
const shards = Number(shardsText)
const perShard = Number(perShardText)
const stopAt = stopText === undefined ? Number.POSITIVE_INFINITY : Number(stopText)
if (
  !out ||
  !runSeed ||
  !model ||
  ![worker, shards, perShard].every(Number.isSafeInteger) ||
  worker < 0 ||
  worker > 65_535 ||
  shards < 1 ||
  perShard < 1 ||
  Number.isNaN(stopAt)
) {
  throw new Error(
    'usage: <out dir> <run seed> <worker> <shards> <spots a shard> <river network> [stop at, ms since 1970]',
  )
}
const description = JSON.parse(readFileSync(`${model}.json`, 'utf8')) as ValueNetworkDescription
const raw = readFileSync(`${model}.bin`)
const network = valueNetworkFrom(
  description,
  new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4),
)
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
        kind: 'turn-end',
        runSeed,
        spotSeed: '<run seed>:<worker>:<spot>',
        note: 'Turn spots where the betting ends; values are the river network averaged over every river card; the rank row ranks expected strength; the fifth board card is 255.',
        riverNetwork: model,
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
  `turnend-w${String(worker).padStart(2, '0')}-${String(shard).padStart(5, '0')}.bin`
for (let shard = 0; shard < shards; shard += 1) {
  const path = join(out, name(shard))
  if (existsSync(path)) continue
  if (Date.now() >= stopAt) break
  const started = Date.now()
  const bytes = new Uint8Array(perShard * RIVER_RECORD_BYTES)
  for (let i = 0; i < perShard; i += 1) {
    const n = shard * perShard + i
    const spot = sampleTurnEndSpot(`${runSeed}:${worker}:${n}`, RIVER_DATA_SETTINGS)
    bytes.set(
      encodeRiverRecord(turnEndRecord(spot, network, { spot: n, worker })),
      i * RIVER_RECORD_BYTES,
    )
  }
  writeFileSync(`${path}.part`, bytes)
  renameSync(`${path}.part`, path)
  const seconds = (Date.now() - started) / 1000
  process.stderr.write(
    `worker ${worker} shard ${shard}: ${perShard} turn spots in ${seconds.toFixed(0)} s, ${(perShard / seconds).toFixed(1)} a second\n`,
  )
}

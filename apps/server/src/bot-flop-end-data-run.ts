import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { FLOP_DATA_TURN, flopEndRecord } from './bot-flop-end-data.js'
import {
  encodeRiverRecord,
  RIVER_DATA_SETTINGS,
  RIVER_RECORD_BYTES,
  RIVER_RECORD_LAYOUT,
  sampleFlopEndSpot,
} from './bot-river-value-data.js'
import { loadValueNetwork } from './bot-value-network.js'

// Usage: tsx bot-flop-end-data-run.ts <out dir> <run seed> <worker> <shards> <spots a shard> <turn-end network, without .bin> <turn cards, 0 for all> [stop at, ms since 1970]
//
// One worker making training data for lane B's flop-end network: random flop
// spots at the end of the flop's betting, each answered by solving the turn
// with the turn-end network at its leaves for `turn cards` of the turn cards
// and averaging (flopEndRecord). Records use the river layout with the fourth
// and fifth board cards 255. Shards, seeds and the stop time work as in
// bot-river-value-data-run.ts.
const [out, runSeed, workerText, shardsText, perShardText, model, turnCardsText, stopText] =
  process.argv.slice(2)
const worker = Number(workerText)
const shards = Number(shardsText)
const perShard = Number(perShardText)
const turnCards = Number(turnCardsText)
const stopAt = stopText === undefined ? Number.POSITIVE_INFINITY : Number(stopText)
if (
  !out ||
  !runSeed ||
  !model ||
  ![worker, shards, perShard, turnCards].every(Number.isSafeInteger) ||
  worker < 0 ||
  worker > 65_535 ||
  shards < 1 ||
  perShard < 1 ||
  turnCards < 0 ||
  Number.isNaN(stopAt)
) {
  throw new Error(
    'usage: <out dir> <run seed> <worker> <shards> <spots a shard> <turn-end network> <turn cards, 0 for all> [stop at, ms since 1970]',
  )
}
const network = loadValueNetwork(model)
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
        kind: 'flop-end',
        runSeed,
        spotSeed: '<run seed>:<worker>:<spot>',
        note: 'Flop spots where the betting ends; values are the turn solved with the turn-end network at its leaves, averaged over the turn cards solved; the rank row ranks expected strength over the turn cards; the fourth and fifth board cards are 255.',
        turnNetwork: model.split(/[\\/]/).slice(-2).join('/'),
        turnCards,
        turn: FLOP_DATA_TURN,
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
  `flopend-w${String(worker).padStart(2, '0')}-${String(shard).padStart(5, '0')}.bin`
for (let shard = 0; shard < shards; shard += 1) {
  const path = join(out, name(shard))
  if (existsSync(path)) continue
  if (Date.now() >= stopAt) break
  const started = Date.now()
  const bytes = new Uint8Array(perShard * RIVER_RECORD_BYTES)
  for (let i = 0; i < perShard; i += 1) {
    const n = shard * perShard + i
    const seed = `${runSeed}:${worker}:${n}`
    const spot = sampleFlopEndSpot(seed, RIVER_DATA_SETTINGS)
    bytes.set(
      encodeRiverRecord(flopEndRecord(spot, network, turnCards, { seed, spot: n, worker })),
      i * RIVER_RECORD_BYTES,
    )
  }
  writeFileSync(`${path}.part`, bytes)
  renameSync(`${path}.part`, path)
  const seconds = (Date.now() - started) / 1000
  process.stderr.write(
    `worker ${worker} shard ${shard}: ${perShard} flop spots in ${seconds.toFixed(0)} s, ${(seconds / perShard).toFixed(1)} s a spot\n`,
  )
}

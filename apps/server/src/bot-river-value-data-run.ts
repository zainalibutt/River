import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  encodeRiverRecord,
  RIVER_DATA_SETTINGS,
  RIVER_RECORD_BYTES,
  RIVER_RECORD_LAYOUT,
  roundsFor,
  sampleRiverSpot,
  solveRiverRecord,
} from './bot-river-value-data.js'

// Usage: tsx bot-river-value-data-run.ts <out dir> <run seed> <worker> <shards> <spots a shard> [rounds] [deep rounds] [stop at, ms since 1970]
//
// One worker of the data factory for v9's river value network
// (docs/bots.md). It solves random river spots and writes them in shards.
// A shard goes to a .part file and is renamed when complete, so a stopped run
// loses at most the shard in progress and a rerun skips the shards it finds.
// Spot seeds are <run seed>:<worker>:<spot>, so any spot can be rebuilt. No
// shard starts after the stop time. Deep spots, with more than ten pots behind,
// get the deep rounds (roundsFor). One spot in twenty is also measured for how
// exploitable its solution is, as a running check on the answers.
const [out, runSeed, workerText, shardsText, perShardText, roundsText, deepText, stopText] =
  process.argv.slice(2)
const worker = Number(workerText)
const shards = Number(shardsText)
const perShard = Number(perShardText)
const rounds = roundsText === undefined ? RIVER_DATA_SETTINGS.iterations : Number(roundsText)
const deepRounds = deepText === undefined ? RIVER_DATA_SETTINGS.deepIterations : Number(deepText)
const stopAt = stopText === undefined ? Number.POSITIVE_INFINITY : Number(stopText)
if (
  !out ||
  !runSeed ||
  ![worker, shards, perShard, rounds, deepRounds].every(Number.isSafeInteger) ||
  worker < 0 ||
  worker > 65_535 ||
  shards < 1 ||
  perShard < 1 ||
  rounds < 1 ||
  rounds > 65_535 ||
  deepRounds < 1 ||
  deepRounds > 65_535 ||
  Number.isNaN(stopAt)
) {
  throw new Error(
    'usage: <out dir> <run seed> <worker> <shards> <spots a shard> [rounds] [deep rounds] [stop at, ms since 1970]',
  )
}
const settings = { ...RIVER_DATA_SETTINGS, iterations: rounds, deepIterations: deepRounds }
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
        runSeed,
        spotSeed: '<run seed>:<worker>:<spot>',
        settings,
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
  `river-w${String(worker).padStart(2, '0')}-${String(shard).padStart(5, '0')}.bin`
for (let shard = 0; shard < shards; shard += 1) {
  const path = join(out, name(shard))
  if (existsSync(path)) continue
  if (Date.now() >= stopAt) break
  const started = Date.now()
  const bytes = new Uint8Array(perShard * RIVER_RECORD_BYTES)
  let measured = 0
  let exploitable = 0
  for (let i = 0; i < perShard; i += 1) {
    const n = shard * perShard + i
    const spot = sampleRiverSpot(`${runSeed}:${worker}:${n}`, settings)
    const record = solveRiverRecord(spot, roundsFor(spot, settings), {
      spot: n,
      worker,
      measure: n % 20 === 0,
    })
    if (!Number.isNaN(record.exploitability)) {
      measured += 1
      exploitable += record.exploitability
    }
    bytes.set(encodeRiverRecord(record), i * RIVER_RECORD_BYTES)
  }
  writeFileSync(`${path}.part`, bytes)
  renameSync(`${path}.part`, path)
  const seconds = (Date.now() - started) / 1000
  const check =
    measured === 0
      ? 'not measured'
      : `${((exploitable / measured) * 100).toFixed(2)}% of the pot exploitable (${measured} measured)`
  process.stderr.write(
    `worker ${worker} shard ${shard}: ${perShard} spots in ${seconds.toFixed(0)} s, ${(perShard / seconds).toFixed(2)} a second, ${check}\n`,
  )
}

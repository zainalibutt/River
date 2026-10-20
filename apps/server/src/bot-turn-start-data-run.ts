import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { FLOP_DATA_TURN } from './bot-flop-end-data.js'
import {
  RIVER_DATA_SETTINGS,
  RIVER_RECORD_BYTES,
  sampleTurnEndSpot,
} from './bot-river-value-data.js'
import {
  encodeTurnStartRecord,
  TURN_START_RECORD_LAYOUT,
  TURN_START_TARGETS,
  type TurnStartLeaves,
  turnStartRecord,
  turnStartTarget,
} from './bot-turn-start-data.js'
import { loadValueNetwork } from './bot-value-network.js'

// Usage: tsx bot-turn-start-data-run.ts <out> <seed> <worker> <shards> <spots a shard>
//   <turn-end|per-river> [network stem, or - for environment] [stop at, ms since 1970]
// Environment: RIVER_TURN_NETWORK or RIVER_RIVER_NETWORK, according to teacher.
// STOP in the output directory or the deadline discards an unfinished shard;
// restarting repeats its exact seeds. Finished .bin shards are never overwritten.
const [out, runSeed, workerText, shardsText, perShardText, kind, modelText, stopText] =
  process.argv.slice(2)
const worker = Number(workerText)
const shards = Number(shardsText)
const perShard = Number(perShardText)
const stopAt = stopText === undefined ? Number.POSITIVE_INFINITY : Number(stopText)
const model =
  modelText && modelText !== '-'
    ? modelText
    : kind === 'turn-end'
      ? process.env.RIVER_TURN_NETWORK
      : process.env.RIVER_RIVER_NETWORK
if (
  !out ||
  !runSeed ||
  !model ||
  (kind !== 'turn-end' && kind !== 'per-river') ||
  ![worker, shards, perShard].every(Number.isSafeInteger) ||
  worker < 0 ||
  worker > 65_535 ||
  shards < 1 ||
  perShard < 1 ||
  shards * perShard > 0x1_0000_0000 ||
  Number.isNaN(stopAt)
) {
  throw new Error(
    'usage: <out> <seed> <worker> <shards> <spots a shard> <turn-end|per-river> [network stem or -] [stop at, ms since 1970]',
  )
}
const network = loadValueNetwork(model)
const leaves: TurnStartLeaves =
  kind === 'turn-end' ? { kind, network } : { kind, riverNetwork: network }
if (kind === 'per-river' && network.checked !== undefined) {
  throw new Error('per-river leaves need a river network without checked-down additions')
}
mkdirSync(out, { recursive: true })
const manifestPath = join(out, 'manifest.json')
const target = turnStartTarget(leaves)
const config = {
  kind: 'turn-start',
  target,
  targetCode: TURN_START_TARGETS[target],
  teacher: kind,
  network: resolve(model),
  runSeed,
  perShard,
  spotSeed: '<run seed>:<worker>:<spot>',
  turn: FLOP_DATA_TURN,
  settings: RIVER_DATA_SETTINGS,
  recordBytes: RIVER_RECORD_BYTES,
  layout: TURN_START_RECORD_LAYOUT,
}
// Publish a complete manifest atomically, so simultaneous workers never read half a JSON file.
const manifestPart = join(out, `manifest-w${worker}-${process.pid}.part`)
writeFileSync(
  manifestPart,
  `${JSON.stringify({ ...config, createdAt: new Date().toISOString() }, null, 2)}\n`,
  { flag: 'wx' },
)
try {
  linkSync(manifestPart, manifestPath)
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
} finally {
  unlinkSync(manifestPart)
}
const previous = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
for (const [key, value] of Object.entries(config)) {
  if (JSON.stringify(previous[key]) !== JSON.stringify(value)) {
    throw new Error(`manifest mismatch: ${key}; use a separate output directory`)
  }
}
const stopped = () => Date.now() >= stopAt || existsSync(join(out, 'STOP'))
for (let shard = 0; shard < shards; shard += 1) {
  const path = join(
    out,
    `turnstart-w${String(worker).padStart(2, '0')}-${String(shard).padStart(5, '0')}.bin`,
  )
  if (existsSync(path)) {
    if (statSync(path).size !== perShard * RIVER_RECORD_BYTES) {
      throw new Error(`wrong finished shard size: ${path}`)
    }
    continue
  }
  if (stopped()) break
  const started = performance.now()
  const bytes = new Uint8Array(perShard * RIVER_RECORD_BYTES)
  let complete = true
  for (let i = 0; i < perShard; i += 1) {
    if (stopped()) {
      complete = false
      break
    }
    const n = shard * perShard + i
    const spot = sampleTurnEndSpot(`${runSeed}:${worker}:${n}`, RIVER_DATA_SETTINGS)
    bytes.set(
      encodeTurnStartRecord(turnStartRecord(spot, leaves, { spot: n, worker })),
      i * RIVER_RECORD_BYTES,
    )
  }
  if (!complete || stopped()) break
  writeFileSync(`${path}.part`, bytes)
  renameSync(`${path}.part`, path)
  const seconds = (performance.now() - started) / 1000
  process.stderr.write(
    `worker ${worker} shard ${shard}: ${perShard} turn-start spots in ${seconds.toFixed(2)} s, ${(seconds / perShard).toFixed(3)} s a spot\n`,
  )
}

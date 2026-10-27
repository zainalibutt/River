import { createHash } from 'node:crypto'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { decodeRiverRecord, RIVER_RECORD_BYTES } from './bot-river-value-data.js'
import {
  loadTurnResidualNetwork,
  turnCardFeatures,
  turnResidualInputs,
  turnResidualPools,
} from './bot-turn-residual.js'
import { packDistillationFeatures } from './bot-turn-residual-distill.js'
import { bucketInputs, forwardBatch } from './bot-value-network.js'

// Factorised f32 cache: never materialise [spots, players, holdings, 65].
// Local [1128,34]: static19, blockers5/player, solver2, range weights2, bucket1.
// Shared [295]: logSPR, pools19/player, bucket values256. Same legal order/player.
const [cacheArg, outArg, teacher, probeArg] = process.argv.slice(2)
if (!cacheArg || !outArg || !teacher)
  throw new Error('usage: <d8-expanded> <new-packed-cache> <teacher-stem>')
const cache = resolve(cacheArg),
  out = resolve(outArg)
const probeLimit = probeArg === undefined ? Infinity : Number(probeArg)
if (
  probeArg !== undefined &&
  (!Number.isSafeInteger(probeLimit) || probeLimit < 1 || probeLimit > 10000)
)
  throw new Error('optional probe limit must be 1..10000; probe caches cannot train')
const rel = relative(process.cwd(), out)
if (!rel || rel.startsWith('..') || isAbsolute(rel))
  throw new Error('output must be below worktree')
if (existsSync(out)) throw new Error('packed cache must be a new directory')
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const meta = JSON.parse(readFileSync(join(cache, 'cache.json'), 'utf8'))
const snapshotRaw = readFileSync(join(cache, 'snapshot.json'))
const splitRaw = readFileSync(join(cache, 'split.json'))
if (sha(snapshotRaw) !== meta.snapshotSHA256 || sha(splitRaw) !== meta.splitFileSHA256)
  throw new Error('expanded cache changed')
const snapshot = JSON.parse(snapshotRaw.toString()) as {
  shards: { path: string; sha256: string; rows: number }[]
}
const split = JSON.parse(splitRaw.toString())
const model = loadTurnResidualNetwork(teacher)
const teacherMeta = JSON.parse(readFileSync(`${teacher}.json`, 'utf8'))
if (
  teacherMeta.joint !== false ||
  teacherMeta.splitSHA256 !== split.splitSHA256 ||
  teacherMeta.snapshotSHA256 !== meta.snapshotSHA256
)
  throw new Error('teacher must be frozen and match expanded cache')
mkdirSync(out, { recursive: true })
const keys = ['local', 'shared'] as const
const handles = keys.map((k) => openSync(join(out, `${k}.bin`), 'wx'))
const hashes = keys.map(() => createHash('sha256'))
const buffers = model.bucket.layers.map((l) => new Float32Array(l.rows))
const started = performance.now()
let spots = 0
try {
  shards: for (const shard of snapshot.shards) {
    const raw = readFileSync(shard.path)
    if (raw.length !== shard.rows * RIVER_RECORD_BYTES || sha(raw) !== shard.sha256)
      throw new Error('source shard changed')
    for (let i = 0; i < shard.rows; i++) {
      const record = decodeRiverRecord(
        raw.subarray(i * RIVER_RECORD_BYTES, (i + 1) * RIVER_RECORD_BYTES),
      )
      const cards = turnCardFeatures(record.board.slice(0, 4), record.strengthRank)
      if (cards.layout.live !== 1128) throw new Error('expected exactly 1128 legal turn holdings')
      const pools = turnResidualPools(cards, record.ranges)
      const base = forwardBatch(
        model.bucket,
        bucketInputs(cards.layout, record.ranges, record.stack, record.pot),
        1,
        buffers,
      )
      const features = turnResidualInputs(
        cards,
        record.ranges,
        base,
        record.stack,
        record.pot,
        undefined,
        pools,
        true,
      )
      const { local, shared } = packDistillationFeatures(
        cards,
        pools,
        base,
        features,
        record.values,
      )
      for (const [k, array] of [local, shared].entries()) {
        const bytes = Buffer.from(array.buffer)
        if (writeSync(handles[k] as number, bytes) !== bytes.length) throw new Error('short write')
        hashes[k]?.update(bytes)
      }
      spots++
      if (spots >= probeLimit) break shards
    }
    if (spots % 5000 === 0)
      process.stdout.write(
        `packed ${spots}/${meta.spots}, ${((performance.now() - started) / 1000).toFixed(1)}s\n`,
      )
  }
} finally {
  for (const fd of handles) closeSync(fd)
}
if (probeArg === undefined && spots !== meta.spots) throw new Error('spot count changed')
writeFileSync(
  join(out, 'packed.json'),
  `${JSON.stringify({ version: 1, complete: probeArg === undefined, holdingOrder: 'stride37', spots, legal: 1128, localWidth: 34, sharedWidth: 295, splitSHA256: split.splitSHA256, snapshotSHA256: meta.snapshotSHA256, teacherSHA256: sha(Buffer.concat(['.json', '-bucket.json', '-bucket.bin', '-head.json', '-head.bin'].map((suffix) => readFileSync(`${teacher}${suffix}`)))), sha256: Object.fromEntries(keys.map((k, i) => [k, hashes[i]?.digest('hex')])), seconds: (performance.now() - started) / 1000 }, null, 2)}\n`,
)

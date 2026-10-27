import { createHash } from 'node:crypto'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { COMBOS, decodeRiverRecord, RIVER_RECORD_BYTES } from './bot-river-value-data.js'
import {
  normaliseTurnRanges,
  TURN_RESIDUAL_INPUTS,
  TURN_STATIC_NAMES,
  turnCardFeatures,
  turnResidualInputs,
} from './bot-turn-residual.js'
import { historicalOrder } from './bot-turn-residual-split.js'
import { bucketInputs, forwardBatch, loadValueNetwork } from './bot-value-network.js'

const sha = (raw: Uint8Array | string) => createHash('sha256').update(raw).digest('hex')
export const C1_SPOTS = 53550
export const C1_SPLIT_SHA = 'e70b66b41f6d7c1dbf145e849efc3eed401cb6058e5abe77f5e8d2d2f62e4f1c'

export function expandedSplit(c2Spots: number) {
  if (!Number.isSafeInteger(c2Spots) || c2Spots < 20) throw new Error('need at least 20 c2 spots')
  const c1 = historicalOrder().order
  const c2 = historicalOrder(c2Spots).order.map((i) => i + C1_SPOTS)
  const testEnd = Math.floor(c2Spots / 10)
  const calibrationEnd = testEnd + Math.floor(c2Spots / 20)
  const testSets = { c1: c1.slice(0, 5355), c2: c2.slice(0, testEnd) }
  const calibrationSets = { c1: c1.slice(5355, 8032), c2: c2.slice(testEnd, calibrationEnd) }
  const training = [...c1.slice(8032), ...c2.slice(calibrationEnd)]
  const calibration = [...calibrationSets.c1, ...calibrationSets.c2]
  const test = [...testSets.c1, ...testSets.c2]
  return {
    version: 2,
    historicalSplitSHA256: C1_SPLIT_SHA,
    splitSHA256: sha(JSON.stringify({ training, calibration, testSets })),
    training,
    calibration,
    calibrationSets,
    test,
    testSets,
    seeds: [0, 1, 2],
  }
}

interface Shard {
  path: string
  sha256: string
  rows: number
}

export function checkHistoricalSplit(split: Record<string, unknown>) {
  const order = historicalOrder().order
  for (const [key, expected] of Object.entries({
    test: order.slice(0, 5355),
    calibration: order.slice(5355, 8032),
    training: order.slice(8032),
  })) {
    if (JSON.stringify(split[key]) !== JSON.stringify(expected))
      throw new Error(`c1 ${key} changed`)
  }
  if (split.splitSHA256 !== C1_SPLIT_SHA) throw new Error('c1 split hash changed')
}

export function claimSpot(seen: Set<string>, contents: Set<string>, seed: string, raw: Uint8Array) {
  const header = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  const identity = `${seed}:${header.getUint16(20, true)}:${header.getUint32(16, true)}`
  // Compare the generated spot, excluding worker IDs, timing and teacher output.
  // Re-encoded copies with a different namespace must not leak across the split.
  const content = createHash('sha256')
    .update(raw.subarray(0, 16))
    .update(raw.subarray(32, 32 + 8 * COMBOS))
    .digest('hex')
  if (seen.has(identity) || contents.has(content))
    throw new Error(`duplicate source spot ${identity}`)
  seen.add(identity)
  contents.add(content)
}

export function prepareExpanded(
  c1Cache: string,
  outArg: string,
  c2Sources: string[],
  bucketStem: string,
) {
  const out = resolve(outArg)
  const rel = relative(process.cwd(), out)
  if (!rel || rel.startsWith('..') || isAbsolute(rel))
    throw new Error('cache must be below worktree')
  const old = resolve(c1Cache)
  const overlap = (a: string, b: string) => {
    const r = relative(a, b)
    return !r || (!r.startsWith('..') && !isAbsolute(r))
  }
  if (overlap(old, out) || overlap(out, old)) throw new Error('keep the part-1 cache untouched')
  if (existsSync(out) && readdirSync(out).length)
    throw new Error('new cache must be empty; never overwrite')
  const oldRaw = readFileSync(join(old, 'snapshot.json'))
  const oldMeta = JSON.parse(readFileSync(join(old, 'cache.json'), 'utf8'))
  if (sha(oldRaw) !== oldMeta.snapshotSHA256) throw new Error('c1 snapshot hash changed')
  const oldSnapshot = JSON.parse(oldRaw.toString()) as {
    spots: number
    splitSHA256: string
    shards: Shard[]
  }
  checkHistoricalSplit(JSON.parse(readFileSync(join(old, 'split.json'), 'utf8')))
  if (oldSnapshot.spots !== C1_SPOTS || oldSnapshot.splitSHA256 !== C1_SPLIT_SHA)
    throw new Error('wrong c1 snapshot')
  if (!c2Sources.length) throw new Error('c2 sources required')
  const c1Paths = oldSnapshot.shards.map((s) => s.path)
  const c2Paths = c2Sources.flatMap((source) =>
    readdirSync(source)
      .filter((f) => /^turnstart-w\d+-\d+\.bin$/.test(f))
      .sort()
      .map((f) => join(source, f)),
  )
  const paths = [...c1Paths, ...c2Paths]
  const directories = [...new Set(paths.map((p) => dirname(resolve(p))))]
  for (const source of [...directories, dirname(resolve(bucketStem))])
    if (overlap(source, out) || overlap(out, source))
      throw new Error('cache must not overlap source data/checkpoints')
  const manifestHashes = new Map(
    directories.map((p) => [p, sha(readFileSync(join(p, 'manifest.json')))]),
  )
  const manifests = new Map(
    directories.map((p) => [p, JSON.parse(readFileSync(join(p, 'manifest.json'), 'utf8'))]),
  )
  const reference = manifests.get(directories[0] as string)
  let teacherHash: string | undefined
  for (const m of manifests.values()) {
    if (
      m.kind !== 'turn-start' ||
      m.target !== 'turn-start/per-river-v1' ||
      m.targetCode !== 2 ||
      m.recordBytes !== RIVER_RECORD_BYTES ||
      m.perShard !== 25 ||
      typeof m.runSeed !== 'string'
    )
      throw new Error('requires 25-spot per-river-v1 turn-start shards')
    for (const key of ['target', 'teacher', 'turn', 'settings', 'layout', 'spotSeed'])
      if (JSON.stringify(m[key]) !== JSON.stringify(reference[key]))
        throw new Error(`incompatible ${key}`)
    if (m.teacher !== 'per-river') throw new Error('wrong teacher')
    const hash = sha(
      Buffer.concat([readFileSync(`${m.network}.json`), readFileSync(`${m.network}.bin`)]),
    )
    if (teacherHash && teacherHash !== hash) throw new Error('teacher checkpoint changed')
    teacherHash = hash
  }
  const c1Seeds = new Set(c1Paths.map((p) => manifests.get(dirname(resolve(p))).runSeed))
  const c2Seeds = new Set(c2Paths.map((p) => manifests.get(dirname(resolve(p))).runSeed))
  if (c1Seeds.size !== 1 || c2Seeds.size !== 1 || c1Seeds.has([...c2Seeds][0]))
    throw new Error('expected distinct coherent c1/c2 seed namespaces')
  const counts = paths.map((p) => statSync(p).size / RIVER_RECORD_BYTES)
  if (counts.some((n) => n !== 25)) throw new Error('incomplete/non-25-spot shard')
  if (counts.slice(0, c1Paths.length).reduce((a, b) => a + b, 0) !== C1_SPOTS)
    throw new Error('c1 row ordering/count changed')
  const spots = counts.reduce((a, b) => a + b, 0)
  const split = expandedSplit(spots - C1_SPOTS)
  const bucketMeta = JSON.parse(readFileSync(`${bucketStem}.json`, 'utf8'))
  if (bucketMeta.splitSHA256 !== C1_SPLIT_SHA || bucketMeta.target !== reference.target)
    throw new Error('feature fixture bucket must match historical unseen split/target')
  const network = loadValueNetwork(bucketStem)
  if (network.buckets !== 128 || network.turnBuckets || network.checked)
    throw new Error('plain 128-bucket model required')
  mkdirSync(out, { recursive: true })
  const json = (name: string, value: unknown) =>
    writeFileSync(join(out, name), `${JSON.stringify(value, null, 2)}\n`)
  const keys = ['x', 'holding', 'bucket', 'y'] as const
  const handles = Object.fromEntries(keys.map((k) => [k, openSync(join(out, `${k}.bin`), 'wx')]))
  const hashes = Object.fromEntries(keys.map((k) => [k, createHash('sha256')]))
  const seen = new Set<string>(),
    contents = new Set<string>(),
    shards: Shard[] = [],
    examples: unknown[] = []
  const testC1 = new Set(split.testSets.c1)
  const started = performance.now()
  let row = 0
  try {
    for (const [index, path] of paths.entries()) {
      const raw = readFileSync(path)
      if (raw.length !== (counts[index] as number) * RIVER_RECORD_BYTES)
        throw new Error(`source size changed: ${path}`)
      const digest = sha(raw)
      if (
        index < c1Paths.length &&
        (digest !== oldSnapshot.shards[index]?.sha256 ||
          counts[index] !== oldSnapshot.shards[index]?.rows)
      )
        throw new Error(`c1 source changed: ${path}`)
      shards.push({ path: resolve(path), sha256: digest, rows: counts[index] as number })
      const seed = manifests.get(dirname(resolve(path))).runSeed
      for (let offset = 0; offset < raw.length; offset += RIVER_RECORD_BYTES, row++) {
        const bytes = raw.subarray(offset, offset + RIVER_RECORD_BYTES)
        if (bytes[4] !== 255 || bytes[5] !== 2) throw new Error('wrong street/target')
        claimSpot(seen, contents, seed, bytes)
        const r = decodeRiverRecord(bytes)
        const board = r.board.slice(0, 4)
        const cards = turnCardFeatures(board, r.strengthRank)
        const ranges = normaliseTurnRanges(cards, r.ranges)
        const input = bucketInputs(cards.layout, ranges, r.stack, r.pot)
        const local = turnResidualInputs(cards, ranges, new Float32Array(256), r.stack, r.pot)
        const holding = new Float32Array(2 * 16 * TURN_RESIDUAL_INPUTS)
        const bucket = new Uint8Array(32),
          y = new Float32Array(32)
        for (const p of [0, 1] as const) {
          let h = 0,
            cumulative = ranges[p][0] as number
          const shift = ((row * 1664525 + p * 1013904223) >>> 0) / 4294967296
          for (let j = 0; j < 16; j++) {
            while (h < COMBOS - 1 && cumulative <= (j + shift) / 16)
              cumulative += ranges[p][++h] as number
            const b = cards.layout.bucketOf[h] as number
            if (b < 0) throw new Error('sampled blocked holding')
            const at = p * 16 + j
            holding.set(
              local.subarray(
                (p * COMBOS + h) * TURN_RESIDUAL_INPUTS,
                (p * COMBOS + h + 1) * TURN_RESIDUAL_INPUTS,
              ),
              at * TURN_RESIDUAL_INPUTS,
            )
            bucket[at] = b
            y[at] = r.values[p][h] as number
          }
        }
        for (const [key, array] of Object.entries({ x: input, holding, bucket, y })) {
          const buffer = Buffer.from(array.buffer, array.byteOffset, array.byteLength)
          if (writeSync(handles[key] as number, buffer) !== buffer.length)
            throw new Error('short cache write')
          hashes[key]?.update(buffer)
        }
        if (examples.length < 4 && testC1.has(row)) {
          const values = forwardBatch(
            network,
            input,
            1,
            network.layers.map((l) => new Float32Array(l.rows)),
          )
          examples.push({
            board,
            ranks: [...r.strengthRank],
            ranges: ranges.map((x) => [...x]),
            stack: r.stack,
            pot: r.pot,
            static: [...cards.holding],
            bucket: [...cards.layout.bucketOf],
            inputs: [...input],
            bucketOutputs: [...values],
            residualInputs: [...turnResidualInputs(cards, ranges, values, r.stack, r.pot)],
          })
        }
      }
      if ((index + 1) % 200 === 0)
        process.stdout.write(
          `prepare: ${row}/${spots} spots, ${((performance.now() - started) / 1000).toFixed(1)}s\n`,
        )
    }
  } finally {
    for (const fd of Object.values(handles)) closeSync(fd)
  }
  for (const path of directories)
    if (sha(readFileSync(join(path, 'manifest.json'))) !== manifestHashes.get(path))
      throw new Error('source manifest changed during preparation')
  json('snapshot.json', {
    version: 2,
    target: reference.target,
    spots,
    c1Spots: C1_SPOTS,
    historicalSnapshotSHA256: sha(oldRaw),
    historicalSplitSHA256: C1_SPLIT_SHA,
    splitSHA256: split.splitSHA256,
    teacherSHA256: teacherHash,
    shards,
    manifests: [...manifests].map(([path, manifest]) => ({
      path,
      manifest,
      sha256: manifestHashes.get(path),
    })),
  })
  json('split.json', split)
  json('feature-cases.json', { version: 1, names: TURN_STATIC_NAMES, cases: examples })
  // Completion marker last. A partial preparation is never reusable.
  json('cache.json', {
    version: 2,
    spots,
    samples: 16,
    inputs: TURN_RESIDUAL_INPUTS,
    sha256: Object.fromEntries(keys.map((k) => [k, hashes[k]?.digest('hex')])),
    snapshotSHA256: sha(readFileSync(join(out, 'snapshot.json'))),
    splitFileSHA256: sha(readFileSync(join(out, 'split.json'))),
    featureSHA256: sha(readFileSync(join(out, 'feature-cases.json'))),
    seconds: (performance.now() - started) / 1000,
    testSpots: { c1: split.testSets.c1.length, c2: split.testSets.c2.length },
  })
  process.stdout.write(
    `Prepared ${spots} spots; test c1=${split.testSets.c1.length}, c2=${split.testSets.c2.length}\n`,
  )
}

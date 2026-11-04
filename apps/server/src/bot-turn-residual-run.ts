import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { COMBOS, decodeRiverRecord, RIVER_RECORD_BYTES } from './bot-river-value-data.js'
import {
  normaliseTurnRanges,
  TURN_RESIDUAL_INPUTS,
  TURN_STATIC,
  TURN_STATIC_NAMES,
  turnCardFeatures,
  turnResidualInputs,
} from './bot-turn-residual.js'
import { historicalOrder } from './bot-turn-residual-split.js'
import { bucketInputs, forwardBatch, loadValueNetwork } from './bot-value-network.js'

// Read-only source data; all generated output must stay in this worktree.
const [mode, outArg, ...sources] = process.argv.slice(2)
if (!outArg || !sources.length || !['diagnose', 'prepare'].includes(mode ?? '')) {
  throw new Error('usage: <diagnose|prepare> <out> <source> ...; D8_BUCKET_MODEL=<stem>')
}
const out = resolve(outArg)
const rel = relative(process.cwd(), out)
if (rel.startsWith('..') || isAbsolute(rel) || resolve(out) === resolve(process.cwd()))
  throw new Error('output must be below worktree')
mkdirSync(out, { recursive: true })
const sha = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')
const json = (name: string, value: unknown) =>
  writeFileSync(join(out, name), `${JSON.stringify(value, null, 2)}\n`)
const manifests = sources.map((s) => JSON.parse(readFileSync(join(s, 'manifest.json'), 'utf8')))
for (const m of manifests) {
  if (
    m.kind !== 'turn-start' ||
    m.target !== 'turn-start/per-river-v1' ||
    m.recordBytes !== RIVER_RECORD_BYTES
  )
    throw new Error('requires coherent per-river turn-start data')
  for (const key of ['runSeed', 'target', 'turn', 'settings', 'layout'])
    if (JSON.stringify(m[key]) !== JSON.stringify(manifests[0][key]))
      throw new Error(`incompatible ${key}`)
}
const paths = sources.flatMap((s) =>
  readdirSync(s)
    .filter((f) => /^turnstart-w\d+-\d+\.bin$/.test(f))
    .sort()
    .map((f) => join(s, f)),
)
const { order, sha256 } = historicalOrder()
const test = new Set(order.slice(0, 5355))
const split = {
  version: 1,
  splitSHA256: sha256,
  training: order.slice(8032),
  calibration: order.slice(5355, 8032),
  test: order.slice(0, 5355),
  seeds: [0, 1, 2],
  epochs: 50,
}
const priorSnapshot =
  mode === 'prepare'
    ? (JSON.parse(readFileSync(join(out, 'snapshot.json'), 'utf8')) as {
        shards: { path: string; sha256: string }[]
      })
    : undefined
const modelStem = process.env.D8_BUCKET_MODEL
if (mode === 'diagnose' && !modelStem) throw new Error('D8_BUCKET_MODEL required')
const modelHashes = modelStem
  ? { json: sha(readFileSync(`${modelStem}.json`)), bin: sha(readFileSync(`${modelStem}.bin`)) }
  : undefined
if (modelStem) {
  const meta = JSON.parse(readFileSync(`${modelStem}.json`, 'utf8'))
  if (meta.splitSHA256 !== sha256 || meta.target !== 'turn-start/per-river-v1')
    throw new Error('saved model does not match the frozen unseen split/target')
}
const network = modelStem ? loadValueNetwork(modelStem) : undefined
if (network && (network.buckets !== 128 || network.turnBuckets || network.checked))
  throw new Error('requires plain 128-bucket model')
const metrics = new Map<
  string,
  {
    spots: number
    mass: number
    total: number
    floor: number
    fit: number
    totalMSE: number
    floorMSE: number
    fitMSE: number
  }
>()
const hashes: { path: string; sha256: string; rows: number }[] = []
const seen = new Set<string>()
const examples: unknown[] = []
let row = 0
const samples = 16
let cacheRows: number[] = []
let cacheX: number[] = [],
  cacheHolding: number[] = [],
  cacheBucket: number[] = [],
  cacheY: number[] = []
let part = 0
function flush() {
  if (!cacheRows.length) return
  const prefix = `sample-${String(part++).padStart(5, '0')}`
  const cacheHashes: Record<string, string> = {}
  for (const [name, values] of Object.entries({ x: cacheX, holding: cacheHolding, y: cacheY })) {
    const raw = Buffer.from(Float32Array.from(values).buffer)
    writeFileSync(join(out, `${prefix}-${name}.bin`), raw)
    cacheHashes[name] = sha(raw)
  }
  const ids = Buffer.from(Uint8Array.from(cacheBucket))
  writeFileSync(join(out, `${prefix}-bucket.bin`), ids)
  cacheHashes.bucket = sha(ids)
  json(`${prefix}.json`, {
    rows: cacheRows,
    samples,
    inputs: TURN_RESIDUAL_INPUTS,
    sha256: cacheHashes,
  })
  cacheRows = []
  cacheX = []
  cacheHolding = []
  cacheBucket = []
  cacheY = []
}
const started = performance.now()
for (const path of paths) {
  const raw = readFileSync(path)
  if (raw.length % RIVER_RECORD_BYTES) throw new Error(`incomplete shard ${path}`)
  const hash = sha(raw)
  hashes.push({ path: resolve(path), sha256: hash, rows: raw.length / RIVER_RECORD_BYTES })
  if (priorSnapshot && priorSnapshot.shards[hashes.length - 1]?.sha256 !== hash)
    throw new Error(`source changed: ${path}`)
  for (let offset = 0; offset < raw.length; offset += RIVER_RECORD_BYTES, row++) {
    if (raw[offset + 5] !== 2 || raw[offset + 4] !== 255) throw new Error('wrong target/street')
    const r = decodeRiverRecord(raw, offset)
    const id = `${manifests[0].runSeed}:${r.worker}:${r.spot}`
    if (seen.has(id)) throw new Error(`duplicate source identity ${id}`)
    seen.add(id)
    if (mode === 'diagnose' && !test.has(row)) continue
    const board = r.board.slice(0, 4)
    const cards = turnCardFeatures(board, r.strengthRank)
    const ranges = normaliseTurnRanges(cards, r.ranges)
    const input = bucketInputs(cards.layout, ranges, r.stack, r.pot)
    if (mode === 'prepare') {
      // Uniform stratified quantiles sample each player's own range; matching
      // models use the SAME frozen samples, so both minimise held-hand loss.
      const features = turnResidualInputs(cards, ranges, new Float32Array(256), r.stack, r.pot)
      cacheRows.push(row)
      cacheX.push(...input)
      for (const p of [0, 1] as const) {
        let h = 0,
          cumulative = ranges[p][0] as number
        // Deterministic per-row/player offset; no test labels select samples.
        const shift = ((row * 1664525 + p * 1013904223) >>> 0) / 4294967296
        for (let j = 0; j < samples; j++) {
          const q = (j + shift) / samples
          while (h < COMBOS - 1 && cumulative <= q) cumulative += ranges[p][++h] as number
          const b = cards.layout.bucketOf[h] as number
          if (b < 0) throw new Error('sampled blocked holding')
          cacheHolding.push(
            ...features.subarray(
              (p * COMBOS + h) * TURN_RESIDUAL_INPUTS,
              (p * COMBOS + h + 1) * TURN_RESIDUAL_INPUTS,
            ),
          )
          cacheBucket.push(b)
          cacheY.push(r.values[p][h] as number)
        }
      }
      // Exact all-holding evaluation is streamed from source records by Python;
      // the sampled cache is used ONLY for optimisation, never reported test MAE.
      if (cacheRows.length >= 250) flush()
      continue
    }
    if (!network) throw new Error('diagnostic requires bucket network')
    const bucket = forwardBatch(
      network,
      input,
      1,
      network.layers.map((l) => new Float32Array(l.rows)),
    )
    const target = new Float64Array(256),
      mass = new Float64Array(256)
    for (const p of [0, 1] as const)
      for (let h = 0; h < COMBOS; h++) {
        const b = cards.layout.bucketOf[h] as number
        if (b < 0) continue
        const at = p * 128 + b,
          w = ranges[p][h] as number
        target[at] = (target[at] as number) + w * (r.values[p][h] as number)
        mass[at] = (mass[at] as number) + w
      }
    for (let b = 0; b < 256; b++)
      if ((mass[b] as number) > 0) target[b] = (target[b] as number) / (mass[b] as number)
    const boardSlices = [
      'all',
      cards.holding.find((_, i) => i % TURN_STATIC === 16 && cards.holding[i] === 1) !== undefined
        ? 'board:paired'
        : 'board:unpaired',
    ]
    const suits = [0, 0, 0, 0]
    for (const k of board) suits[Math.floor(k / 13)] = (suits[Math.floor(k / 13)] as number) + 1
    boardSlices.push(
      `board:${Math.max(...suits) >= 3 ? 'monotone' : Math.max(...suits) === 2 ? 'two-tone' : 'rainbow'}`,
    )
    const ranks = new Set(board.map((k) => k % 13))
    let connected = false
    for (let lo = -1; lo <= 8; lo++) {
      let n = 0
      for (let k = 0; k < 5; k++) n += Number(ranks.has((lo + k + 13) % 13))
      if (n >= 3) connected = true
    }
    boardSlices.push(`board:${connected ? 'connected' : 'disconnected'}`)
    if (r.stack / r.pot > 10) boardSlices.push('stack:over10pots')
    const touched = new Set<string>()
    for (const p of [0, 1] as const)
      for (let h = 0; h < COMBOS; h++) {
        const b = cards.layout.bucketOf[h] as number
        if (b < 0) continue
        const at = p * 128 + b,
          f = h * TURN_STATIC
        const made = Math.round((cards.holding[f + 3] as number) * 8)
        const slices = [
          ...boardSlices,
          `holding:${made === 0 ? 'high-card' : made === 1 ? 'pair' : made === 2 ? 'two-pair' : 'trips-or-better'}`,
        ]
        if (cards.holding[f + 4]) slices.push('holding:flush-draw')
        if (cards.holding[f + 5]) slices.push('holding:straight-draw')
        if (cards.holding[f + 12]) slices.push('holding:nut-flush-blocker')
        const total = (bucket[at] as number) - (r.values[p][h] as number)
        const floor = (target[at] as number) - (r.values[p][h] as number)
        const fit = (bucket[at] as number) - (target[at] as number)
        const w = (ranges[p][h] as number) / 2
        for (const name of slices) {
          let m = metrics.get(name)
          if (!m) {
            m = {
              spots: 0,
              mass: 0,
              total: 0,
              floor: 0,
              fit: 0,
              totalMSE: 0,
              floorMSE: 0,
              fitMSE: 0,
            }
            metrics.set(name, m)
          }
          if (!touched.has(name)) {
            m.spots++
            touched.add(name)
          }
          m.mass += w
          m.total += w * Math.abs(total)
          m.floor += w * Math.abs(floor)
          m.fit += w * Math.abs(fit)
          m.totalMSE += w * total * total
          m.floorMSE += w * floor * floor
          m.fitMSE += w * fit * fit
        }
      }
    if (examples.length < 4)
      examples.push({
        board,
        ranks: [...r.strengthRank],
        ranges: ranges.map((x) => [...x]),
        stack: r.stack,
        pot: r.pot,
        static: [...cards.holding],
        bucket: [...cards.layout.bucketOf],
        inputs: [...input],
        bucketOutputs: [...bucket],
        residualInputs: [...turnResidualInputs(cards, ranges, bucket, r.stack, r.pot)],
      })
  }
  if (hashes.length % 200 === 0)
    process.stdout.write(
      `${mode}: ${row} rows, ${((performance.now() - started) / 1000).toFixed(1)}s\n`,
    )
}
if (row !== 53550) throw new Error(`expected 53550 rows, got ${row}`)
if (priorSnapshot && hashes.length !== priorSnapshot.shards.length)
  throw new Error('source shard set changed')
flush()
json('split.json', split)
if (mode === 'diagnose') {
  json('snapshot.json', {
    target: manifests[0].target,
    spots: row,
    splitSHA256: sha256,
    shards: hashes,
  })
  json('feature-cases.json', { version: 1, names: TURN_STATIC_NAMES, cases: examples })
  const report = Object.fromEntries(
    [...metrics].map(([name, m]) => [
      name,
      {
        spots: m.spots,
        heldMass: m.mass,
        maePct: (100 * m.total) / m.mass,
        projectionPct: (100 * m.floor) / m.mass,
        fittingPct: (100 * m.fit) / m.mass,
        mse: m.totalMSE / m.mass,
        projectionMSE: m.floorMSE / m.mass,
        fittingMSE: m.fitMSE / m.mass,
      },
    ]),
  )
  json('diagnostic.json', {
    model: modelStem,
    modelSHA256: modelHashes,
    splitSHA256: sha256,
    testSpots: test.size,
    seconds: (performance.now() - started) / 1000,
    note: 'MAEs do not add. Range-weighted MSE decomposes exactly overall; conditional holding slices can have covariance.',
    slices: report,
  })
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} else
  json('cache.json', {
    version: 1,
    spots: row,
    samples,
    inputs: TURN_RESIDUAL_INPUTS,
    parts: part,
    snapshotSHA256: sha(readFileSync(join(out, 'snapshot.json'))),
    suitAugmentation: 'All 24 suit relabellings tied by invariant features; no raw suit IDs.',
  })

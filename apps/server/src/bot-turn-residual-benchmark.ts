import { readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { mulberry32 } from '@river/engine'
import {
  loadTurnResidualNetwork,
  TURN_RESIDUAL_INPUTS,
  turnCardFeatures,
  turnResidualInputs,
  turnResidualPools,
  turnResidualValues,
} from './bot-turn-residual.js'
import {
  bucketInputs,
  forwardBatch,
  loadValueNetwork,
  type RiverValueNetwork,
} from './bot-value-network.js'
import { valueNetworkBackend, valueNetworkThreads } from './bot-value-simd.js'

const [fixturePath, modelStem, reportPath, hiddenArg = '16', layersArg = '1'] =
  process.argv.slice(2)
if (!fixturePath)
  throw new Error(
    'usage: <feature-cases.json> [trained-residual-stem]; D8_BUCKET_MODEL=<baseline-stem>',
  )
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
  cases: {
    board: number[]
    ranks: number[]
    ranges: [number[], number[]]
    stack: number
    pot: number
  }[]
}
const c = fixture.cases[0]
if (!c) throw new Error('empty fixture')
const rng = mulberry32(8)
const hidden = Number(hiddenArg),
  depth = Number(layersArg)
if (!Number.isSafeInteger(hidden) || hidden < 1 || ![1, 2, 3].includes(depth))
  throw new Error('invalid benchmark head dimensions')
const head: RiverValueNetwork = {
  buckets: 128,
  layers: [
    ...Array.from({ length: depth }, (_, i) => ({
      columns: i === 0 ? TURN_RESIDUAL_INPUTS : hidden,
      rows: hidden,
      slope: 0.25,
    })),
    { columns: hidden, rows: 1, slope: null },
  ].map((l) => ({
    ...l,
    weight: Float32Array.from({ length: l.rows * l.columns }, () => (rng() - 0.5) * 0.02),
    bias: new Float32Array(l.rows).fill(0.01),
  })),
}
const baseline = process.env.D8_BUCKET_MODEL
if ((!modelStem || modelStem === '-') && !baseline) throw new Error('model stem required')
const trained = Boolean(modelStem && modelStem !== '-')
const model = trained
  ? loadTurnResidualNetwork(modelStem as string)
  : { bucket: loadValueNetwork(baseline as string), residual: head }
const cards = turnCardFeatures(c.board, Uint16Array.from(c.ranks))
const input = bucketInputs(cards.layout, c.ranges, c.stack, c.pot)
const buffers = model.bucket.layers.map((l) => new Float32Array(l.rows))
const base = forwardBatch(model.bucket, input, 1, buffers)
const pooled = turnResidualPools(cards, c.ranges)
const local = turnResidualInputs(cards, c.ranges, base, c.stack, c.pot)
const headBuffers = model.residual.layers.map((l) => new Float32Array(2652 * l.rows))
const compact = turnResidualInputs(cards, c.ranges, base, c.stack, c.pot, undefined, pooled, true)
const compactBuffers = model.residual.layers.map(
  (l) => new Float32Array(2 * cards.layout.live * l.rows),
)
function measure(fn: () => unknown) {
  for (let i = 0; i < 100; i++) fn()
  const times = []
  for (let i = 0; i < 50; i++) {
    const t = performance.now()
    fn()
    times.push((performance.now() - t) * 1000)
  }
  times.sort((a, b) => a - b)
  return {
    meanUs: times.reduce((a, b) => a + b, 0) / times.length,
    medianUs: times[25],
    p95Us: times[47],
  }
}
const bucket = measure(() => forwardBatch(model.bucket, input, 1, buffers))
const residual = measure(() => turnResidualValues(model, cards, c.ranges, c.stack, c.pot))
const prepareCards = measure(() => turnCardFeatures(c.board, Uint16Array.from(c.ranks)))
const pools = measure(() => turnResidualPools(cards, c.ranges))
const features = measure(() =>
  turnResidualInputs(cards, c.ranges, base, c.stack, c.pot, local, pooled),
)
const headMatmuls = measure(() => forwardBatch(model.residual, local, 2652, headBuffers))
const compactHeadMatmuls = measure(() =>
  forwardBatch(model.residual, compact, 2 * cards.layout.live, compactBuffers),
)
const fullResidual = measure(() => {
  const b = forwardBatch(
    model.bucket,
    bucketInputs(cards.layout, c.ranges, c.stack, c.pot),
    1,
    buffers,
  )
  turnResidualInputs(cards, c.ranges, b, c.stack, c.pot, local)
  forwardBatch(model.residual, local, 2652, headBuffers)
})
const bucketFeatures = measure(() => bucketInputs(cards.layout, c.ranges, c.stack, c.pot))
const report = {
  trainedResidual: trained,
  backend: valueNetworkBackend(model.residual),
  bucketBackend: valueNetworkBackend(model.bucket),
  threads: valueNetworkThreads(model.residual),
  headShape: [model.residual.layers[0]?.columns, ...model.residual.layers.map((l) => l.rows)],
  warmups: 100,
  iterations: 50,
  note: 'Microseconds per spot on the first real fixture. At most two CPU cores, one inference participant. Residual: both players, all legal holdings, pools and both forwards with card features cached. fullResidual: uncompressed 2652-row reference, current kernel. Card preparation excludes existing expected-strength rank computation. CPU timings depend on host hardware.',
  bucket,
  residual,
  prepareCards,
  pools,
  features,
  headMatmuls,
  compactHeadMatmuls,
  fullResidual,
  bucketFeatures,
}
const json = `${JSON.stringify(report, null, 2)}\n`
if (reportPath) {
  const rel = relative(process.cwd(), resolve(reportPath))
  if (rel.startsWith('..') || isAbsolute(rel) || !rel) throw new Error('report must be in worktree')
  writeFileSync(reportPath, json)
}
process.stdout.write(json)

import { readFileSync } from 'node:fs'
import { mulberry32 } from '@river/engine'
import {
  loadTurnResidualNetwork,
  TURN_RESIDUAL_INPUTS,
  turnCardFeatures,
  turnResidualValues,
} from './bot-turn-residual.js'
import {
  bucketInputs,
  forwardBatch,
  loadValueNetwork,
  type RiverValueNetwork,
} from './bot-value-network.js'

const [fixturePath, modelStem] = process.argv.slice(2)
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
const head: RiverValueNetwork = {
  buckets: 128,
  layers: [
    { columns: TURN_RESIDUAL_INPUTS, rows: 16, slope: 0.25 },
    { columns: 16, rows: 1, slope: null },
  ].map((l) => ({
    ...l,
    weight: Float32Array.from({ length: l.rows * l.columns }, () => (rng() - 0.5) * 0.02),
    bias: new Float32Array(l.rows).fill(0.01),
  })),
}
const baseline = process.env.D8_BUCKET_MODEL
if (!modelStem && !baseline) throw new Error('model stem required')
const model = modelStem
  ? loadTurnResidualNetwork(modelStem)
  : { bucket: loadValueNetwork(baseline as string), residual: head }
const cards = turnCardFeatures(c.board, Uint16Array.from(c.ranks))
const input = bucketInputs(cards.layout, c.ranges, c.stack, c.pot)
const buffers = model.bucket.layers.map((l) => new Float32Array(l.rows))
function measure(fn: () => unknown) {
  for (let i = 0; i < 50; i++) fn()
  const times = []
  for (let i = 0; i < 300; i++) {
    const t = performance.now()
    fn()
    times.push((performance.now() - t) * 1000)
  }
  times.sort((a, b) => a - b)
  return {
    meanUs: times.reduce((a, b) => a + b, 0) / times.length,
    medianUs: times[150],
    p95Us: times[285],
  }
}
const bucket = measure(() => forwardBatch(model.bucket, input, 1, buffers))
const residual = measure(() => turnResidualValues(model, cards, c.ranges, c.stack, c.pot))
const prepareCards = measure(() => turnCardFeatures(c.board, Uint16Array.from(c.ranks)))
process.stdout.write(
  `${JSON.stringify({ trainedResidual: Boolean(modelStem), note: 'One CPU inference thread. Baseline: bucket forward only. Residual: all 2652 holdings, range features, pools and both forwards with card features cached. Card preparation excludes existing expected-strength rank computation.', bucket, residual, prepareCards }, null, 2)}\n`,
)

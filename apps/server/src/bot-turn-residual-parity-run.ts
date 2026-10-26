import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { COMBOS } from './bot-river-value-data.js'
import {
  loadTurnResidualNetwork,
  turnCardFeatures,
  turnResidualInputs,
  turnResidualValues,
} from './bot-turn-residual.js'
import { bucketInputs, forwardBatch } from './bot-value-network.js'

const [file] = process.argv.slice(2)
if (!file) throw new Error('usage: <export_turn_residual_parity.py fixture>')
const fixture = JSON.parse(readFileSync(file, 'utf8')) as {
  model: string
  cases: {
    board: number[]
    ranks: number[]
    ranges: [number[], number[]]
    stack: number
    pot: number
    static: number[]
    inputs: number[]
    values: number[][]
  }[]
}
const network = loadTurnResidualNetwork(fixture.model)
let featureMax = 0,
  outputMax = 0,
  mutationMax = 0
for (const c of fixture.cases) {
  const cards = turnCardFeatures(c.board, Uint16Array.from(c.ranks))
  const baseInput = bucketInputs(cards.layout, c.ranges, c.stack, c.pot)
  const base = forwardBatch(
    network.bucket,
    baseInput,
    1,
    network.bucket.layers.map((l) => new Float32Array(l.rows)),
  )
  const input = turnResidualInputs(cards, c.ranges, base, c.stack, c.pot)
  cards.holding.forEach((v, i) => {
    featureMax = Math.max(featureMax, Math.abs(v - (c.static[i] as number)))
  })
  input.forEach((v, i) => {
    featureMax = Math.max(featureMax, Math.abs(v - (c.inputs[i] as number)))
  })
  const values = turnResidualValues(network, cards, c.ranges, c.stack, c.pot)
  const dropped = turnResidualValues(network, cards, c.ranges, c.stack, c.pot, true)
  for (const p of [0, 1] as const)
    for (let h = 0; h < COMBOS; h++) {
      outputMax = Math.max(
        outputMax,
        Math.abs((values[p][h] as number) - (c.values[p]?.[h] as number)),
      )
      mutationMax = Math.max(
        mutationMax,
        Math.abs((values[p][h] as number) - (dropped[p][h] as number)),
      )
    }
}
assert.ok(fixture.cases.length >= 5)
assert.ok(featureMax <= 1e-5, `feature error ${featureMax}`)
assert.ok(outputMax <= 1e-5, `PyTorch output error ${outputMax}`)
assert.ok(mutationMax > 1e-6, 'dropping trained residual did not change outputs')
const result = {
  cases: fixture.cases.length,
  featureMax,
  outputMax,
  mutationMax,
  backend: process.env.RIVER_VALUE_BACKEND ?? 'auto',
}
process.stdout.write(`${JSON.stringify(result)}\n`)

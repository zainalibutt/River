import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { type Card, makeDeck } from '@river/engine'
import { flopLayout } from './bot-flop-buckets.js'
import { bucketInputs, forward, holdingValues, loadValueNetwork } from './bot-value-network.js'

const [file] = process.argv.slice(2)
if (!file) throw new Error('usage: <ml/export_value_parity.py --d3-model fixture>')
const fixture = JSON.parse(readFileSync(file, 'utf8')) as {
  model: string
  cases: {
    board: number[]
    ranks: number[]
    ranges: [number[], number[]]
    pot: number
    stack: number
    bucket: number[]
    inputs: number[]
    outputs: number[]
  }[]
}
const network = loadValueNetwork(fixture.model)
const deck = makeDeck()
let maxInput = 0
let maxOutput = 0
for (const example of fixture.cases) {
  const layout = flopLayout(
    example.board.map((key) => deck[key] as Card),
    Uint16Array.from(example.ranks),
    network,
  )
  assert.deepEqual([...layout.bucketOf], example.bucket, 'bucket ids differ')
  const input = bucketInputs(layout, example.ranges, example.stack, example.pot)
  assert.equal(input.length, example.inputs.length)
  input.forEach((v, i) => {
    const error = Math.abs(v - (example.inputs[i] as number))
    maxInput = Math.max(maxInput, error)
    assert.ok(error <= 2e-6 * Math.max(1, Math.abs(v)), `input ${i}: ${error}`)
  })
  const predicted = forward(network, input)
  assert.equal(predicted.length, example.outputs.length)
  predicted.forEach((v, i) => {
    const error = Math.abs(v - (example.outputs[i] as number))
    maxOutput = Math.max(maxOutput, error)
    assert.ok(error <= 2e-5 * Math.max(1, Math.abs(v)), `PyTorch output ${i}: ${error}`)
  })
  const values = holdingValues(network, layout, input)
  for (let h = 0; h < layout.bucketOf.length; h += 1) {
    const b = example.bucket[h] as number
    for (const p of [0, 1] as const) {
      const expected = b < 0 ? 0 : (example.outputs[p * network.buckets + b] as number)
      assert.ok(
        Math.abs((values[p][h] as number) - expected) <= 2e-5 * Math.max(1, Math.abs(expected)),
      )
    }
  }
}
assert.ok(fixture.cases.length > 0)
process.stdout.write(
  `${fixture.cases.length} parity cases; max input ${maxInput}; max output ${maxOutput}\n`,
)

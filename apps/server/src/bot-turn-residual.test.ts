import { type Card, cardKey, evaluateBest, makeDeck, parseCard } from '@river/engine'
import { describe, expect, it } from 'vitest'
import { COMBOS, comboIndex52 } from './bot-river-value-data.js'
import { HOLDING_CARDS } from './bot-turn-end-data.js'
import {
  loadTurnResidualNetwork,
  permuteHolding,
  TURN_RESIDUAL_INPUTS,
  TURN_STATIC,
  turnCardFeatures,
  turnResidualInputs,
  turnResidualValues,
} from './bot-turn-residual.js'
import { historicalOrder } from './bot-turn-residual-split.js'
import { forward, type RiverValueNetwork } from './bot-value-network.js'
import { valueNetworkBackend } from './bot-value-simd.js'

const keys = (text: string) => text.split(' ').map((c) => cardKey(parseCard(c)))
const holding = (text: string) => {
  const k = keys(text)
  return comboIndex52(k[0] as number, k[1] as number)
}
function legalRanks(board: readonly number[]) {
  return Uint16Array.from(HOLDING_CARDS, ([a, b]) =>
    board.includes(a) || board.includes(b) ? 0 : 1,
  )
}
function constant(inputs: number, outputs: number, value: number): RiverValueNetwork {
  return {
    buckets: 128,
    layers: [
      {
        columns: inputs,
        rows: outputs,
        weight: new Float32Array(inputs * outputs),
        bias: new Float32Array(outputs).fill(value),
        slope: null,
      },
    ],
  }
}

describe('D8 turn-start residual', () => {
  it.each(['ts', 'wasm'])(
    'loads a 64x2 export and matches scalar PReLU inference (%s)',
    (backend) => {
      const folder = mkdtempSync(join(process.cwd(), '.d8-parity-'))
      const prior = process.env.RIVER_VALUE_BACKEND
      process.env.RIVER_VALUE_BACKEND = backend
      try {
        const stem = join(folder, 'residual')
        const shape = [TURN_RESIDUAL_INPUTS, 64, 64, 1]
        const head: RiverValueNetwork = {
          buckets: 128,
          layers: shape.slice(1).map((rows, i) => {
            const columns = shape[i] as number
            return {
              rows,
              columns,
              weight: Float32Array.from(
                { length: rows * columns },
                (_, k) => (((k * 13 + i * 7) % 37) - 18) / 100,
              ),
              bias: Float32Array.from({ length: rows }, (_, k) => ((k % 5) - 2) / 10),
              slope: i === shape.length - 2 ? null : 0.125 + i / 8,
            }
          }),
        }
        function save(suffix: string, network: RiverValueNetwork) {
          const tensors: { name: string; shape: number[]; offset: number }[] = []
          const arrays: Float32Array[] = []
          let offset = 0
          const add = (name: string, dimensions: number[], values: Float32Array) => {
            tensors.push({ name, shape: dimensions, offset })
            arrays.push(values)
            offset += values.byteLength
          }
          network.layers.forEach((l, i) => {
            add(`${2 * i}.weight`, [l.rows, l.columns], l.weight)
            add(`${2 * i}.bias`, [l.rows], l.bias)
            if (l.slope !== null) add(`${2 * i + 1}.weight`, [1], Float32Array.of(l.slope))
          })
          writeFileSync(`${stem}-${suffix}.json`, JSON.stringify({ buckets: 128, tensors }))
          writeFileSync(
            `${stem}-${suffix}.bin`,
            Buffer.concat(arrays.map((a) => Buffer.from(a.buffer))),
          )
        }
        save('bucket', constant(385, 256, 0.25))
        save('head', head)
        const meta = { version: 1, target: 'turn-start/per-river-v1', inputs: 65, headShape: shape }
        writeFileSync(`${stem}.json`, JSON.stringify(meta))
        const model = loadTurnResidualNetwork(stem)
        expect(model.residual.layers.map((l) => l.rows)).toEqual([64, 64, 1])
        const board = keys('2s 7s Kh Qc'),
          ranks = legalRanks(board)
        const cards = turnCardFeatures(board, ranks)
        const ranges = [Float32Array.from(ranks), Float32Array.from(ranks)] as const
        const local = turnResidualInputs(cards, ranges, new Float32Array(256).fill(0.25), 20, 10)
        const actual = turnResidualValues(model, cards, ranges, 20, 10)
        expect(valueNetworkBackend(model.residual)).toBe(backend)
        // Scalar reference traverses original tensors, independently of loader/batch/WASM.
        for (const p of [0, 1] as const)
          for (const h of [holding('As Js'), holding('4h 5h'), holding('Ac Ad')]) {
            const at = (p * COMBOS + h) * TURN_RESIDUAL_INPUTS
            const expected =
              0.25 + (forward(head, local.slice(at, at + TURN_RESIDUAL_INPUTS))[0] as number)
            expect(Math.abs((actual[p][h] as number) - expected)).toBeLessThan(1e-5)
          }
        writeFileSync(`${stem}.json`, JSON.stringify({ ...meta, headShape: [65, 16, 1] }))
        expect(() => loadTurnResidualNetwork(stem)).toThrow('head shape')
        // Existing part-1 metadata without headShape remains supported.
        writeFileSync(`${stem}.json`, JSON.stringify({ ...meta, headShape: undefined }))
        expect(loadTurnResidualNetwork(stem).residual.layers).toHaveLength(3)
      } finally {
        if (prior === undefined) delete process.env.RIVER_VALUE_BACKEND
        else process.env.RIVER_VALUE_BACKEND = prior
        rmSync(folder, { recursive: true })
      }
    },
  )

  it('pins the historical unseen split without changing splits between seeds', () => {
    const { order, sha256 } = historicalOrder()
    expect(new Set(order).size).toBe(53550)
    expect(sha256).toBe('e70b66b41f6d7c1dbf145e849efc3eed401cb6058e5abe77f5e8d2d2f62e4f1c')
  })

  it('counts nine flush outs and eight open-ended straight outs on hand-checked turns', () => {
    const board = keys('2s 7s Kh Qc')
    const f = turnCardFeatures(board, legalRanks(board)).holding
    const h = holding('As Js') * TURN_STATIC
    expect(f[h + 4]).toBe(1)
    expect(f[h + 15]).toBeCloseTo(9 / 46, 7)
    expect(f[h + 12]).toBe(0.5)
    const straightBoard = keys('2s 3d Kh Qc')
    const sf = turnCardFeatures(straightBoard, legalRanks(straightBoard)).holding
    const s = holding('4h 5h') * TURN_STATIC
    expect(sf[s + 5]).toBe(1)
    expect(sf[s + 14]).toBeCloseTo(8 / 46, 7)
  })

  it('computes category moments against exhaustive engine evaluation, including wheels and full houses', () => {
    const deck = makeDeck()
    for (const [boardText, handText] of [
      ['2s 7s Kh Qc', 'As Js'],
      ['2s 3d Kh Qc', '4h 5h'],
      ['As Ad 7c 7s', 'Ah Kd'],
      ['As Ks Qs Js', 'Ts 2c'],
      ['Ac 2d 3h 4s', '5c 6d'],
      ['As Ad Ah 2s', 'Ac 2c'],
    ] as const) {
      const board = keys(boardText),
        hand = keys(handText)
      const f = turnCardFeatures(board, legalRanks(board)).holding
      const at = holding(handText) * TURN_STATIC
      const six = [...board, ...hand]
      const cats = Array.from({ length: 52 }, (_, k) => k)
        .filter((k) => !six.includes(k))
        .map((k) => evaluateBest([...six, k].map((c) => deck[c] as Card)).category / 8)
      const mean = cats.reduce((a, b) => a + b, 0) / 46
      const spread = Math.sqrt(cats.reduce((a, b) => a + (b - mean) ** 2, 0) / 46)
      expect(f[at + 1]).toBeCloseTo(mean, 7)
      expect(f[at + 2]).toBeCloseTo(spread, 7)
      expect(f[at + 3]).toBe(evaluateBest(six.map((c) => deck[c] as Card)).category / 8)
    }
  })

  it('uses opponent range mass for blockers, with the shared holding counted once', () => {
    const board = keys('2s 7s Kh Qc')
    const cards = turnCardFeatures(board, legalRanks(board))
    const own = new Float64Array(COMBOS),
      opp = new Float64Array(COMBOS)
    own[holding('As Js')] = 1
    opp[holding('As Ad')] = 0.6
    opp[holding('Js Ts')] = 0.4
    const f = turnResidualInputs(cards, [own, opp], new Float32Array(256), 10, 10)
    const at = holding('As Js') * TURN_RESIDUAL_INPUTS + 3 + TURN_STATIC
    expect(f[at]).toBeCloseTo(0.6, 7)
    expect(f[at + 1]).toBeCloseTo(0.4, 7)
    expect(f[at + 2]).toBe(1)
    expect(f[holding('As Ad') * TURN_RESIDUAL_INPUTS + 3 + TURN_STATIC + 2]).toBeCloseTo(0.6, 7)
    const empty = turnResidualInputs(
      cards,
      [own, new Float64Array(COMBOS)],
      new Float32Array(256),
      10,
      10,
    )
    expect(empty.every(Number.isFinite)).toBe(true)
  })

  it('ties all 24 suit augmentations, including asymmetric range blockers and pools', () => {
    const board = keys('2s 7s Kh Qc'),
      ranks = legalRanks(board)
    const ranges = [
      Float64Array.from(ranks, (v, h) => (v ? (h % 17) + 1 : 0)),
      Float64Array.from(ranks, (v, h) => (v ? (h % 11) + 1 : 0)),
    ] as const
    const cards = turnCardFeatures(board, ranks)
    const original = turnResidualInputs(cards, ranges, new Float32Array(256), 10, 10)
    for (let a = 0; a < 4; a++)
      for (let b = 0; b < 4; b++)
        for (let c = 0; c < 4; c++)
          for (let d = 0; d < 4; d++) {
            const permutation = [a, b, c, d]
            if (new Set(permutation).size !== 4) continue
            const pb = board.map((k) => (permutation[Math.floor(k / 13)] as number) * 13 + (k % 13))
            const pr = new Uint16Array(COMBOS),
              weights = [new Float64Array(COMBOS), new Float64Array(COMBOS)] as const
            for (let h = 0; h < COMBOS; h++) {
              const to = permuteHolding(h, permutation)
              pr[to] = ranks[h] as number
              for (const p of [0, 1] as const) weights[p][to] = ranges[p][h] as number
            }
            const augmented = turnResidualInputs(
              turnCardFeatures(pb, pr),
              weights,
              new Float32Array(256),
              10,
              10,
            )
            let max = 0
            for (let p = 0; p < 2; p++)
              for (let h = 0; h < COMBOS; h++)
                for (let f = 0; f < TURN_RESIDUAL_INPUTS; f++) {
                  max = Math.max(
                    max,
                    Math.abs(
                      (augmented[
                        (p * COMBOS + permuteHolding(h, permutation)) * TURN_RESIDUAL_INPUTS + f
                      ] as number) -
                        (original[(p * COMBOS + h) * TURN_RESIDUAL_INPUTS + f] as number),
                    ),
                  )
                }
            expect(max).toBeLessThan(1e-7)
          }
  })

  it('kills a mutation dropping the residual and zeros every blocked holding', () => {
    const board = keys('2s 7s Kh Qc'),
      ranks = legalRanks(board)
    const cards = turnCardFeatures(board, ranks)
    const ranges = [Float32Array.from(ranks), Float32Array.from(ranks)] as const
    const model = {
      bucket: constant(385, 256, 0.25),
      residual: constant(TURN_RESIDUAL_INPUTS, 1, 0.125),
    }
    const full = turnResidualValues(model, cards, ranges, 10, 10)
    const mutated = turnResidualValues(model, cards, ranges, 10, 10, true)
    for (const p of [0, 1] as const)
      for (let h = 0; h < COMBOS; h++) {
        expect(full[p][h]).toBe(ranks[h] ? 0.375 : 0)
        expect(mutated[p][h]).toBe(ranks[h] ? 0.25 : 0)
      }
  })

  it('responds to opponent blockers and preserves prior results when scratch is reused', () => {
    const board = keys('2s 7s Kh Qc'),
      ranks = legalRanks(board)
    const cards = turnCardFeatures(board, ranks)
    const own = new Float64Array(COMBOS),
      opp = new Float64Array(COMBOS)
    own[holding('As Js')] = 1
    opp[holding('As Ad')] = 0.6
    opp[holding('Js Ts')] = 0.4
    const head = constant(TURN_RESIDUAL_INPUTS, 1, 0)
    head.layers[0]?.weight.set([1], 3 + TURN_STATIC)
    const model = { bucket: constant(385, 256, 0.25), residual: head }
    const first = turnResidualValues(model, cards, [own, opp], 10, 10)
    const second = turnResidualValues(model, cards, [own, new Float64Array(COMBOS)], 10, 10)
    expect(first[0][holding('As Js')]).toBeCloseTo(0.85, 7)
    expect(second[0][holding('As Js')]).toBe(0.25)
    expect(first[0][holding('As Js')]).toBeCloseTo(0.85, 7)
  })
})

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

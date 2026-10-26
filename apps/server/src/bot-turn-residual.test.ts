import { type Card, cardKey, evaluateBest, makeDeck, parseCard } from '@river/engine'
import { describe, expect, it } from 'vitest'
import { COMBOS, comboIndex52 } from './bot-river-value-data.js'
import { HOLDING_CARDS } from './bot-turn-end-data.js'
import {
  permuteHolding,
  TURN_RESIDUAL_INPUTS,
  TURN_STATIC,
  turnCardFeatures,
  turnResidualInputs,
  turnResidualValues,
} from './bot-turn-residual.js'
import { historicalOrder } from './bot-turn-residual-split.js'
import type { RiverValueNetwork } from './bot-value-network.js'

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

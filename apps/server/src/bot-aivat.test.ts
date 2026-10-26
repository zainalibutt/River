import { type BotPolicy, makeDeck, mulberry32, parseCard, seedFromString } from '@river/engine'
import { describe, expect, it } from 'vitest'
import {
  aivatChips,
  aivatCorrection,
  captureCumulativeStrategy,
  withStrategyCapture,
} from './bot-aivat.js'
import { lateBoardCorrection } from './bot-aivat-chance.js'
import { enumerableAivatToy } from './bot-aivat-toy.js'
import { actionFor, botPlayerId } from './bot-service.js'
import { focalRotation } from './bot-session-campaign.js'
import { slumbotRoom } from './bot-slumbot.js'

describe('AIVAT exact controls', () => {
  it('equals the exact game expectation over every deal and action, with an unknown opponent', () => {
    const result = enumerableAivatToy()
    expect(result.deals).toBe(6)
    expect(result.paths).toBe(18)
    expect(result.probability).toBeCloseTo(1, 14)
    expect(result.exactExpectation).toBeCloseTo(-1 / 120, 14)
    expect(Math.abs(result.bias)).toBeLessThan(1e-12)
    expect(result.aivatVariance).toBeLessThan(result.rawVariance)
  })

  it('rejects missing probability mass, impossible actions and invalid values', () => {
    const choice = { action: 'a', probability: 0.8, value: 2 }
    expect(() => aivatCorrection({ kind: 'action', taken: 'a', choices: [choice] })).toThrow()
    expect(() =>
      aivatCorrection({ kind: 'action', taken: 'b', choices: [{ ...choice, probability: 1 }] }),
    ).toThrow()
    expect(() => aivatChips(Number.NaN, [])).toThrow()
    expect(() =>
      aivatCorrection({
        kind: 'action',
        taken: 'a',
        choices: [{ ...choice, probability: 1, value: Number.NaN }],
      }),
    ).toThrow()
  })

  it('captures the actual last-bucket remainder without consuming the action RNG', () => {
    let draws = 0
    const rng = () => {
      draws++
      return 0.5
    }
    const captured = withStrategyCapture(rng, () => {
      captureCumulativeStrategy(rng, [0.2, 0.3, 0.499999], () => ({ kind: 'check' }))
      return 7
    })
    expect(captured.result).toBe(7)
    expect(captured.choices?.map((entry) => entry.probability)).toEqual([0.2, 0.3, 0.5])
    expect(draws).toBe(0)
    expect(withStrategyCapture(rng, () => 1).choices).toBeUndefined()
  })

  it('has exactly zero mean over all legal river cards, including losing runouts', () => {
    const focal = ['As', 'Ah'].map(parseCard)
    const other = ['Ks', 'Kh'].map(parseCard)
    const board = ['2c', '3c', '4d', 'Kd'].map(parseCard)
    const known = new Set([...focal, ...other, ...board].map((c) => `${c.rank}${c.suit}`))
    const rivers = makeDeck().filter((c) => !known.has(`${c.rank}${c.suit}`))
    const correction =
      rivers.reduce(
        (sum, river) =>
          sum +
          lateBoardCorrection(focal, other, [
            { before: board, after: [...board, river], pot: 100 },
          ]),
        0,
      ) / rivers.length
    expect(Math.abs(correction)).toBeLessThan(1e-12)
  })

  it('records legalised probabilities without changing play or RNG consumption', () => {
    const personality = focalRotation()[0]
    if (!personality) throw new Error('missing personality')
    const ours = botPlayerId(personality.id)
    const room = slumbotRoom(
      { action: '', clientPos: 1, hole: ['As', 'Kh'].map(parseCard), board: [] },
      { ours, theirs: 'bot:other' },
    )
    const policy: BotPolicy = {
      id: 'test',
      version: 1,
      decide(context) {
        const row = [0.25, 0.25, 0.5]
        const decisions = [
          { kind: 'raiseTo', to: 100000 },
          { kind: 'allIn' },
          { kind: 'fold' },
        ] as const
        captureCumulativeStrategy(context.rng, row, (index) => decisions[index] ?? { kind: 'fold' })
        const roll = context.rng()
        return {
          policyId: this.id,
          policyVersion: 1,
          observationVersion: 1,
          fallbackReason: null,
          decision: decisions[roll < 0.25 ? 0 : roll < 0.5 ? 1 : 2],
        }
      },
    }
    const seed = seedFromString('aivat-recording')
    const first = mulberry32(seed)
    const second = mulberry32(seed)
    let recorded = false
    const plain = actionFor(room.viewFor(ours), ours, personality, first, { policy })
    const captured = actionFor(room.viewFor(ours), ours, personality, second, {
      policy,
      aivat: (row) => {
        recorded = true
        expect(row.control?.choices).toHaveLength(2)
        expect(row.control?.choices.find((choice) => choice.action === 'allIn')?.probability).toBe(
          0.5,
        )
      },
    })
    expect(recorded).toBe(true)
    expect(captured).toEqual(plain)
    expect(first()).toBe(second())
  })
})

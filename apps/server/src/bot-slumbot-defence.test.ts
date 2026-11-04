import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type BotObservationV1, parseCard } from '@river/engine'
import { describe, expect, it, vi } from 'vitest'
import { showdownShare } from './bot-allin-equity.js'
import {
  callEVBB,
  DefenceAnalysis,
  type DefenceHand,
  defenceEquity,
  incomingBet,
  main,
  sizeBucket,
  strategyProbabilities,
} from './bot-slumbot-defence.js'

const cards = (text: string) => text.split(' ').map(parseCard)
const board = cards('2c 3d 7h 9s Jc')

function observation(overrides: Partial<BotObservationV1> = {}): BotObservationV1 {
  return {
    version: 1,
    roomId: 'synthetic',
    handNumber: 1,
    actor: {
      playerId: 'ours',
      seat: 1,
      hole: cards('As Ah'),
      stack: 19_950,
      betHand: 50,
      betStreet: 0,
    },
    street: 'river',
    board,
    pot: 150,
    currentBet: 50,
    amountToCall: 50,
    legal: {
      fold: true,
      check: false,
      call: { enabled: true, amount: 50 },
      raiseTo: { enabled: true, min: 100, max: 19_950 },
      allIn: { enabled: true, amount: 19_950 },
    },
    seats: [
      {
        seat: 1,
        playerId: 'ours',
        stack: 19_950,
        betHand: 50,
        betStreet: 0,
        folded: false,
        allIn: false,
        away: false,
      },
      {
        seat: 0,
        playerId: 'theirs',
        stack: 19_900,
        betHand: 100,
        betStreet: 50,
        folded: false,
        allIn: false,
        away: false,
      },
    ],
    opponents: [],
    actions: [
      {
        seat: 0,
        street: 'river',
        action: { kind: 'raiseTo', to: 50 },
        amountCommitted: 50,
        potBefore: 100,
        streetBetAfter: 50,
      },
    ],
    tilt: { factor: 0 },
    ...overrides,
  }
}

function hand(o = observation(), fold = 0.8, call = 0.1): DefenceHand {
  return {
    clientPos: 0,
    hole: o.actor.hole.map((c) => c.rank + c.suit),
    slumbotHole: ['Ks', 'Kh'],
    aivatDecisions: [
      {
        observation: o,
        control: {
          kind: 'action',
          choices: [
            { action: 'fold', probability: fold },
            { action: 'call', probability: call },
            { action: 'raiseTo:150', probability: 1 - fold - call },
          ],
          taken: 'call',
        },
      },
    ],
  }
}

describe('Slumbot defence log analysis', () => {
  it('enumerates 1/44/990 boards, splits ties, and uses only the current board', () => {
    expect(defenceEquity(cards('As Ah'), cards('Ks Kh'), board)).toEqual({ equity: 1, runouts: 1 })
    expect(defenceEquity(cards('Ks Kh'), cards('As Ah'), board).equity).toBe(0)
    expect(defenceEquity(cards('2c 3d'), cards('4c 5d'), cards('As Ks Qs Js Ts'))).toEqual({
      equity: 0.5,
      runouts: 1,
    })
    const turn = defenceEquity(cards('2h 3h'), cards('As Ad'), cards('Ah Kh 9s 4c'), 1)
    expect(turn.runouts).toBe(44)
    expect(turn.equity).toBeCloseTo(10 / 44, 12)
    const flop = cards('Ah Kh 9s')
    const result = defenceEquity(cards('2h 3h'), cards('As Ad'), flop)
    expect(result.runouts).toBe(990)
    expect(result.equity).toBeCloseTo(
      showdownShare(cards('2h 3h'), cards('As Ad'), flop, 'exact'),
      12,
    )
    expect(() => defenceEquity(cards('As Ah'), cards('As Kh'), flop)).toThrow('duplicate')
  })

  it('caps only flop sampling with deterministic matchup seeds', () => {
    const first = defenceEquity(cards('2h 3h'), cards('As Ad'), cards('Ah Kh 9s'), 37)
    expect(first.runouts).toBe(37)
    expect(first.equity).toBeGreaterThanOrEqual(0)
    expect(first.equity).toBeLessThanOrEqual(1)
    expect(defenceEquity(cards('3h 2h'), cards('Ad As'), cards('9s Kh Ah'), 37)).toEqual(first)
    expect(defenceEquity(cards('2h 3h'), cards('As Ad'), cards('Ah Kh 9s'), 1_000).runouts).toBe(
      990,
    )
    expect(() => defenceEquity(cards('2h 3h'), cards('As Ad'), board, 0)).toThrow('samples')
  })

  it('prices calls in BB using the pot including the incoming bet', () => {
    expect(callEVBB(1, 150, 50)).toBe(1.5)
    expect(callEVBB(0, 150, 50)).toBe(-0.5)
    expect(callEVBB(0.25, 150, 50)).toBe(0)
    expect(callEVBB(0.5, 150, 50)).toBe(0.5)
  })

  it('matches inclusive attribution sizing edges and all-in precedence', () => {
    expect([0.4, 0.400001, 0.8, 0.800001, 1.2, 1.200001].map((x) => sizeBucket(x, false))).toEqual([
      'small',
      'medium',
      'medium',
      'pot',
      'pot',
      'overbet',
    ])
    expect(sizeBucket(0.2, true)).toBe('all-in')
    expect(incomingBet(observation())).toEqual({
      fraction: 0.5,
      size: 'medium',
      facingRaise: false,
    })
    const o = observation()
    const raised = observation({
      pot: 400,
      amountToCall: 100,
      actor: { ...o.actor, betStreet: 100 },
      seats: o.seats.map((seat) => ({
        ...seat,
        betStreet: seat.seat === 1 ? 100 : 200,
        stack: seat.seat === 0 ? 0 : seat.stack,
      })),
      actions: [
        {
          seat: 0,
          street: 'river',
          action: { kind: 'allIn' },
          amountCommitted: 150,
          potBefore: 250,
          streetBetAfter: 200,
        },
      ],
    })
    expect(incomingBet(raised)).toEqual({ fraction: 1 / 3, size: 'all-in', facingRaise: true })
    expect(() => incomingBet({ ...raised, pot: 450 })).toThrow('disagrees')
    expect(() => incomingBet({ ...o, actions: [] })).toThrow('history')
  })

  it('averages mixed probabilities, fold-weighted EV, bluff share, and equity deciles', () => {
    const a = new DefenceAnalysis()
    a.add(hand())
    const o = observation()
    a.add(hand({ ...o, actor: { ...o.actor, hole: cards('Qs Qh') } }, 0.2, 0.5))
    const report = a.report()
    expect(report.decisions).toBe(2)
    expect(report.buckets).toHaveLength(1)
    const b = report.buckets[0]
    expect(b).toMatchObject({
      n: 2,
      position: 'BB',
      street: 'river',
      meanFoldProbability: 0.5,
      meanCallProbability: 0.3,
      slumbotBluffShare: 0.5,
    })
    expect(b?.meanRaiseProbability).toBeCloseTo(0.2)
    expect(b?.meanMDF).toBeCloseTo(2 / 3)
    expect(b?.foldWeightedMeanCallEVBB).toBeCloseTo(1.1)
    expect(b?.foldedCallEVBBPerDecision).toBeCloseTo(0.55)
    expect(b?.positiveCallEVFoldMassShare).toBeCloseTo(0.8)
    expect(b?.equityDeciles[9]).toMatchObject({ n: 1, meanFoldProbability: 0.8 })
    expect(b?.equityDeciles[0]).toMatchObject({ n: 1, meanFoldProbability: 0.2 })
    expect(b?.equityDeciles[5]?.meanFoldProbability).toBeNull()
    const button = new DefenceAnalysis()
    button.add({ ...hand(o, 0, 1), clientPos: 1 })
    expect(button.report().buckets[0]).toMatchObject({
      position: 'BTN',
      foldWeightedMeanCallEVBB: null,
      positiveCallEVFoldMassShare: null,
    })
  })

  it('counts all-in calls correctly and rejects incomplete or invalid logged strategies', () => {
    const o = observation()
    const control = {
      kind: 'action' as const,
      taken: 'allIn',
      choices: [{ action: 'allIn', probability: 1 }],
    }
    expect(strategyProbabilities(control, { ...o, actor: { ...o.actor, stack: 50 } })).toEqual({
      fold: 0,
      call: 1,
      raise: 0,
    })
    expect(strategyProbabilities(control, o)).toEqual({ fold: 0, call: 0, raise: 1 })
    expect(() =>
      strategyProbabilities({ ...control, choices: [{ action: 'call', probability: 0.8 }] }, o),
    ).toThrow('normalized')
    const a = new DefenceAnalysis()
    expect(() => a.add({ ...hand(), aivatDecisions: [{ observation: o, control: null }] })).toThrow(
      'strategy',
    )
    expect(() => a.add({ ...hand(), slumbotHole: null })).toThrow('hole')
    expect(() => a.add({ ...hand(), aivatDecisions: undefined } as unknown as DefenceHand)).toThrow(
      'aivatDecisions',
    )
    a.add({
      ...hand(),
      aivatDecisions: [
        { observation: { ...o, street: 'preflop' }, control: null },
        { observation: { ...o, amountToCall: 0 }, control: null },
      ],
    })
    expect(a.report().decisions).toBe(0)
  })

  it('validates CLI options before reading input', async () => {
    await expect(main([])).rejects.toThrow('usage')
    await expect(main(['--samples', '0', 'synthetic.jsonl'])).rejects.toThrow('--samples')
    await expect(main(['--unknown'])).rejects.toThrow('unknown option')
    await expect(main(['synthetic.jsonl', './synthetic.jsonl'])).rejects.toThrow('duplicate')
  })

  it('streams multiple synthetic JSONL files to JSON stdout and locates invalid records', async () => {
    const dir = mkdtempSync(join(process.cwd(), '.slumbot-defence-test-'))
    const first = join(dir, 'first.jsonl')
    const second = join(dir, 'second.jsonl')
    const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    try {
      // Completed-hand future cards are deliberately irrelevant to current equity.
      const o = observation()
      const flop = observation({
        street: 'flop',
        board: board.slice(0, 3),
        actions: o.actions?.map((action) => ({ ...action, street: 'flop' as const })) ?? [],
      })
      writeFileSync(
        first,
        `\n${JSON.stringify({ ...hand(flop), board: ['2c', '3d', '7h', 'Ac', 'Ad'] })}\n\n`,
      )
      writeFileSync(
        second,
        `${JSON.stringify({ ...hand(flop), clientPos: 1, board: ['2c', '3d', '7h', 'Kc', 'Kd'] })}\n`,
      )
      await main(['--samples', '16', first, second])
      expect(output).toHaveBeenCalledTimes(1)
      const report = JSON.parse(String(output.mock.calls[0]?.[0]))
      expect(report).toMatchObject({ hands: 2, decisions: 2, evaluatedRunouts: 32 })
      expect(report.buckets).toHaveLength(2)
      expect(report.buckets[0].foldWeightedMeanCallEVBB).toBe(
        report.buckets[1].foldWeightedMeanCallEVBB,
      )
      expect(report.methodology.pot).toContain('INCLUDING')
      writeFileSync(second, '\n{}\n')
      await expect(main([second])).rejects.toThrow('second.jsonl:2:')
      expect(output).toHaveBeenCalledTimes(1)
    } finally {
      output.mockRestore()
      unlinkSync(first)
      unlinkSync(second)
      rmdirSync(dir)
    }
  })
})

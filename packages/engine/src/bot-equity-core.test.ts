import { describe, expect, it } from 'vitest'
import { estimateShowdownEquity } from './bot-equity.js'
import { bluffMultiplier, equityCoreDecision, rangedEquity } from './bot-equity-core.js'
import type { BotObservationV1 } from './bots.js'
import { parseCard } from './cards.js'
import { BOT_PROFILES } from './config.js'
import { mulberry32 } from './rng.js'

const cards = (text: string) => text.split(' ').map(parseCard)

function spot(options: {
  hole: string
  board: string
  street: BotObservationV1['street']
  facing: number
  opponents?: number
}): BotObservationV1 {
  const others = options.opponents ?? 1
  const pot = 6_000 + options.facing
  return {
    version: 1,
    roomId: 'equity-core',
    handNumber: 3,
    actor: {
      playerId: 'bot:kazimir',
      seat: 0,
      hole: cards(options.hole),
      stack: 60_000,
      betHand: 3_000,
      betStreet: 0,
    },
    street: options.street,
    board: cards(options.board),
    dealerSeat: others,
    pot,
    currentBet: options.facing,
    amountToCall: options.facing,
    legal: {
      fold: options.facing > 0,
      check: options.facing === 0,
      call: { enabled: options.facing > 0, amount: options.facing },
      raiseTo: { enabled: true, min: Math.max(500, options.facing * 2), max: 60_000 },
      allIn: { enabled: true, amount: 60_000 },
    },
    seats: Array.from({ length: others + 1 }, (_, seat) => ({
      seat,
      playerId: seat === 0 ? 'bot:kazimir' : `bot:other-${seat}`,
      stack: 60_000,
      betHand: 3_000 + (seat === 0 ? 0 : options.facing),
      betStreet: seat === 0 ? 0 : options.facing,
      folded: false,
      allIn: false,
      away: false,
    })),
    opponents: [],
    actions:
      options.facing > 0
        ? [
            {
              seat: 1,
              street: options.street,
              action: { kind: 'raiseTo', to: options.facing },
              amountCommitted: options.facing,
              potBefore: 6_000,
              streetBetAfter: options.facing,
            },
          ]
        : [],
    tilt: { factor: 0 },
  }
}

const river = 'Kh 9d 5c 2s 3h'
const decisions = (observation: BotObservationV1, bluffRate = 0.35, seeds = 200) =>
  Array.from({ length: seeds }, (_, seed) =>
    equityCoreDecision(observation, { ...BOT_PROFILES.og, bluffRate }, mulberry32(seed)),
  )
const share = (list: ReturnType<typeof decisions>, kinds: readonly string[]) =>
  list.filter((decision) => decision !== null && kinds.includes(decision.kind)).length / list.length

describe('equity core for an OG after the flop', () => {
  it('never folds a set on the river and folds air to a bet', () => {
    expect(
      share(decisions(spot({ hole: 'Ks Kd', board: river, street: 'river', facing: 3_000 })), [
        'fold',
      ]),
    ).toBe(0)
    expect(
      share(decisions(spot({ hole: 'Qs Jc', board: river, street: 'river', facing: 3_000 })), [
        'fold',
      ]),
    ).toBe(1)
  })

  it('value-bets two pair when checked to', () => {
    expect(
      share(decisions(spot({ hole: 'Ks 9c', board: river, street: 'river', facing: 0 })), [
        'raiseTo',
      ]),
    ).toBe(1)
  })

  it('bluffs air on the river heads-up at a rate its character tilts within bounds', () => {
    const air = spot({ hole: 'Qs Jc', board: river, street: 'river', facing: 0 })
    const balanced = share(decisions(air, 0.35, 300), ['raiseTo'])
    const bold = share(decisions(air, 0.45, 300), ['raiseTo'])
    const shy = share(decisions(air, 0.1, 300), ['raiseTo'])
    expect(balanced).toBeGreaterThan(0.28)
    expect(balanced).toBeLessThan(0.42)
    expect(bold).toBeGreaterThan(balanced)
    expect(shy).toBeLessThan(balanced)
    expect(shy).toBeGreaterThan(0.15)
    expect(bluffMultiplier({ bluffRate: 5 })).toBe(1.4)
    expect(bluffMultiplier({ bluffRate: 0 })).toBe(0.6)
  }, 30_000)

  it('does not bluff into two opponents', () => {
    const air = spot({ hole: 'Qs Jc', board: river, street: 'river', facing: 0, opponents: 2 })
    expect(share(decisions(air), ['raiseTo'])).toBe(0)
  })

  it('continues with a flush draw at a good price on the flop', () => {
    const draw = spot({ hole: 'Ah 4h', board: 'Kh 9h 2c', street: 'flop', facing: 1_000 })
    expect(share(decisions(draw), ['fold'])).toBe(0)
  })

  it('leaves preflop to the rule policy', () => {
    const preflop = {
      ...spot({ hole: 'As Ad', board: 'Kh 9d 5c', street: 'flop', facing: 500 }),
      street: 'preflop' as const,
      board: [],
    }
    expect(equityCoreDecision(preflop, BOT_PROFILES.og, mulberry32(1))).toBeNull()
  })
})

describe('fast ranged equity', () => {
  it('agrees with the reference estimator on the same spot', () => {
    const hole = cards('As Kd') as [ReturnType<typeof parseCard>, ReturnType<typeof parseCard>]
    const board = cards('Qs Js 2c')
    for (const ranges of [['tight'], ['loose', 'random']] as const) {
      const fast = rangedEquity(hole, board, ranges, 4_000, 'agree')
      const reference = estimateShowdownEquity({
        hole,
        board,
        opponents: ranges.length,
        seed: 'agree',
        trials: 4_000,
        ranges,
      }).potShare
      expect(Math.abs(fast - reference)).toBeLessThan(0.03)
    }
  }, 30_000)
})

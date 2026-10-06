import {
  type BotObservationV1,
  type Card,
  championPersonality,
  headsUpButtonFirstIn,
  makeDeck,
  mulberry32,
  preflopHandStrengthV2,
  preflopScoreAtShare,
} from '@river/engine'
import { describe, expect, it } from 'vitest'
import { headsUpButtonGuardPolicy, pokerGuardPolicy } from './bot-poker-guard.js'
import { actionFor, botPlayerId } from './bot-service.js'
import { slumbotRoom } from './bot-slumbot.js'

/**
 * Heads-up, the button's first move is to call or fold the rest of the big
 * blind, and the live rules folded about a third of hands there. The measured
 * alternative calls instead of folding with anything but the weakest share of
 * starting hands, and changes nothing else.
 */

const nell = championPersonality()
const ids = { ours: botPlayerId(nell.id), theirs: botPlayerId('slumbot') }

/** Only the fields the rule reads, for spots a real table is awkward to reach. */
function spot(fields: {
  street?: 'preflop' | 'flop'
  seated?: number
  dealer?: number
  betStreet?: number
  currentBet?: number
  amountToCall?: number
}): BotObservationV1 {
  const seated = fields.seated ?? 2
  return {
    street: fields.street ?? 'preflop',
    seats: Array.from({ length: 9 }, (_, seat) => ({
      seat,
      playerId: seat < seated ? `p${seat}` : null,
    })),
    dealerSeat: fields.dealer ?? 0,
    actor: { seat: 0, betStreet: fields.betStreet ?? 50 },
    currentBet: fields.currentBet ?? 100,
    amountToCall: fields.amountToCall ?? 50,
  } as unknown as BotObservationV1
}

describe('the heads-up button first in', () => {
  it('is the button facing only the rest of the big blind, two players seated', () => {
    expect(headsUpButtonFirstIn(spot({}))).toBe(true)
  })

  it('is not a fuller table, the big blind, a raised pot or a later street', () => {
    expect(headsUpButtonFirstIn(spot({ seated: 3 }))).toBe(false)
    expect(headsUpButtonFirstIn(spot({ dealer: 1 }))).toBe(false)
    expect(headsUpButtonFirstIn(spot({ currentBet: 300, amountToCall: 250 }))).toBe(false)
    expect(headsUpButtonFirstIn(spot({ street: 'flop' }))).toBe(false)
  })
})

describe('the weakest share of starting hands', () => {
  it('marks a higher score for a larger share, up to aces', () => {
    expect(preflopScoreAtShare(0.12)).toBeLessThan(preflopScoreAtShare(0.2))
    expect(preflopScoreAtShare(0.2)).toBeLessThan(preflopScoreAtShare(0.5))
    const aces = preflopHandStrengthV2(
      makeDeck()
        .filter((card) => card.rank === 'A')
        .slice(0, 2),
    )
    expect(preflopScoreAtShare(1)).toBe(aces)
  })
})

describe('the wider heads-up button', () => {
  it('calls where the live rules fold, except with the weakest share, and changes nothing else', () => {
    const cut = preflopScoreAtShare(0.12)
    const wider = headsUpButtonGuardPolicy(0.12)
    const deck = makeDeck()
    let widened = 0
    for (let deal = 0; deal < 400; deal += 1) {
      const pick = mulberry32(deal)
      const first = Math.floor(pick() * deck.length)
      let second = Math.floor(pick() * (deck.length - 1))
      if (second >= first) second += 1
      const hole = [deck[first], deck[second]] as Card[]
      const view = slumbotRoom({ action: '', clientPos: 1, hole, board: [] }, ids).viewFor(ids.ours)
      const live = actionFor(view, ids.ours, nell, mulberry32(10_000 + deal), {
        policy: pokerGuardPolicy,
      })
      const next = actionFor(view, ids.ours, nell, mulberry32(10_000 + deal), { policy: wider })
      if (live?.kind === 'fold' && preflopHandStrengthV2(hole) >= cut) {
        expect(next?.kind).toBe('call')
        widened += 1
      } else {
        expect(next).toEqual(live)
      }
    }
    expect(widened).toBeGreaterThan(0)
  })
})

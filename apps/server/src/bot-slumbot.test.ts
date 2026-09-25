import { mulberry32, parseCard, personalityPool } from '@river/engine'
import { describe, expect, it } from 'vitest'
import { alwaysCallPolicy } from './bot-lbr.js'
import { pokerGuardPolicy } from './bot-poker-guard.js'
import { botPlayerId } from './bot-service.js'
import { slumbotIncrement, slumbotMoves, slumbotRoom } from './bot-slumbot.js'

const cards = (text: string) => (text === '' ? [] : text.split(' ').map(parseCard))
const ids = { ours: botPlayerId('og'), theirs: botPlayerId('slumbot') }
const og = personalityPool().find((entry) => entry.skill === 'og')
if (og === undefined) throw new Error('no OG in the cast')

describe('Slumbot action strings', () => {
  it('reads streets, checks, calls and bets to a street total', () => {
    expect(slumbotMoves('b200c/kk/kk/kb200')).toEqual([
      { street: 0, action: { kind: 'raiseTo', to: 200 } },
      { street: 0, action: { kind: 'call' } },
      { street: 1, action: { kind: 'check' } },
      { street: 1, action: { kind: 'check' } },
      { street: 2, action: { kind: 'check' } },
      { street: 2, action: { kind: 'check' } },
      { street: 3, action: { kind: 'check' } },
      { street: 3, action: { kind: 'raiseTo', to: 200 } },
    ])
    expect(slumbotMoves('b20000c///')).toHaveLength(2)
    expect(() => slumbotMoves('x')).toThrow()
  })
})

describe('the rebuilt table', () => {
  it('puts us in the big blind facing the button open', () => {
    const room = slumbotRoom({ action: 'b200', clientPos: 0, hole: cards('Td 7s'), board: [] }, ids)
    const view = room.viewFor(ids.ours)
    expect(view.currentActor?.playerId).toBe(ids.ours)
    expect(view.pot).toBe(300)
    expect(view.legal?.call.amount).toBe(100)
    expect(view.seats.find((seat) => seat.playerId === ids.ours)?.hole).toEqual(cards('Td 7s'))
  })

  it('deals the revealed board and faces us with the flop bet', () => {
    const room = slumbotRoom(
      { action: 'b200c/kb400', clientPos: 0, hole: cards('Ah Kd'), board: cards('Qs 7c 2d') },
      ids,
    )
    const view = room.viewFor(ids.ours)
    expect(view.street).toBe('flop')
    expect(view.board).toEqual(cards('Qs 7c 2d'))
    expect(view.currentActor?.playerId).toBe(ids.ours)
    expect(view.legal?.call.amount).toBe(400)
    expect(view.pot).toBe(800)
  })

  it('lets the button act first before the flop', () => {
    const room = slumbotRoom({ action: '', clientPos: 1, hole: cards('9c 9d'), board: [] }, ids)
    const view = room.viewFor(ids.ours)
    expect(view.currentActor?.playerId).toBe(ids.ours)
    expect(view.legal?.call.amount).toBe(50)
  })

  it('treats a bet of the whole stack as an all-in', () => {
    const room = slumbotRoom(
      { action: 'b20000', clientPos: 0, hole: cards('As Ad'), board: [] },
      ids,
    )
    expect(room.viewFor(ids.ours).legal?.call.amount).toBe(19_900)
  })
})

describe('our reply', () => {
  it('answers in Slumbot notation', () => {
    const rng = mulberry32(1)
    const facing = { action: 'b200', clientPos: 0 as const, hole: cards('Td 7s'), board: [] }
    expect(slumbotIncrement(facing, alwaysCallPolicy, og, rng)).toBe('c')
    const free = {
      action: 'b200c/',
      clientPos: 0 as const,
      hole: cards('Td 7s'),
      board: cards('Qs 7c 2d'),
    }
    expect(slumbotIncrement(free, alwaysCallPolicy, og, rng)).toBe('k')
    expect(slumbotIncrement(facing, pokerGuardPolicy, og, rng)).toMatch(/^(k|c|f|b\d+)$/)
  })

  it('sends an all-in that only matches the bet as a call', () => {
    const shover = {
      ...alwaysCallPolicy,
      id: 'always-all-in',
      decide(context: Parameters<typeof alwaysCallPolicy.decide>[0]) {
        return {
          ...alwaysCallPolicy.decide(context),
          policyId: 'always-all-in',
          decision: { kind: 'allIn' as const },
        }
      },
    }
    const facingShove = { action: 'b20000', clientPos: 0 as const, hole: cards('As Ad'), board: [] }
    expect(slumbotIncrement(facingShove, shover, og, mulberry32(2))).toBe('c')
    const open = { action: 'b200', clientPos: 0 as const, hole: cards('As Ad'), board: [] }
    expect(slumbotIncrement(open, shover, og, mulberry32(2))).toBe('b20000')
  })
})

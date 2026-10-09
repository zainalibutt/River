import type { HandRecord } from '@river/engine'
import { describe, expect, it } from 'vitest'
import {
  againstNell,
  type RecordedHand,
  recordedHandFrom,
  SESSION_GAP_MS,
  scorecard,
  sessions,
} from './player-record'

const record = { handNumber: 1 } as HandRecord

function hand(overrides: Partial<RecordedHand>): RecordedHand {
  return {
    handId: 'h',
    playedAtMs: 0,
    roomKind: 'bots',
    bigBlind: 500,
    netChips: 0,
    showed: false,
    record,
    ownHole: null,
    opponents: [],
    ...overrides,
  }
}

describe('a private record', () => {
  const hands = [
    hand({ playedAtMs: 0, netChips: 1_500, showed: true, opponents: ['Nell'] }),
    hand({ playedAtMs: 60_000, netChips: -500, showed: true, opponents: ['Nell', 'Jules'] }),
    hand({ playedAtMs: 120_000, netChips: -1_000, bigBlind: 1_000 }),
    hand({ playedAtMs: 120_000 + SESSION_GAP_MS + 1, netChips: 2_000 }),
  ]

  it('counts each hand at its own stake and every showdown', () => {
    expect(scorecard(hands)).toEqual({ hands: 4, netBigBlinds: 5, showdowns: 2, showdownsWon: 1 })
    expect(againstNell(hands)).toEqual({ hands: 2, netBigBlinds: 2, showdowns: 2, showdownsWon: 1 })
  })

  it('splits sittings where play stopped for half an hour, newest first', () => {
    expect(sessions(hands).map((entry) => [entry.hands, entry.netBigBlinds])).toEqual([
      [1, 4],
      [3, 1],
    ])
  })

  it('refuses a row it cannot read', () => {
    expect(recordedHandFrom({ hand_id: 'x', record: {}, big_blind: 0 })).toBeNull()
    expect(
      recordedHandFrom({
        hand_id: 'x',
        record: {},
        big_blind: 500,
        played_at: '2026-10-09T18:00:00Z',
        net_chips: '-250',
        showed: true,
        opponents: ['Nell'],
      }),
    ).toMatchObject({ netChips: -250, showed: true, opponents: ['Nell'] })
  })
})

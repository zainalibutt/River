import type { HandRecord } from '@river/engine'
import type { RoomSeatView, RoomView } from '@river/server'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RiverHandHistory } from '@/components/river-hand-history'
import { RiverLobby } from '@/components/river-lobby'
import { Table2D } from '@/components/table-2d/table-2d'
import { withSettledHands } from '@/lib/history'
import { LANDSCAPE } from '@/lib/table-2d-geometry'

/**
 * Amounts as the table draws them, in chips or in big blinds.
 *
 * Drawn to markup the way the server first draws the page, so what is checked
 * is the text a player reads rather than a formatter on its own.
 */

// The table's stake, 250/500.
const BIG_BLIND = 500

function seat(index: number, playerId: string | null, stack: number): RoomSeatView {
  return {
    seat: index,
    playerId,
    name: playerId,
    stack,
    betHand: 0,
    betStreet: 0,
    folded: false,
    allIn: false,
    hole: null,
    hasHole: false,
    sittingOut: false,
    busted: false,
    disconnected: false,
    dealer: false,
  }
}

function view(): RoomView {
  return {
    venueId: 'rooftop',
    handNumber: 3,
    phase: 'between',
    street: 'preflop',
    board: [],
    pot: 0,
    currentBet: 0,
    countdownMs: 0,
    seats: [
      seat(0, 'you', 100_000),
      seat(1, 'Nell', 87_250),
      seat(2, 'Ada', 4_000),
      ...Array.from({ length: 6 }, (_, index) => seat(index + 3, null, 0)),
    ],
    currentActor: null,
    legal: null,
    turnDeadlineMs: null,
    turnBudgetMs: null,
    commit: null,
    revealedSeed: null,
    clientSeeds: null,
    message: null,
    revealed: false,
    selfId: 'you',
    challenges: [],
    hostPlayerId: 'you',
    inviteCode: 'ABCDEF',
  }
}

function table(bigBlind: number | null): string {
  return renderToStaticMarkup(
    createElement(Table2D, {
      view: view(),
      geometry: LANDSCAPE,
      chipMoments: [],
      showdown: null,
      seatActions: new Map(),
      turnRemaining: null,
      turnKey: '',
      onSelect: () => undefined,
      bigBlind,
    }),
  )
}

function stacks(markup: string): string[] {
  return [...markup.matchAll(/class="t2d-stack"><i aria-hidden="true"><\/i>([^<]*)</g)].map(
    (match) => match[1] ?? '',
  )
}

const hand: HandRecord = {
  handNumber: 1,
  startedAtMs: 1_700_000_000_000,
  stake: { smallBlind: 250, bigBlind: 500 },
  seats: [
    { seat: 0, playerId: 'you', startingStack: 100_000 },
    { seat: 1, playerId: 'Nell', startingStack: 100_000 },
  ],
  actions: [
    { seat: 0, street: 'preflop', action: { kind: 'call' } },
    { seat: 1, street: 'flop', action: { kind: 'check' } },
  ],
  board: [
    { rank: 'A', suit: 's' },
    { rank: 'K', suit: 'h' },
    { rank: 'Q', suit: 'd' },
  ],
  potSize: 4_000,
  results: [
    { seat: 0, delta: 1_843, showed: true },
    { seat: 1, delta: -1_843, showed: true },
  ],
  commit: 'commit-1',
  revealedSeed: 'seed-1',
}

function history(bigBlind: number | null): string {
  return renderToStaticMarkup(
    createElement(RiverHandHistory, {
      hands: withSettledHands([], [hand]),
      selfId: 'you',
      bigBlind,
      onClose: () => undefined,
    }),
  )
}

describe('amounts at the table', () => {
  it('draws other players stacks in chips by default', () => {
    expect(stacks(table(null))).toEqual(['87.25K', '4,000'])
  })

  it('draws them in the table big blinds when asked', () => {
    expect(stacks(table(BIG_BLIND))).toEqual(['175 BB', '8 BB'])
  })

  it('writes the pots and results of the hand history in big blinds when asked', () => {
    const chips = history(null)
    expect(chips).toContain('>4,000</span>')
    expect(chips).toContain('Won 1,843')
    expect(chips).toContain('history-stat-value up">+1,843<')

    const blinds = history(BIG_BLIND)
    expect(blinds).toContain('>8 BB</span>')
    expect(blinds).toContain('Won 3.7 BB')
    expect(blinds).toContain('history-stat-value up">+3.7 BB<')
    expect(blinds).not.toContain('1,843')
  })

  it('leaves the stake reading as the stake', () => {
    const markup = renderToStaticMarkup(
      createElement(RiverLobby, {
        tables: [
          {
            roomId: 'river-1',
            venueId: 'rooftop',
            stakeId: '250-500',
            smallBlind: 250,
            bigBlind: 500,
            seatsTaken: 3,
            seatsTotal: 9,
            handNumber: 4,
            status: 'in-hand',
            hasPassword: false,
          },
        ],
        connected: true,
        onRefresh: () => undefined,
        onJoin: () => undefined,
      }),
    )
    expect(markup).toContain('class="lobby-stake">250/500<')
  })
})

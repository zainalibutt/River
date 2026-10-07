import type { Card } from '@river/engine'
import { describe, expect, it } from 'vitest'
import {
  advanceChoreography,
  boardShown,
  type CardChoreography,
  type ChoreographyInput,
  choreographyBusy,
  dealOrder,
  emptyChoreography,
  spriteFrame,
} from './card-choreography'
import { DEAL_TEMPO, runoutMs } from './deal-tempo'
import type { ShowdownPlan } from './showdown-plan'

const card = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit })
const BOARD = [card('A', 's'), card('K', 'h'), card('T', 'd'), card('4', 'c'), card('9', 's')]

function seats(dealer: number, holding: readonly number[], folded: readonly number[] = []) {
  return Array.from({ length: 8 }, (_, seat) => ({
    seat,
    hasHole: holding.includes(seat),
    folded: folded.includes(seat),
    dealer: seat === dealer,
  }))
}

function input(overrides: Partial<ChoreographyInput>): ChoreographyInput {
  return {
    handNumber: 1,
    phase: 'hand',
    board: [],
    seats: seats(2, [0, 1, 2, 3]),
    revealed: false,
    swept: false,
    showdown: null,
    ...overrides,
  }
}

/** A table that has already seen a hand, so the next one is dealt rather than laid out. */
function warm(): CardChoreography {
  return advanceChoreography(
    emptyChoreography(),
    input({ handNumber: 0, phase: 'between', seats: seats(1, []) }),
    0,
  )
}

describe('the dealer', () => {
  it('pitches from the seat after the button, clockwise, one card each and then a second', () => {
    expect(dealOrder(seats(2, [0, 1, 2, 3]))).toEqual([3, 0, 1, 2])
    const dealt = advanceChoreography(warm(), input({}), 1_000)
    const holes = dealt.sprites.filter((sprite) => sprite.kind === 'hole')
    const byLeave = [...holes].sort(
      (left, right) => (left.moves[0]?.startAt ?? 0) - (right.moves[0]?.startAt ?? 0),
    )
    expect(byLeave.map((sprite) => `${sprite.seat}:${sprite.index}`)).toEqual([
      '3:0',
      '0:0',
      '1:0',
      '2:0',
      '3:1',
      '0:1',
      '1:1',
      '2:1',
    ])
    expect(byLeave[0]?.moves[0]?.startAt).toBe(1_000 + DEAL_TEMPO.lead)
    expect((byLeave[1]?.moves[0]?.startAt ?? 0) - (byLeave[0]?.moves[0]?.startAt ?? 0)).toBe(
      DEAL_TEMPO.holeStagger,
    )
  })

  it('deals nothing to a seat without cards', () => {
    const dealt = advanceChoreography(warm(), input({ seats: seats(2, [0, 3]) }), 1_000)
    const dealtTo = new Set(
      dealt.sprites.filter((sprite) => sprite.kind === 'hole').map((s) => s.seat),
    )
    expect([...dealtTo].sort()).toEqual([0, 3])
  })

  it('burns before every street and turns the flop left to right once it has landed', () => {
    const dealt = advanceChoreography(warm(), input({}), 0)
    const flopped = advanceChoreography(
      dealt,
      input({ board: BOARD.slice(0, 3), swept: true }),
      5_000,
    )
    const burn = flopped.sprites.find((sprite) => sprite.kind === 'burn')
    const flop = flopped.sprites.filter((sprite) => sprite.kind === 'board')
    expect(burn?.moves[0]?.startAt).toBe(5_000 + DEAL_TEMPO.sweep)
    const burnDone = (burn?.moves[0]?.endAt ?? 0) + DEAL_TEMPO.beat
    for (const sprite of flop) expect(sprite.moves[0]?.startAt).toBeGreaterThanOrEqual(burnDone)
    const lastLanding = Math.max(...flop.map((sprite) => sprite.moves[0]?.endAt ?? 0))
    const flips = flop.map((sprite) => sprite.flipAt ?? 0)
    expect(flips[0]).toBeGreaterThan(lastLanding)
    expect(flips).toEqual([...flips].sort((left, right) => left - right))
    // Never face up before its turn: the face exists in the sprite, not on the felt.
    for (const sprite of flop) {
      expect(spriteFrame(sprite, (sprite.flipAt ?? 0) - 1)?.turn).toBe(0)
    }
  })

  it('makes the turn wait for the flop when both arrive at once', () => {
    const dealt = advanceChoreography(warm(), input({}), 0)
    const both = advanceChoreography(dealt, input({ board: BOARD.slice(0, 4) }), 5_000)
    const flopDone = Math.max(
      ...both.sprites
        .filter((sprite) => sprite.kind === 'board' && sprite.index < 3)
        .map((sprite) => (sprite.flipAt ?? 0) + DEAL_TEMPO.flip),
    )
    const turnBurn = both.sprites.find((sprite) => sprite.id.endsWith('x3'))
    expect(turnBurn?.moves[0]?.startAt).toBe(flopDone)
  })

  it('sends a folded hand to the muck, but never before it has reached the seat', () => {
    const dealt = advanceChoreography(warm(), input({}), 0)
    const early = advanceChoreography(dealt, input({ seats: seats(2, [0, 1, 2, 3], [1]) }), 10)
    for (const sprite of early.sprites.filter((entry) => entry.seat === 1)) {
      const landing = sprite.moves[0]?.endAt ?? 0
      const fold = sprite.moves[1]
      expect(fold?.to).toEqual({ kind: 'muck' })
      expect(fold?.startAt).toBeGreaterThanOrEqual(landing)
    }
  })

  it('collects the felt after an uncontested hand, and deals the next only after that', () => {
    const dealt = advanceChoreography(warm(), input({}), 0)
    const over = advanceChoreography(dealt, input({ phase: 'between' }), 4_000)
    const collected = over.sprites.map((sprite) => sprite.moves[sprite.moves.length - 1])
    for (const move of collected) expect(move?.to).toEqual({ kind: 'muck' })
    const collectStart = collected[0]?.startAt ?? 0
    expect(collectStart).toBeGreaterThanOrEqual(4_000 + DEAL_TEMPO.collectDelay)
    const nextHand = advanceChoreography(over, input({ handNumber: 2 }), 4_100)
    const firstLeave = Math.min(
      ...nextHand.sprites
        .filter((sprite) => sprite.id.startsWith('h2-'))
        .map((sprite) => sprite.moves[0]?.startAt ?? 0),
    )
    expect(firstLeave).toBeGreaterThanOrEqual(collectStart + DEAL_TEMPO.collect)
  })

  it('lays the cards out without dealing them on a reload mid-hand', () => {
    const seen = advanceChoreography(
      emptyChoreography(),
      input({ handNumber: 7, board: BOARD.slice(0, 3), seats: seats(2, [0, 1, 2, 3], [2]) }),
      9_000,
    )
    for (const sprite of seen.sprites) {
      const frame = spriteFrame(sprite, 9_000)
      expect(frame?.travel).toBe(1)
    }
    expect(seen.sprites.some((sprite) => sprite.seat === 2)).toBe(false)
    expect(seen.sprites.filter((sprite) => sprite.kind === 'board')).toHaveLength(3)
    expect(choreographyBusy(seen, 9_000)).toBe(false)
  })
})

describe('an all-in run-out', () => {
  const plan = {
    show: {
      steps: [
        { seat: 3, revealAtMs: 0, secondCardAtMs: 300, nameAtMs: 700, deciding: false },
        { seat: 0, revealAtMs: 1_200, secondCardAtMs: 1_500, nameAtMs: 1_900, deciding: true },
      ],
      awardAtMs: 2_600,
      totalMs: 3_400,
    },
    cards: new Map([
      [3, [card('Q', 'h'), card('Q', 'c')]],
      [0, [card('A', 'd'), card('K', 'd')]],
    ]),
    names: new Map(),
    awards: [{ seat: 3, amount: 2_000 }],
    pot: 2_000,
  } as unknown as ShowdownPlan

  function runout(at: number) {
    const dealt = advanceChoreography(warm(), input({ seats: seats(2, [0, 3]) }), 0)
    const flopped = advanceChoreography(
      dealt,
      input({ seats: seats(2, [0, 3]), board: BOARD.slice(0, 3) }),
      4_000,
    )
    return advanceChoreography(
      flopped,
      input({
        seats: seats(2, [0, 3]),
        board: BOARD,
        phase: 'between',
        revealed: true,
        swept: true,
        showdown: { plan, startedAt: at },
      }),
      at,
    )
  }

  it('turns the hands face up before the turn is burned', () => {
    const state = runout(9_000)
    const tabled = state.sprites.filter((sprite) => sprite.kind === 'hole')
    const turnBurn = state.sprites.find((sprite) => sprite.id.endsWith('x3'))
    for (const sprite of tabled) {
      expect(sprite.card).not.toBeNull()
      expect(sprite.flipAt ?? Number.POSITIVE_INFINITY).toBeLessThan(
        turnBurn?.moves[0]?.startAt ?? 0,
      )
    }
  })

  it('runs out exactly as long as the server waits for it', () => {
    const at = 9_000
    const state = runout(at)
    const riverFlip = state.sprites.find((sprite) => sprite.kind === 'board' && sprite.index === 4)
    const runoutEnds = (riverFlip?.flipAt ?? 0) + DEAL_TEMPO.flip
    expect(runoutEnds - at).toBe(runoutMs([1, 1], 2, true))
  })

  it('tells the showdown only once the river is face up', () => {
    const state = runout(9_000)
    const riverFlip = state.sprites.find((sprite) => sprite.kind === 'board' && sprite.index === 4)
    expect(state.showdownStartsAt).toBe((riverFlip?.flipAt ?? 0) + DEAL_TEMPO.flip)
  })

  it('counts only the board cards that are visibly face up', () => {
    const state = runout(9_000)
    const turnFlip = state.sprites.find((sprite) => sprite.kind === 'board' && sprite.index === 3)
    const at = (turnFlip?.flipAt ?? 0) - 1
    expect(boardShown(state, at)).toBe(3)
    expect(boardShown(state, (turnFlip?.flipAt ?? 0) + DEAL_TEMPO.flip)).toBe(4)
  })
})

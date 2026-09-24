import { parseCard, personalityPool } from '@river/engine'
import { describe, expect, it } from 'vitest'
import { type AllInSeat, allInEquityChips, showdownShare } from './bot-allin-equity.js'
import { alwaysCallPolicy, localBestResponse } from './bot-lbr.js'
import { runSessions } from './bot-session-benchmark.js'

const cards = (text: string) => text.split(' ').map(parseCard)

// 2h3h against a set of aces on Ah Kh 9s 4c: seven hearts that do not pair the
// board make a flush, three fives make a wheel, and nothing else wins.
const drawer = cards('2h 3h')
const aces = cards('As Ad')
const turn = cards('Ah Kh 9s 4c')
const holes = new Map([
  ['focal', drawer],
  ['other', aces],
])
const seats = (focal: number, other: number, folded = 0): AllInSeat[] => [
  { playerId: 'focal', contributed: focal, contending: true },
  { playerId: 'other', contributed: other, contending: true },
  ...(folded > 0 ? [{ playerId: 'folded', contributed: folded, contending: false }] : []),
]

describe('all-in equity', () => {
  it('counts every river exactly', () => {
    expect(showdownShare(drawer, aces, turn, 'exact')).toBeCloseTo(10 / 44, 12)
  })

  it('values an even all-in at the showdown share of the pot', () => {
    const value = allInEquityChips(seats(10_000, 10_000), holes, turn, 'focal', -10_000, 'even')
    expect(value).toBeCloseTo((10 / 44) * 20_000 - 10_000, 9)
  })

  it('returns the uncalled part and counts dead money in the contested pot', () => {
    const value = allInEquityChips(
      seats(15_000, 10_000, 1_000),
      holes,
      turn,
      'focal',
      -10_000,
      'dead',
    )
    expect(value).toBeCloseTo((10 / 44) * 21_000 + 5_000 - 15_000, 9)
  })

  it('leaves alone hands it cannot value', () => {
    const river = [...turn, parseCard('2c')]
    expect(allInEquityChips(seats(10_000, 10_000), holes, river, 'focal', -10_000, 'r')).toBeNull()
    const three = [
      ...seats(10_000, 10_000),
      { playerId: 'third', contributed: 10_000, contending: true },
    ]
    expect(allInEquityChips(three, holes, turn, 'focal', -10_000, 't')).toBeNull()
    expect(allInEquityChips(seats(10_000, 10_000), holes, turn, 'nobody', 0, 'n')).toBeNull()
    expect(
      allInEquityChips(seats(10_000, 10_000, 12_000), holes, turn, 'focal', -10_000, 'f'),
    ).toBeNull()
  })

  it('refuses a result the pot could not have paid', () => {
    expect(() =>
      allInEquityChips(seats(10_000, 10_000), holes, turn, 'focal', -4_000, 'x'),
    ).toThrow()
  })

  it('samples a preflop all-in close to the known share', () => {
    expect(showdownShare(cards('As Ah'), cards('Kd Kc'), [], 'preflop')).toBeCloseTo(0.82, 1)
  })

  it('values real all-ins without disagreeing with what the table paid', () => {
    const [focal, opponent] = [personalityPool()[10], personalityPool()[0]]
    if (focal === undefined || opponent === undefined) throw new Error('cast missing')
    const probe = localBestResponse(alwaysCallPolicy)
    const hands = runSessions({
      seed: 'allin-test',
      sessions: 2,
      handsPerSession: 20,
      table: {
        name: 'heads-up-best-response',
        style: 'best-response',
        entrants: [{ personality: focal }, { personality: opponent, policy: probe.policy }],
      },
      focalPolicy: alwaysCallPolicy,
      onFocalDecision: probe.watch,
      allInAdjustment: true,
    }).hands
    expect(hands.every((hand) => hand.adjustedChips !== undefined)).toBe(true)
    expect(hands.filter((hand) => hand.adjustedChips !== hand.focalChips).length).toBeGreaterThan(0)
  })
})

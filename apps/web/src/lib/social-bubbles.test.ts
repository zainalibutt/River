import { describe, expect, it } from 'vitest'
import { BUBBLE_MS, bubbleFor, withBubble } from './social'

const seatOf = (playerId: string) => (playerId === 'bot:mira' ? 3 : playerId === 'alice' ? 0 : null)

describe('lines said at the table', () => {
  it('puts a bot’s line up at its seat for a few seconds', () => {
    const bubble = bubbleFor(
      { kind: 'chat', playerId: 'bot:mira', text: '  Not again.  ', sentAtMs: 1 },
      seatOf,
      7,
      1_000,
    )
    expect(bubble).toEqual({
      id: 7,
      seat: 3,
      text: 'Not again.',
      kind: 'chat',
      until: 1_000 + BUBBLE_MS,
    })
  })

  it('names an emote rather than showing its code', () => {
    const bubble = bubbleFor(
      { kind: 'emote', playerId: 'alice', emote: 'tableKnock', sentAtMs: 1 },
      seatOf,
      1,
      0,
    )
    expect(bubble?.text).toBe('KNOCK')
  })

  it('puts nothing up for somebody without a seat', () => {
    expect(
      bubbleFor({ kind: 'chat', playerId: 'watcher', text: 'hi', sentAtMs: 1 }, seatOf, 1, 0),
    ).toBeNull()
  })

  it('keeps one bubble per seat, the newest', () => {
    const first = { id: 1, seat: 3, text: 'one', kind: 'chat' as const, until: 5_000 }
    const other = { id: 2, seat: 0, text: 'two', kind: 'chat' as const, until: 5_000 }
    const second = { id: 3, seat: 3, text: 'three', kind: 'chat' as const, until: 6_000 }
    expect(
      withBubble(withBubble([first], other, 100), second, 200).map((entry) => entry.id),
    ).toEqual([2, 3])
  })
})

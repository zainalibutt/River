import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initialRoomTarget, LAST_TABLE_KEY, LAST_TABLE_TTL_MS } from './table-target.js'

/**
 * Which table a page load opens is worth a test, because getting it wrong does
 * not look like a bug. It looks like your chips are missing.
 *
 * This used to mint a fresh random room on every load, so a reload abandoned
 * the seat holding your whole buy-in and opened an empty table beside it. Two
 * reloads spent a bankroll and the third sit was refused for insufficient
 * funds, with nothing on screen to say why.
 */

const store = new Map<string, string>()

function setLocation(search: string): void {
  vi.stubGlobal('window', {
    location: { search, href: `https://river.test/${search}` },
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    },
  })
}

function remember(value: unknown): void {
  store.set(LAST_TABLE_KEY, JSON.stringify(value))
}

beforeEach(() => store.clear())
afterEach(() => vi.unstubAllGlobals())

describe('which table a page load opens', () => {
  it('uses the room in the URL above everything else', () => {
    remember({ roomId: 'river-remembered', venueId: 'suite', atMs: Date.now() })
    setLocation('?room=river-invited&code=ABC123&venue=basement')
    expect(initialRoomTarget()).toEqual({
      roomId: 'river-invited',
      inviteCode: 'ABC123',
      expired: false,
      venueId: 'basement',
    })
  })

  it('returns to the table this browser was last at when the URL is bare', () => {
    // The reload case, and the whole point of the change.
    remember({
      roomId: 'river-abc12345',
      inviteCode: 'RIVER2',
      venueId: 'rooftop',
      atMs: Date.now(),
    })
    setLocation('')
    expect(initialRoomTarget()).toMatchObject({
      roomId: 'river-abc12345',
      inviteCode: 'RIVER2',
      venueId: 'rooftop',
    })
  })

  it('opens a new table when there is nothing to go back to', () => {
    setLocation('')
    const target = initialRoomTarget()
    expect(target.roomId).toMatch(/^river-[0-9a-f]{8}$/)
    expect(target.inviteCode).toBeUndefined()
  })

  it('does not resurrect a table from yesterday', () => {
    remember({
      roomId: 'river-stale',
      venueId: 'rooftop',
      atMs: Date.now() - LAST_TABLE_TTL_MS - 1,
    })
    setLocation('')
    expect(initialRoomTarget().roomId).not.toBe('river-stale')
  })

  it('opens a new table rather than throwing on unreadable storage', () => {
    // Private browsing, cleared site data, or a value written by an older
    // shape of this code. A remembered table is a convenience, and failing to
    // read one must not stop the page rendering at all.
    for (const junk of ['not json', '{}', '{"roomId":42}', 'null']) {
      store.set(LAST_TABLE_KEY, junk)
      setLocation('')
      expect(initialRoomTarget().roomId).toMatch(/^river-[0-9a-f]{8}$/)
    }
  })

  it('still reports an auth error while rejoining the remembered table', () => {
    remember({ roomId: 'river-abc12345', venueId: 'rooftop', atMs: Date.now() })
    setLocation('?error_code=otp_expired')
    expect(initialRoomTarget()).toMatchObject({ roomId: 'river-abc12345', expired: true })
  })

  it('falls back to the default venue when a remembered one is not a venue', () => {
    remember({ roomId: 'river-abc12345', venueId: 'casino-royale', atMs: Date.now() })
    setLocation('')
    expect(initialRoomTarget().venueId).toBe('rooftop')
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  followShortLink,
  initialRoomTarget,
  inviteDestination,
  LAST_TABLE_KEY,
  LAST_TABLE_TTL_MS,
  rememberTable,
  shortTableLink,
} from './table-target'

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

  it('starts an explicit bot table instead of reopening the remembered table', () => {
    remember({ roomId: 'river-remembered', venueId: 'rooftop', atMs: Date.now() })
    setLocation('?new=1&bots=fill&strength=tough')
    expect(initialRoomTarget()).toMatchObject({
      roomId: expect.stringMatching(/^river-[0-9a-f]{8}$/),
      botSeats: 7,
      botPreset: 'tough',
    })
  })

  it('creates a human-only table and ignores made-up strength names', () => {
    setLocation('?new=1&bots=off&strength=legend')
    const target = initialRoomTarget()
    expect(target.botSeats).toBe(0)
    expect(target.botPreset).toBeUndefined()
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

describe('the address bar at a table', () => {
  /** A page at the table, with the history calls it makes written down. */
  function atTable(search: string, storage: 'works' | 'refuses' = 'works'): string[] {
    const replaced: string[] = []
    vi.stubGlobal('window', {
      location: { search, href: `https://river.test/table${search}` },
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          if (storage === 'refuses') throw new Error('storage is full')
          store.set(key, value)
        },
      },
      history: {
        state: null,
        replaceState: (_state: unknown, _unused: string, url: string) => void replaced.push(url),
      },
    })
    return replaced
  }

  const table = { roomId: 'river-a26e84b0', inviteCode: 'CVNDK8', venueId: 'rooftop' } as const

  it('remembers the table and leaves only /table in the address bar', () => {
    const replaced = atTable('?room=river-a26e84b0&code=CVNDK8&venue=rooftop')
    rememberTable(table)
    expect(replaced).toEqual(['/table'])
    expect(JSON.parse(store.get(LAST_TABLE_KEY) ?? 'null')).toMatchObject(table)
  })

  it('goes back to the same table when /table is reloaded', () => {
    atTable('?room=river-a26e84b0&code=CVNDK8&venue=rooftop')
    rememberTable(table)
    setLocation('')
    expect(initialRoomTarget()).toEqual({ ...table, expired: false })
  })

  it('leaves an address that is already /table alone', () => {
    const replaced = atTable('')
    rememberTable(table)
    expect(replaced).toEqual([])
    expect(store.has(LAST_TABLE_KEY)).toBe(true)
  })

  it('keeps the full address when this browser will not remember the table', () => {
    // /table on its own would open a new table for a browser that cannot keep
    // this one, so the address stays the only way back to the seat.
    const replaced = atTable('?room=river-a26e84b0&code=CVNDK8&venue=rooftop', 'refuses')
    rememberTable(table)
    expect(replaced).toEqual([])
  })

  it('writes the full address for a new table this browser will not remember', () => {
    // Opened as a new table, the address names no room at all, so reloading it
    // would mint another table and strand the seat at this one.
    const replaced = atTable('?new=1&bots=fill&strength=tough', 'refuses')
    rememberTable(table)
    expect(replaced).toEqual(['/table?room=river-a26e84b0&code=CVNDK8&venue=rooftop'])
  })
})

describe('following a short link', () => {
  /** A browser on /t/:code, whose storage keeps things or refuses to. */
  function onShortLink(storage: 'works' | 'refuses' = 'works'): void {
    vi.stubGlobal('window', {
      location: { search: '', href: 'https://river.test/t/CVNDK8' },
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          if (storage === 'refuses') throw new Error('storage is full')
          store.set(key, value)
        },
      },
    })
  }

  /** A server that answers every lookup the same way, and notes what it was asked. */
  function server(status: number, body: unknown): { request: typeof fetch; asked: string[] } {
    const asked: string[] = []
    const request = (async (input: string) => {
      asked.push(input)
      return new Response(JSON.stringify(body), { status })
    }) as unknown as typeof fetch
    return { request, asked }
  }

  const live = { roomId: 'river-a26e84b0', venueId: 'basement' }

  it('remembers the live table and opens /table, which then finds it', async () => {
    onShortLink()
    const { request, asked } = server(200, live)
    await expect(followShortLink('CVNDK8', request)).resolves.toEqual({
      kind: 'open',
      address: '/table',
    })
    expect(asked).toEqual(['/api/tables/by-code/CVNDK8'])
    setLocation('')
    expect(initialRoomTarget()).toEqual({ ...live, inviteCode: 'CVNDK8', expired: false })
  })

  it('reads a code typed in lower case as the code it is', async () => {
    onShortLink()
    const { request, asked } = server(200, live)
    await followShortLink('cvndk8', request)
    expect(asked).toEqual(['/api/tables/by-code/CVNDK8'])
    expect(JSON.parse(store.get(LAST_TABLE_KEY) ?? 'null')).toMatchObject({ inviteCode: 'CVNDK8' })
  })

  it('opens the full address when this browser will not remember the table', async () => {
    onShortLink('refuses')
    const { request } = server(200, live)
    await expect(followShortLink('CVNDK8', request)).resolves.toEqual({
      kind: 'open',
      address: '/table?room=river-a26e84b0&code=CVNDK8&venue=basement',
    })
  })

  it('says a code with no live table has closed, and remembers nothing', async () => {
    onShortLink()
    for (const status of [404, 400]) {
      const { request } = server(status, { error: 'That table has closed.' })
      await expect(followShortLink('CVNDK8', request)).resolves.toEqual({ kind: 'closed' })
    }
    expect(store.has(LAST_TABLE_KEY)).toBe(false)
  })

  it('says a code that cannot be one has closed, without asking the server', async () => {
    onShortLink()
    const { request, asked } = server(200, live)
    for (const code of ['', 'CVNDK', 'CVNDK88', 'CV DK8', '../api']) {
      await expect(followShortLink(code, request)).resolves.toEqual({ kind: 'closed' })
    }
    expect(asked).toEqual([])
  })

  it('does not call a table closed when the server could not be asked', async () => {
    // Telling somebody their friends' table has gone, when River was only
    // restarting, sends them away from a game that is still going.
    onShortLink()
    const down = (async () => {
      throw new TypeError('network down')
    }) as unknown as typeof fetch
    await expect(followShortLink('CVNDK8', down)).resolves.toEqual({ kind: 'unreachable' })
    for (const [status, body] of [
      [503, { error: 'restarting' }],
      [200, { roomId: 42 }],
    ] as const) {
      const { request } = server(status, body)
      await expect(followShortLink('CVNDK8', request)).resolves.toEqual({ kind: 'unreachable' })
    }
    expect(store.has(LAST_TABLE_KEY)).toBe(false)
  })
})

describe('invite links', () => {
  it('shares a table as its invite code on the end of the site address', () => {
    expect(shortTableLink('CVNDK8', 'https://playriver.uk')).toBe('https://playriver.uk/t/CVNDK8')
  })

  it('takes a pasted short link to the page that finds its table', () => {
    for (const pasted of [
      'https://playriver.uk/t/CVNDK8',
      'https://playriver.uk/t/cvndk8/',
      'playriver.uk/t/CVNDK8',
      '/t/CVNDK8',
    ]) {
      expect(inviteDestination(pasted, 'https://playriver.uk'), pasted).toBe('/t/CVNDK8')
    }
  })

  it('still opens the long links shared before there were short ones', () => {
    expect(
      inviteDestination(
        'https://playriver.uk/table?room=river-a26e84b0&code=CVNDK8&venue=rooftop',
        'https://playriver.uk',
      ),
    ).toBe('/table?room=river-a26e84b0&code=CVNDK8&venue=rooftop')
    // From when the table was the whole site, before the menu existed.
    expect(
      inviteDestination('https://playriver.uk/?room=river-a26e84b0&code=CVNDK8', 'https://x.test'),
    ).toBe('/table?room=river-a26e84b0&code=CVNDK8')
  })

  it('finds no table in a link that does not name one', () => {
    for (const pasted of [
      'https://playriver.uk/',
      'https://playriver.uk/table?room=river-a26e84b0',
      'https://playriver.uk/t/NOPE',
      'https://playriver.uk/t/CVNDK8/extra',
      'hello',
    ]) {
      expect(inviteDestination(pasted, 'https://playriver.uk'), pasted).toBeNull()
    }
  })
})

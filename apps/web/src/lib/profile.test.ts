import { describe, expect, it } from 'vitest'
import { loadProfile, memberSinceLabel, profilePath } from './profile'

/**
 * The profile page asks the server and draws what comes back. What matters on
 * this side is that "there is no such member" and "River could not be asked"
 * never look alike, and that the badge only links to a page that can exist.
 */

function server(status: number, body: unknown): { request: typeof fetch; asked: string[] } {
  const asked: string[] = []
  const request = (async (input: string) => {
    asked.push(input)
    return new Response(JSON.stringify(body), { status })
  }) as unknown as typeof fetch
  return { request, asked }
}

describe('a profile address', () => {
  it('is the player name under /p/', () => {
    expect(profilePath('Zain')).toBe('/p/Zain')
    expect(profilePath('Zain Butt')).toBe('/p/Zain%20Butt')
    expect(profilePath('a/b')).toBe('/p/a%2Fb')
  })

  it('does not exist for the name every player starts with, or for no name', () => {
    // A member still called Player has no page to link to.
    expect(profilePath('Player')).toBeNull()
    expect(profilePath('')).toBeNull()
  })
})

describe('loading a profile', () => {
  it('reads a member profile, and only the fields a profile has', async () => {
    const { request, asked } = server(200, {
      name: 'Zain Butt',
      memberSince: '2026-08-23',
      extra: 'not drawn',
    })
    await expect(loadProfile('Zain Butt', request)).resolves.toEqual({
      kind: 'found',
      profile: { name: 'Zain Butt', memberSince: '2026-08-23' },
    })
    expect(asked).toEqual(['/api/profiles/Zain%20Butt'])
  })

  it('reads a guest, an unknown name or a malformed one as no such member', async () => {
    for (const status of [404, 400]) {
      const { request } = server(status, { error: 'No member goes by that name.' })
      await expect(loadProfile('Guesty', request)).resolves.toEqual({ kind: 'missing' })
    }
  })

  it('says River could not be asked, rather than that nobody is there', async () => {
    const down = (async () => {
      throw new TypeError('network down')
    }) as unknown as typeof fetch
    await expect(loadProfile('Zain', down)).resolves.toEqual({ kind: 'unavailable' })
    for (const [status, body] of [
      [503, { error: 'Profiles cannot be read right now.' }],
      [200, { name: 'Zain' }],
    ] as const) {
      const { request } = server(status, body)
      await expect(loadProfile('Zain', request)).resolves.toEqual({ kind: 'unavailable' })
    }
  })
})

describe('member since', () => {
  it('reads as the month and year', () => {
    expect(memberSinceLabel('2026-08-23')).toBe('August 2026')
    expect(memberSinceLabel('2026-01-01')).toBe('January 2026')
  })
})

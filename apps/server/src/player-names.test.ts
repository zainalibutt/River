import { describe, expect, it } from 'vitest'
import { SupabasePlayerNames } from './player-names.js'

const PLAYER_ID = '323c30d2-9e36-4c4d-96c8-a315322b113d'

function names(respond: () => Response) {
  const calls: string[] = []
  const reader = new SupabasePlayerNames({
    supabaseUrl: 'https://river.test/',
    serviceRoleKey: 'service-role',
    fetch: async (target) => {
      calls.push(String(target))
      return respond()
    },
  })
  return { reader, calls }
}

describe('a member name read for a seat', () => {
  it("reads the player's display name with the service key", async () => {
    const { reader, calls } = names(() => Response.json([{ display_name: 'QuietHeron42' }]))
    expect(await reader.seatName(PLAYER_ID)).toBe('QuietHeron42')
    expect(calls).toEqual([
      `https://river.test/rest/v1/players?id=eq.${PLAYER_ID}&select=display_name`,
    ])
  })

  it('gives no name for a missing player, the unchosen default, or a name of the wrong shape', async () => {
    for (const body of [[], [{ display_name: 'Player' }], [{ display_name: '<b>x</b>' }], [{}]]) {
      expect(await names(() => Response.json(body)).reader.seatName(PLAYER_ID)).toBeNull()
    }
  })

  it('fails loudly on a refused request', async () => {
    const { reader } = names(() => new Response('no', { status: 500 }))
    await expect(reader.seatName(PLAYER_ID)).rejects.toThrow('500')
  })
})

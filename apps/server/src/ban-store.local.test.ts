import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SupabaseBanList } from './ban-store.js'

// Against the local development database only: `npm run db:start`, then
// `node scripts/dev-db.mjs exec npx vitest run apps/server/src/ban-store.local.test.ts`.
const baseUrl = process.env.RIVER_BOT_CANARY_URL
const serviceRoleKey = process.env.RIVER_BOT_CANARY_SERVICE_KEY
const anonKey = process.env.SUPABASE_ANON_KEY
const local =
  baseUrl !== undefined &&
  ['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname) &&
  serviceRoleKey !== undefined

describe.skipIf(!local)('bans are kept in the database', () => {
  const url = baseUrl ?? ''
  const key = serviceRoleKey ?? ''
  const options = { supabaseUrl: url, serviceRoleKey: key }

  it('remembers a ban across two servers, and lifts it for both', async () => {
    const playerId = randomUUID()
    const before = new SupabaseBanList(options)
    expect(await before.isBanned(playerId)).toBe(false)
    await before.setBanned(playerId, true)

    // A second list holds nothing the first one learned: it is the server
    // that starts after a deploy.
    const after = new SupabaseBanList(options)
    expect(await after.isBanned(playerId)).toBe(true)
    expect(await after.isBanned(playerId.toUpperCase())).toBe(true)
    expect(await after.list()).toContain(playerId)

    await after.setBanned(playerId, false)
    expect(await before.isBanned(playerId)).toBe(false)
    expect(await before.list()).not.toContain(playerId)
  })

  it('bans once however often it is asked, keeping the first date', async () => {
    const playerId = randomUUID()
    const bans = new SupabaseBanList(options)
    const rows = async () => {
      const response = await fetch(
        `${url}/rest/v1/player_bans?player_id=eq.${playerId}&select=banned_at`,
        { headers: { apikey: key, authorization: `Bearer ${key}` } },
      )
      expect(response.status).toBe(200)
      return (await response.json()) as { banned_at: string }[]
    }
    try {
      await bans.setBanned(playerId, true)
      const first = await rows()
      expect(first).toHaveLength(1)
      await bans.setBanned(playerId, true)
      expect(await rows()).toEqual(first)

      await bans.setBanned(playerId, false)
      await bans.setBanned(playerId, false)
      expect(await rows()).toEqual([])
    } finally {
      await bans.setBanned(playerId, false)
    }
  })

  it('lists bans in order', async () => {
    const bans = new SupabaseBanList(options)
    const players: string[] = [randomUUID(), randomUUID(), randomUUID()]
    try {
      for (const playerId of players) await bans.setBanned(playerId, true)
      const listed = (await bans.list()).filter((playerId) => players.includes(playerId))
      expect(listed).toEqual([...players].sort())
    } finally {
      for (const playerId of players) await bans.setBanned(playerId, false)
    }
  })

  it.skipIf(anonKey === undefined)('shows and gives nothing to a player', async () => {
    const playerId = randomUUID()
    const bans = new SupabaseBanList(options)
    const headers = {
      apikey: anonKey ?? '',
      authorization: `Bearer ${anonKey ?? ''}`,
      'content-type': 'application/json',
    }
    try {
      await bans.setBanned(playerId, true)
      const read = await fetch(`${url}/rest/v1/player_bans?select=player_id`, { headers })
      expect(read.ok).toBe(false)
      const lifted = await fetch(`${url}/rest/v1/player_bans?player_id=eq.${playerId}`, {
        method: 'DELETE',
        headers,
      })
      expect(lifted.ok).toBe(false)
      const written = await fetch(`${url}/rest/v1/player_bans`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ player_id: randomUUID() }),
      })
      expect(written.ok).toBe(false)
      expect(await bans.isBanned(playerId)).toBe(true)
    } finally {
      await bans.setBanned(playerId, false)
    }
  })
})

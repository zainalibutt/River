import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SupabaseLedger } from './ledger.js'

// Against the local development database only: `npm run db:start`, then
// `node scripts/dev-db.mjs exec npx vitest run apps/server/src/player-erasure.local.test.ts`.
const baseUrl = process.env.RIVER_BOT_CANARY_URL
const serviceRoleKey = process.env.RIVER_BOT_CANARY_SERVICE_KEY
const local =
  baseUrl !== undefined &&
  ['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname) &&
  serviceRoleKey !== undefined

describe.skipIf(!local)('erasing a player keeps the ledger and nothing else', () => {
  const url = baseUrl ?? ''
  const key = serviceRoleKey ?? ''
  const headers = {
    apikey: key,
    authorization: `Bearer ${key}`,
    'content-type': 'application/json',
  }
  const ledger = new SupabaseLedger({ supabaseUrl: url, serviceRoleKey: key })

  async function player(): Promise<string> {
    const created = await fetch(`${url}/auth/v1/admin/users`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email: `erasure-${randomUUID()}@example.invalid`,
        email_confirm: true,
      }),
    })
    expect(created.status).toBe(200)
    return ((await created.json()) as { id: string }).id
  }

  async function erase(playerId: string): Promise<Response> {
    return fetch(`${url}/rest/v1/rpc/erase_player`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ p_player_id: playerId }),
    })
  }

  async function playerRow(playerId: string) {
    const response = await fetch(
      `${url}/rest/v1/players?id=eq.${playerId}&select=display_name,erased_at`,
      { headers },
    )
    return ((await response.json()) as { display_name: string; erased_at: string | null }[])[0]
  }

  it('removes the account and the name, and keeps every chip entry under the player id', async () => {
    const playerId = await player()
    await ledger.apply({
      playerId,
      delta: -1_000,
      reason: 'table_buy_in',
      ref: `erase-${randomUUID()}`,
    })
    const balance = await ledger.balance(playerId)
    const before = await playerRow(playerId)

    expect((await erase(playerId)).status).toBe(204)

    const account = await fetch(`${url}/auth/v1/admin/users/${playerId}`, { headers })
    expect(account.status).toBe(404)
    const after = await playerRow(playerId)
    expect(after?.display_name).toMatch(/^Erased_[0-9a-f]{12}$/)
    expect(after?.display_name).not.toBe(before?.display_name)
    expect(after?.erased_at).not.toBeNull()
    expect(await ledger.balance(playerId)).toBe(balance)
  })

  it('refuses to delete an account whose player has not been erased', async () => {
    const playerId = await player()
    const deleted = await fetch(`${url}/auth/v1/admin/users/${playerId}`, {
      method: 'DELETE',
      headers,
    })
    expect(deleted.ok).toBe(false)
    expect((await playerRow(playerId))?.erased_at).toBeNull()
  })

  it('refuses to erase a player still holding an open seat', async () => {
    const playerId = await player()
    const seating = {
      playerId,
      ref: `erase-seat:${randomUUID()}`,
      buyIn: 1_000,
      openedAtMs: Date.now() - 60_000,
    }
    await ledger.openWith(
      { playerId, delta: -1_000, reason: 'table_buy_in', ref: `${seating.ref}:debit` },
      seating,
    )
    const refused = await erase(playerId)
    expect(refused.ok).toBe(false)
    expect(await refused.text()).toContain('open seat')
    const account = await fetch(`${url}/auth/v1/admin/users/${playerId}`, { headers })
    expect(account.status).toBe(200)
  })
})

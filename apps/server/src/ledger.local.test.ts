import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SupabaseLedger } from './ledger.js'

// Against the local development database only: `npm run db:start`, then
// `node scripts/dev-db.mjs exec npx vitest run apps/server/src/ledger.local.test.ts`.
const baseUrl = process.env.RIVER_BOT_CANARY_URL
const serviceRoleKey = process.env.RIVER_BOT_CANARY_SERVICE_KEY
const local =
  baseUrl !== undefined &&
  ['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname) &&
  serviceRoleKey !== undefined

describe.skipIf(!local)('a seat moves its chips and its seating in one transaction', () => {
  const url = baseUrl ?? ''
  const key = serviceRoleKey ?? ''
  const headers = {
    apikey: key,
    authorization: `Bearer ${key}`,
    'content-type': 'application/json',
  }
  const ledger = new SupabaseLedger({ supabaseUrl: url, serviceRoleKey: key })

  /** A new account, with the signup bankroll its trigger grants. */
  async function player(): Promise<string> {
    const created = await fetch(`${url}/auth/v1/admin/users`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email: `seating-${randomUUID()}@example.invalid`,
        email_confirm: true,
      }),
    })
    expect(created.status).toBe(200)
    return ((await created.json()) as { id: string }).id
  }

  async function seatingRow(playerId: string, ref: string) {
    const response = await fetch(
      `${url}/rest/v1/table_seatings?player_id=eq.${playerId}&ref=eq.${encodeURIComponent(ref)}&select=buy_in,closed_at`,
      { headers },
    )
    expect(response.status).toBe(200)
    return ((await response.json()) as { buy_in: number; closed_at: string | null }[])[0]
  }

  function seat(playerId: string, buyIn: number) {
    return { playerId, ref: `river-local:${randomUUID()}`, buyIn, openedAtMs: Date.now() - 60_000 }
  }

  it('opens a seating with its buy-in, and a retry neither pays nor reopens twice', async () => {
    const playerId = await player()
    const start = await ledger.balance(playerId)
    const seating = seat(playerId, 20_000)
    const debit = { playerId, delta: -20_000, reason: 'table_buy_in', ref: `${seating.ref}:debit` }
    expect(await ledger.openWith(debit, seating)).toBe(start - 20_000)
    expect(await seatingRow(playerId, seating.ref)).toEqual({ buy_in: 20_000, closed_at: null })

    await ledger.close(seating)
    // A retry of the debit after its reply was lost: no second debit, and the
    // seating that has since closed stays closed.
    expect(await ledger.openWith(debit, seating)).toBe(start - 20_000)
    expect((await seatingRow(playerId, seating.ref))?.closed_at).not.toBeNull()
  })

  it('writes no seating when the buy-in is refused', async () => {
    const playerId = await player()
    const start = await ledger.balance(playerId)
    const seating = seat(playerId, start + 1)
    await expect(
      ledger.openWith(
        { playerId, delta: -(start + 1), reason: 'table_buy_in', ref: `${seating.ref}:debit` },
        seating,
      ),
    ).rejects.toThrow('insufficient balance')
    expect(await seatingRow(playerId, seating.ref)).toBeUndefined()
    expect(await ledger.balance(playerId)).toBe(start)
  })

  it('takes the debit back when the seating cannot be written', async () => {
    const playerId = await player()
    const start = await ledger.balance(playerId)
    // A seating must cost something, so this one fails its check after the
    // debit has been written, and the transaction takes both back.
    const seating = seat(playerId, 0)
    await expect(
      ledger.openWith(
        { playerId, delta: -20_000, reason: 'table_buy_in', ref: `${seating.ref}:debit` },
        seating,
      ),
    ).rejects.toThrow()
    expect(await ledger.balance(playerId)).toBe(start)
    expect(await seatingRow(playerId, seating.ref)).toBeUndefined()
  })

  it('closes a seating with its payout, and leaves it open when the payout is refused', async () => {
    const playerId = await player()
    const start = await ledger.balance(playerId)
    const seating = seat(playerId, 20_000)
    await ledger.openWith(
      { playerId, delta: -20_000, reason: 'table_buy_in', ref: `${seating.ref}:debit` },
      seating,
    )
    const credit = {
      playerId,
      delta: 25_000,
      reason: 'table_cash_out',
      ref: `${seating.ref}:credit`,
    }
    // Its reference already holds a different entry, so the payout is refused
    // and the seating stays open.
    await ledger.apply({ ...credit, delta: 1 })
    await expect(ledger.closeWith(credit, seating)).rejects.toThrow('ledger ref reused')
    expect((await seatingRow(playerId, seating.ref))?.closed_at).toBeNull()

    const other = seat(playerId, 20_000)
    await ledger.openWith(
      { playerId, delta: -20_000, reason: 'table_buy_in', ref: `${other.ref}:debit` },
      other,
    )
    expect(
      await ledger.closeWith(
        { playerId, delta: 25_000, reason: 'table_cash_out', ref: `${other.ref}:credit` },
        other,
      ),
    ).toBe(start - 20_000 + 1 - 20_000 + 25_000)
    expect((await seatingRow(playerId, other.ref))?.closed_at).not.toBeNull()
    const open = await ledger.unsettled(Date.now())
    expect(open.some((entry) => entry.ref === other.ref)).toBe(false)
    expect(open.some((entry) => entry.ref === seating.ref)).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import { type AdminContext, applyAdminAction, MAX_GRANT, MemoryBanList } from './admin.js'
import type { Ledger, LedgerEntry } from './ledger.js'

const DEV = 'c1f9a4de-1f0b-4d4a-8a2c-2b6f0e5a7d31'
const TARGET = '323c30d2-9e36-4c4d-96c8-a315322b113d'

class MemoryLedger implements Ledger {
  readonly balances = new Map([[TARGET, 100_000]])
  readonly entries: LedgerEntry[] = []
  private readonly refs = new Set<string>()

  async balance(playerId: string): Promise<number> {
    return this.balances.get(playerId) ?? 0
  }

  async apply(entry: LedgerEntry): Promise<number> {
    const key = `${entry.playerId}:${entry.ref}`
    if (this.refs.has(key)) return this.balance(entry.playerId)
    const next = (this.balances.get(entry.playerId) ?? 0) + entry.delta
    if (next < 0) throw new Error('insufficient balance')
    this.refs.add(key)
    this.entries.push(entry)
    this.balances.set(entry.playerId, next)
    return next
  }
}

function context(overrides: Partial<AdminContext> = {}): AdminContext {
  return {
    ledger: new MemoryLedger(),
    bans: new MemoryBanList(),
    actorId: DEV,
    ref: 'req-1',
    ...overrides,
  }
}

describe('developer chip grants', () => {
  it('credits a bankroll and reports the new balance', async () => {
    const ledger = new MemoryLedger()
    const outcome = await applyAdminAction(
      { kind: 'grantChips', targetPlayerId: TARGET, amount: 25_000 },
      context({ ledger }),
    )
    expect(outcome).toEqual({ kind: 'chipsGranted', targetPlayerId: TARGET, balance: 125_000 })
    expect(ledger.entries[0]?.reason).toBe('admin_grant')
  })

  it('takes chips back, and names the deduction separately in the ledger', async () => {
    const ledger = new MemoryLedger()
    const outcome = await applyAdminAction(
      { kind: 'grantChips', targetPlayerId: TARGET, amount: -40_000 },
      context({ ledger }),
    )
    expect(outcome).toMatchObject({ kind: 'chipsGranted', balance: 60_000 })
    // A grant and a clawback must be told apart when the ledger is read back,
    // or an audit cannot tell a gift from a correction.
    expect(ledger.entries[0]?.reason).toBe('admin_deduction')
  })

  it('credits once when the same request is retried', async () => {
    const ledger = new MemoryLedger()
    const action = { kind: 'grantChips', targetPlayerId: TARGET, amount: 5_000 } as const
    await applyAdminAction(action, context({ ledger, ref: 'same' }))
    const second = await applyAdminAction(action, context({ ledger, ref: 'same' }))
    expect(second).toMatchObject({ balance: 105_000 })
    expect(ledger.entries).toHaveLength(1)
  })

  it('refuses a deduction the balance cannot cover rather than going negative', async () => {
    const ledger = new MemoryLedger()
    const outcome = await applyAdminAction(
      { kind: 'grantChips', targetPlayerId: TARGET, amount: -500_000 },
      context({ ledger }),
    )
    expect(outcome.kind).toBe('refused')
    expect(await ledger.balance(TARGET)).toBe(100_000)
  })

  it('refuses a fat-fingered amount, a fractional one, and nothing at all', async () => {
    for (const amount of [MAX_GRANT + 1, -(MAX_GRANT + 1), 12.5, 0, Number.NaN]) {
      const outcome = await applyAdminAction(
        { kind: 'grantChips', targetPlayerId: TARGET, amount },
        context(),
      )
      expect(outcome.kind).toBe('refused')
    }
  })

  it('refuses anything that is not a player id', async () => {
    const outcome = await applyAdminAction(
      { kind: 'grantChips', targetPlayerId: 'everyone', amount: 100 },
      context(),
    )
    expect(outcome).toEqual({ kind: 'refused', reason: 'That is not a player id.' })
  })
})

describe('developer bans', () => {
  it('bans, lists, and lifts', async () => {
    const bans = new MemoryBanList()
    await applyAdminAction(
      { kind: 'setBan', targetPlayerId: TARGET, banned: true },
      context({ bans }),
    )
    expect(await bans.isBanned(TARGET)).toBe(true)
    expect(await applyAdminAction({ kind: 'listBans' }, context({ bans }))).toEqual({
      kind: 'bans',
      playerIds: [TARGET],
    })

    await applyAdminAction(
      { kind: 'setBan', targetPlayerId: TARGET, banned: false },
      context({ bans }),
    )
    expect(await bans.isBanned(TARGET)).toBe(false)
  })

  it('refuses to let a developer ban themselves', async () => {
    const bans = new MemoryBanList()
    const outcome = await applyAdminAction(
      { kind: 'setBan', targetPlayerId: DEV, banned: true },
      context({ bans }),
    )
    // There is no way back from this one. The only account that can lift a ban
    // would be the account holding it.
    expect(outcome).toEqual({ kind: 'refused', reason: 'A developer cannot ban themselves.' })
    expect(await bans.isBanned(DEV)).toBe(false)
  })
})

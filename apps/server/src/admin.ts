import type { Ledger } from './ledger.js'

/**
 * The developer powers.
 *
 * River is one person's game and it needs an account that can reach into it -
 * top somebody up, take chips back off a table that got silly, remove someone
 * who will not behave. That account is identified by a claim in the signed
 * token (see `auth.ts`), and this module is what it may actually do.
 *
 * Everything here is deliberately small. A developer account is the single
 * most valuable credential in the game, so the surface it opens is the shortest
 * list that does the job rather than a general escape hatch, and each action
 * carries its own refusal rules rather than trusting the caller to be careful.
 */

/** Nobody needs to move more than this in one action, and a typo can. */
export const MAX_GRANT = 10_000_000

export interface BanList {
  isBanned(playerId: string): Promise<boolean>
  setBanned(playerId: string, banned: boolean): Promise<void>
  list(): Promise<string[]>
}

/**
 * A ban list that lives as long as the process.
 *
 * Honest about what it is: restarting the server forgets every ban. That is
 * enough for a table full of friends and a developer who is present, and it is
 * not enough for a public game - the fix is another implementation of `BanList`
 * backed by a table, which is why this is an interface and not a Set inside the
 * hub.
 */
export class MemoryBanList implements BanList {
  private readonly banned = new Set<string>()

  async isBanned(playerId: string): Promise<boolean> {
    return this.banned.has(playerId)
  }

  async setBanned(playerId: string, banned: boolean): Promise<void> {
    if (banned) this.banned.add(playerId)
    else this.banned.delete(playerId)
  }

  async list(): Promise<string[]> {
    return [...this.banned].sort()
  }
}

export type AdminAction =
  | { kind: 'grantChips'; targetPlayerId: string; amount: number }
  | { kind: 'setBan'; targetPlayerId: string; banned: boolean }
  | { kind: 'listBans' }

export type AdminOutcome =
  | { kind: 'chipsGranted'; targetPlayerId: string; balance: number }
  | { kind: 'banChanged'; targetPlayerId: string; banned: boolean }
  | { kind: 'bans'; playerIds: string[] }
  | { kind: 'refused'; reason: string }

export interface AdminContext {
  ledger: Ledger
  bans: BanList
  /** The developer performing the action. */
  actorId: string
  /**
   * Makes the action idempotent. A retried request must not credit twice, and
   * the client retries on reconnect.
   */
  ref: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function applyAdminAction(
  action: AdminAction,
  context: AdminContext,
): Promise<AdminOutcome> {
  if (action.kind === 'listBans') {
    return { kind: 'bans', playerIds: await context.bans.list() }
  }

  if (!UUID.test(action.targetPlayerId)) {
    return { kind: 'refused', reason: 'That is not a player id.' }
  }

  if (action.kind === 'setBan') {
    // Banning yourself locks the only account that can lift the ban out of the
    // game. There is no recovery path for that short of a database console.
    if (action.targetPlayerId === context.actorId) {
      return { kind: 'refused', reason: 'A developer cannot ban themselves.' }
    }
    await context.bans.setBanned(action.targetPlayerId, action.banned)
    return { kind: 'banChanged', targetPlayerId: action.targetPlayerId, banned: action.banned }
  }

  const { amount } = action
  if (!Number.isSafeInteger(amount) || amount === 0) {
    return { kind: 'refused', reason: 'Grant a whole number of chips.' }
  }
  if (Math.abs(amount) > MAX_GRANT) {
    return { kind: 'refused', reason: `Grants are capped at ${MAX_GRANT.toLocaleString()}.` }
  }
  try {
    const balance = await context.ledger.apply({
      playerId: action.targetPlayerId,
      delta: amount,
      // Its own reason, so a developer grant is never mistaken for winnings
      // when the ledger is read back.
      reason: amount > 0 ? 'admin_grant' : 'admin_deduction',
      ref: context.ref,
    })
    return { kind: 'chipsGranted', targetPlayerId: action.targetPlayerId, balance }
  } catch {
    // The ledger refuses to take a balance below zero, which is the expected
    // failure when a deduction is larger than what somebody has.
    return { kind: 'refused', reason: 'The ledger refused that adjustment.' }
  }
}

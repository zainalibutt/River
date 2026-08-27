import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import {
  ensureRiverSession,
  loadBrowserAuthConfig,
  signInToRiver,
  upgradeRiverSession,
} from './auth.js'

const PLAYER_ID = '323c30d2-9e36-4c4d-96c8-a315322b113d'
const SESSION = {
  access_token: 'access',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: 123,
  refresh_token: 'refresh',
  user: { id: PLAYER_ID },
} as Session

describe('browser auth boundary', () => {
  it('loads only public auth configuration', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          supabaseUrl: 'https://river.supabase.co',
          publishableKey: 'publishable',
        }),
      ),
    )
    await expect(loadBrowserAuthConfig(request)).resolves.toEqual({
      supabaseUrl: 'https://river.supabase.co',
      publishableKey: 'publishable',
    })
  })

  it('reuses a session or creates one anonymously when absent', async () => {
    const existing = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: SESSION }, error: null }),
        signInAnonymously: vi.fn(),
      },
    } as unknown as SupabaseClient
    await expect(ensureRiverSession(existing)).resolves.toBe(SESSION)
    expect(existing.auth.signInAnonymously).not.toHaveBeenCalled()

    const anonymous = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        signInAnonymously: vi
          .fn()
          .mockResolvedValue({ data: { session: SESSION, user: SESSION.user }, error: null }),
      },
    } as unknown as SupabaseClient
    await expect(ensureRiverSession(anonymous)).resolves.toBe(SESSION)
  })

  it('requires an email upgrade to preserve the player id', async () => {
    const updateUser = vi.fn().mockResolvedValue({ data: { user: { id: PLAYER_ID } }, error: null })
    const client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: PLAYER_ID } }, error: null }),
        updateUser,
      },
    } as unknown as SupabaseClient
    await expect(
      upgradeRiverSession(client, 'player@example.com', 'https://river.example'),
    ).resolves.toBe(PLAYER_ID)
    expect(updateUser).toHaveBeenCalledWith(
      { email: 'player@example.com' },
      { emailRedirectTo: 'https://river.example' },
    )
  })
})

/**
 * Two different people type into one box.
 *
 * A first-timer wants their guest session kept, because the chips they just won
 * are on it. A player returning on a new browser wants to be let back into the
 * account they already have. The product only ever handled the first, so the
 * second got "422: a user with this email address has already been registered"
 * and a dead end - which is what the developer account hit on its own menu.
 */
describe('signing in', () => {
  function clientWith(updateUser: unknown, signInWithOtp = vi.fn()) {
    return {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: PLAYER_ID } }, error: null }),
        updateUser,
        signInWithOtp,
      },
    } as unknown as SupabaseClient
  }

  it('keeps a guest session when the address is free', async () => {
    const updateUser = vi.fn().mockResolvedValue({ data: { user: { id: PLAYER_ID } }, error: null })
    const otp = vi.fn()
    await expect(
      signInToRiver(clientWith(updateUser, otp), 'new@example.com', 'https://river.example'),
    ).resolves.toBe('upgraded')
    // The guest keeps their player id, so the bankroll built as a guest is not
    // stranded in an account nobody can reach again.
    expect(updateUser).toHaveBeenCalled()
    expect(otp).not.toHaveBeenCalled()
  })

  it('lets a returning player back into the account they already have', async () => {
    const updateUser = vi
      .fn()
      .mockResolvedValue({ data: { user: null }, error: { status: 422, message: 'x' } })
    const otp = vi.fn().mockResolvedValue({ data: {}, error: null })
    await expect(
      signInToRiver(clientWith(updateUser, otp), 'zain@example.com', 'https://river.example'),
    ).resolves.toBe('returning')
    expect(otp).toHaveBeenCalledWith({
      email: 'zain@example.com',
      options: { emailRedirectTo: 'https://river.example' },
    })
  })

  it('recognises the collision by message as well as by status', async () => {
    const updateUser = vi.fn().mockResolvedValue({
      data: { user: null },
      error: { message: 'A user with this email address has already been registered' },
    })
    const otp = vi.fn().mockResolvedValue({ data: {}, error: null })
    await expect(signInToRiver(clientWith(updateUser, otp), 'zain@example.com')).resolves.toBe(
      'returning',
    )
  })

  it('tries the upgrade first, so a first-timer is never signed into a fresh account', async () => {
    // Order matters more than it looks. Reversed, a genuine first-timer would
    // be signed into a brand new account and the chips they just won would be
    // left behind on the guest session.
    const calls: string[] = []
    const updateUser = vi.fn(async () => {
      calls.push('update')
      return { data: { user: { id: PLAYER_ID } }, error: null }
    })
    const otp = vi.fn(async () => {
      calls.push('otp')
      return { data: {}, error: null }
    })
    await signInToRiver(clientWith(updateUser, otp), 'first@example.com')
    expect(calls).toEqual(['update'])
  })

  it('surfaces a failure that is not a collision rather than sending a link anyway', async () => {
    const updateUser = vi
      .fn()
      .mockResolvedValue({ data: { user: null }, error: { status: 500, message: 'boom' } })
    const otp = vi.fn()
    await expect(signInToRiver(clientWith(updateUser, otp), 'a@example.com')).rejects.toBeDefined()
    expect(otp).not.toHaveBeenCalled()
  })
})

import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { ensureRiverSession, loadBrowserAuthConfig, upgradeRiverSession } from './auth.js'

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

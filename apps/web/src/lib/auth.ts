import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@supabase/supabase-js'

export interface BrowserAuthConfig {
  supabaseUrl: string
  publishableKey: string
}

function isConfig(value: unknown): value is BrowserAuthConfig {
  return (
    typeof value === 'object' &&
    value !== null &&
    'supabaseUrl' in value &&
    typeof value.supabaseUrl === 'string' &&
    'publishableKey' in value &&
    typeof value.publishableKey === 'string'
  )
}

export async function loadBrowserAuthConfig(
  request: typeof fetch = fetch,
): Promise<BrowserAuthConfig> {
  const response = await request('/api/config', { cache: 'no-store' })
  const body = (await response.json()) as unknown
  if (!response.ok || !isConfig(body)) {
    throw new Error('River authentication is unavailable')
  }
  return body
}

export function createRiverAuthClient(config: BrowserAuthConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })
}

export async function ensureRiverSession(client: SupabaseClient): Promise<Session> {
  const current = await client.auth.getSession()
  if (current.error !== null) throw current.error
  if (current.data.session !== null) return current.data.session
  const anonymous = await client.auth.signInAnonymously()
  if (anonymous.error !== null) throw anonymous.error
  if (anonymous.data.session === null) throw new Error('Anonymous sign-in returned no session')
  return anonymous.data.session
}

export async function upgradeRiverSession(
  client: SupabaseClient,
  email: string,
  emailRedirectTo?: string,
): Promise<string> {
  const current = await client.auth.getUser()
  if (current.error !== null) throw current.error
  if (current.data.user === null) throw new Error('No River user to upgrade')
  const beforeId = current.data.user.id
  const upgraded =
    emailRedirectTo === undefined
      ? await client.auth.updateUser({ email })
      : await client.auth.updateUser({ email }, { emailRedirectTo })
  if (upgraded.error !== null) throw upgraded.error
  if (upgraded.data.user.id !== beforeId) {
    throw new Error('Account upgrade changed the River player id')
  }
  return beforeId
}

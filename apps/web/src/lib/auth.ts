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

/**
 * What actually happens when somebody types their email in.
 *
 * There are two different people behind that box and the product only ever
 * handled one of them.
 *
 * A guest who has never had an account wants their anonymous session *kept* -
 * their chips, streaks and cosmetics are on it, and `updateUser({ email })`
 * attaches an address to that same player id so nothing is left behind.
 *
 * A player who already has an account and is on a new browser wants to be let
 * back into it. For them `updateUser` fails with 422, "a user with this email
 * address has already been registered", because the address belongs to a
 * different row - and that is exactly what a returning player looks like. The
 * answer is a one-time link that signs them in to the account they already
 * have. Their throwaway guest session is discarded, which is right: the chips
 * they care about are on the real account.
 *
 * Trying the upgrade first matters. Doing it the other way round would sign a
 * genuine first-timer into a fresh account and silently strand the bankroll
 * they just built.
 */
export type SignInOutcome = 'upgraded' | 'returning'

export async function signInToRiver(
  client: SupabaseClient,
  email: string,
  emailRedirectTo?: string,
): Promise<SignInOutcome> {
  try {
    await upgradeRiverSession(client, email, emailRedirectTo)
    return 'upgraded'
  } catch (error) {
    if (!isAlreadyRegistered(error)) throw error
  }
  const options = emailRedirectTo === undefined ? {} : { emailRedirectTo }
  const sent = await client.auth.signInWithOtp({ email, options })
  if (sent.error !== null) throw sent.error
  return 'returning'
}

function isAlreadyRegistered(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const status = 'status' in error ? error.status : undefined
  const message = 'message' in error && typeof error.message === 'string' ? error.message : ''
  return status === 422 || /already been registered|already registered/i.test(message)
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

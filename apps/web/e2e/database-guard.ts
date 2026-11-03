import type { FullConfig } from '@playwright/test'
import { isLocalSupabaseUrl } from '../../server/src/config.js'

/**
 * The interface tests sign in, sit down and play with real chips, so they run
 * only against an app whose database is on this machine. The app is asked
 * which one it uses, rather than trusting the environment of this process,
 * because the app is a separate process started on its own.
 */
export default async function databaseGuard(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL
  if (baseURL === undefined) throw new Error('The interface tests need a base URL')
  if (!isLocalSupabaseUrl(new URL('/', baseURL).toString().replace(/\/$/, ''))) {
    throw new Error(`Refusing to test an app that is not on this machine: ${baseURL}`)
  }
  let supabaseUrl: unknown
  try {
    const response = await fetch(new URL('/api/config', baseURL))
    supabaseUrl = ((await response.json()) as { supabaseUrl?: unknown }).supabaseUrl
  } catch {
    throw new Error(`The app at ${baseURL} did not say which database it uses. Is it running?`)
  }
  if (typeof supabaseUrl !== 'string' || !isLocalSupabaseUrl(supabaseUrl)) {
    throw new Error(
      'Refusing to run the interface tests: the app is not using the local database. Start it with `npm run dev`.',
    )
  }
  for (const name of ['RIVER_BOT_CANARY_URL', 'RIVER_CONNECTED_MAIL_URL']) {
    const value = process.env[name]
    if (value !== undefined && !isLocalSupabaseUrl(value)) {
      throw new Error(`Refusing to run the interface tests: ${name} is not on this machine`)
    }
  }
}

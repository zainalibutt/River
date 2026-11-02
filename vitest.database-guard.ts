import { isLocalSupabaseUrl } from './apps/server/src/config.js'

/**
 * Most of the suite runs on fakes. The few tests that reach a database read
 * these variables, and they may reach only the local one.
 */
export default function databaseGuard(): void {
  for (const name of ['SUPABASE_URL', 'RIVER_BOT_CANARY_URL']) {
    const value = process.env[name]
    if (value !== undefined && value !== '' && !isLocalSupabaseUrl(value)) {
      throw new Error(`Refusing to run the tests: ${name} is not a database on this machine`)
    }
  }
}

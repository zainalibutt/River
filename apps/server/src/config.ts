export interface ServerConfig {
  hostname: string
  port: number
  supabaseUrl: string
  serviceRoleKey: string
}

export function readServerConfig(env: Readonly<Record<string, string | undefined>>): ServerConfig {
  const supabaseUrl = env.SUPABASE_URL
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (supabaseUrl === undefined || serviceRoleKey === undefined) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  }
  // A blank key is accepted by every check that only asks whether the variable
  // exists, and then Supabase answers every single request with "No API key
  // found". Refusing to start says the same thing once, at the only moment
  // anyone is looking.
  if (serviceRoleKey.trim().length === 0) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY must not be blank')
  }
  const url = new URL(supabaseUrl)
  if (url.protocol !== 'https:' && !isLocalSupabaseUrl(url.toString())) {
    throw new Error('SUPABASE_URL must use HTTPS outside local development')
  }
  const port = Number(env.PORT ?? 3000)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be a valid TCP port')
  }
  const hostname = env.HOST_BIND ?? '0.0.0.0'
  if (hostname !== '0.0.0.0' && hostname !== '127.0.0.1' && hostname !== '::1') {
    throw new Error('HOST_BIND must be a wildcard or loopback address')
  }
  return {
    hostname,
    port,
    supabaseUrl: url.toString().replace(/\/$/, ''),
    serviceRoleKey,
  }
}

/** A Supabase stack on this machine: the development database, never a hosted project. */
export function isLocalSupabaseUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
}

/**
 * A development server works on the local database. Pointed at a hosted
 * project, every fresh browser session there made a real guest account, and
 * every test hand moved real chips. `npm run dev` hands it the local stack;
 * anything else has to say outright that it means a hosted one.
 */
export function assertDevelopmentDatabase(env: Readonly<Record<string, string | undefined>>): void {
  const supabaseUrl = env.SUPABASE_URL
  if (supabaseUrl === undefined || isLocalSupabaseUrl(supabaseUrl)) return
  if (env.RIVER_DEV_REMOTE_DATABASE === '1') return
  throw new Error(
    'A development server refuses a hosted Supabase project. Run `npm run dev`, which uses the local database, or set RIVER_DEV_REMOTE_DATABASE=1 if a hosted one is meant.',
  )
}

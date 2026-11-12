export interface ServerConfig {
  hostname: string
  port: number
  supabaseUrl: string
  serviceRoleKey: string
}

export interface ServerResourceConfig {
  allowedOrigins: string[] | null
  maxSockets: number
  maxSocketsPerIp: number
  trustProxy: boolean
  roomIdleTimeoutMs: number
}

export function readServerResourceConfig(
  env: Readonly<Record<string, string | undefined>>,
): ServerResourceConfig {
  const positiveInteger = (name: string, fallback: number): number => {
    const value = Number(env[name] ?? fallback)
    if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) {
      throw new Error(`${name} must be a positive integer at most 2147483647`)
    }
    return value
  }
  return {
    allowedOrigins:
      env.RIVER_ALLOWED_ORIGINS === undefined
        ? null
        : env.RIVER_ALLOWED_ORIGINS.split(',')
            .map((origin) => origin.trim())
            .filter(Boolean),
    maxSockets: positiveInteger('RIVER_MAX_SOCKETS', 2_000),
    maxSocketsPerIp: positiveInteger('RIVER_MAX_SOCKETS_PER_IP', 20),
    trustProxy: env.RIVER_TRUST_PROXY === '1',
    roomIdleTimeoutMs: positiveInteger('RIVER_ROOM_IDLE_TIMEOUT_MS', 30 * 60_000),
  }
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

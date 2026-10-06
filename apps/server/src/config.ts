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
  if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    throw new Error('SUPABASE_URL must use HTTPS outside local development')
  }
  const port = Number(env.PORT ?? 3000)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be a valid TCP port')
  }
  return {
    hostname: '0.0.0.0',
    port,
    supabaseUrl: url.toString().replace(/\/$/, ''),
    serviceRoleKey,
  }
}

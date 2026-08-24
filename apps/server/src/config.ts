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
  const url = new URL(supabaseUrl)
  if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    throw new Error('SUPABASE_URL must use HTTPS outside local development')
  }
  const port = Number(env.PORT ?? 3000)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be a valid TCP port')
  }
  return {
    hostname: env.HOSTNAME ?? '0.0.0.0',
    port,
    supabaseUrl: url.toString().replace(/\/$/, ''),
    serviceRoleKey,
  }
}

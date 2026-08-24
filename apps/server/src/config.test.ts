import { describe, expect, it } from 'vitest'
import { readServerConfig } from './config.js'

describe('server config', () => {
  it('reads the single-origin runtime environment', () => {
    expect(
      readServerConfig({
        SUPABASE_URL: 'https://river.supabase.co/',
        SUPABASE_SERVICE_ROLE_KEY: 'server-only',
        PORT: '8080',
        HOSTNAME: 'container-generated-hostname',
      }),
    ).toEqual({
      hostname: '0.0.0.0',
      port: 8080,
      supabaseUrl: 'https://river.supabase.co',
      serviceRoleKey: 'server-only',
    })
  })

  it('rejects missing secrets, insecure remote URLs, and invalid ports', () => {
    expect(() => readServerConfig({})).toThrow('required')
    expect(() =>
      readServerConfig({
        SUPABASE_URL: 'http://remote.example',
        SUPABASE_SERVICE_ROLE_KEY: 'server-only',
      }),
    ).toThrow('HTTPS')
    expect(() =>
      readServerConfig({
        SUPABASE_URL: 'https://river.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'server-only',
        PORT: '70000',
      }),
    ).toThrow('valid TCP port')
  })
})

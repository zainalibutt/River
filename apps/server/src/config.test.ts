import { describe, expect, it } from 'vitest'
import {
  assertDevelopmentDatabase,
  isLocalSupabaseUrl,
  readServerConfig,
  readServerResourceConfig,
} from './config.js'

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

  it('refuses to start on a blank service role key', () => {
    expect(() =>
      readServerConfig({
        SUPABASE_URL: 'https://river.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: '   ',
      }),
    ).toThrow('must not be blank')
  })

  it('can restrict the local runtime to loopback without changing the default bind', () => {
    for (const hostname of ['127.0.0.1', '::1']) {
      expect(
        readServerConfig({
          SUPABASE_URL: 'http://127.0.0.1:55421',
          SUPABASE_SERVICE_ROLE_KEY: 'local-test',
          HOST_BIND: hostname,
        }).hostname,
      ).toBe(hostname)
    }
    expect(() =>
      readServerConfig({
        SUPABASE_URL: 'http://127.0.0.1:55421',
        SUPABASE_SERVICE_ROLE_KEY: 'local-test',
        HOST_BIND: 'remote.example',
      }),
    ).toThrow('wildcard or loopback')
  })
})

describe('the development database', () => {
  it('counts only a stack on this machine as local', () => {
    expect(isLocalSupabaseUrl('http://127.0.0.1:54321')).toBe(true)
    expect(isLocalSupabaseUrl('http://localhost:54321')).toBe(true)
    expect(isLocalSupabaseUrl('https://river.supabase.co')).toBe(false)
    expect(isLocalSupabaseUrl('http://127.0.0.1.example.com')).toBe(false)
    expect(isLocalSupabaseUrl('not a url')).toBe(false)
  })

  it('keeps a development server off a hosted project unless told otherwise', () => {
    expect(() =>
      assertDevelopmentDatabase({ SUPABASE_URL: 'http://127.0.0.1:54321' }),
    ).not.toThrow()
    expect(() => assertDevelopmentDatabase({ SUPABASE_URL: 'https://river.supabase.co' })).toThrow(
      'refuses a hosted Supabase project',
    )
    expect(() =>
      assertDevelopmentDatabase({
        SUPABASE_URL: 'https://river.supabase.co',
        RIVER_DEV_REMOTE_DATABASE: '1',
      }),
    ).not.toThrow()
  })
})

describe('server resource config', () => {
  it('defaults to permissive origins, bounded sockets, and thirty-minute room retention', () => {
    expect(readServerResourceConfig({})).toEqual({
      allowedOrigins: null,
      maxSockets: 2_000,
      maxSocketsPerIp: 20,
      trustProxy: false,
      roomIdleTimeoutMs: 1_800_000,
    })
  })

  it('reads trimmed origins, explicit proxy trust and resource overrides', () => {
    expect(
      readServerResourceConfig({
        RIVER_ALLOWED_ORIGINS: ' https://playriver.uk, http://localhost:3000 , ',
        RIVER_MAX_SOCKETS: '100',
        RIVER_MAX_SOCKETS_PER_IP: '5',
        RIVER_TRUST_PROXY: '1',
        RIVER_ROOM_IDLE_TIMEOUT_MS: '1000',
      }),
    ).toEqual({
      allowedOrigins: ['https://playriver.uk', 'http://localhost:3000'],
      maxSockets: 100,
      maxSocketsPerIp: 5,
      trustProxy: true,
      roomIdleTimeoutMs: 1000,
    })
    expect(
      readServerResourceConfig({ RIVER_ALLOWED_ORIGINS: '', RIVER_TRUST_PROXY: 'true' }),
    ).toMatchObject({ allowedOrigins: [], trustProxy: false })
  })

  it.each(['RIVER_MAX_SOCKETS', 'RIVER_MAX_SOCKETS_PER_IP', 'RIVER_ROOM_IDLE_TIMEOUT_MS'])(
    'rejects unsafe %s values',
    (name) => {
      for (const value of ['0', '-1', '', '1.5', 'NaN', 'Infinity', '2147483648']) {
        expect(() => readServerResourceConfig({ [name]: value })).toThrow(name)
      }
    },
  )
})

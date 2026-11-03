import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import type { AuthenticatedPlayer } from './auth.js'
import { BotApi } from './bot-api.js'
import { withBotApi } from './bot-api-http.js'
import {
  BOT_API_MAX_KEYS,
  botApiKeyHash,
  botApiKeyLabel,
  isBotApiKeyShape,
  MemoryBotApiKeyStore,
  newBotApiKey,
} from './bot-api-keys.js'
import { pokerGuardPolicy } from './bot-poker-guard.js'

const players: Record<string, AuthenticatedPlayer> = {
  member: { playerId: 'p-member', anonymous: false, admin: false },
  other: { playerId: 'p-other', anonymous: false, admin: false },
  guest: { playerId: 'p-guest', anonymous: true, admin: false },
}

let server: Server | undefined

afterEach(async () => {
  await new Promise<void>((resolve) =>
    server === undefined ? resolve() : server.close(() => resolve()),
  )
  server = undefined
})

/** A real HTTP server with the bot API in front of a listener that answers 'next'. */
async function start(): Promise<string> {
  const api = new BotApi({ policies: { nyx: pokerGuardPolicy } })
  const keys = new MemoryBotApiKeyStore()
  server = createServer(
    withBotApi(
      {
        api,
        keys,
        verifyToken: async (token) => {
          const player = players[token]
          if (player === undefined) throw new Error('bad token')
          return player
        },
      },
      (_request, response) => {
        response.end('next')
      },
    ),
  )
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', () => resolve()))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

async function call(
  base: string,
  path: string,
  options: { method?: string; token?: string; body?: unknown; raw?: string } = {},
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? 'POST',
    headers: options.token === undefined ? {} : { authorization: `Bearer ${options.token}` },
    ...(options.raw !== undefined
      ? { body: options.raw }
      : options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
  })
  const text = await response.text()
  let body: unknown = text
  try {
    body = text === '' ? null : JSON.parse(text)
  } catch {}
  return { status: response.status, body }
}

describe('bot API keys', () => {
  it('makes keys of a fixed shape and stores only their hash', () => {
    const key = newBotApiKey()
    expect(isBotApiKeyShape(key)).toBe(true)
    expect(isBotApiKeyShape(`${key}x`)).toBe(false)
    expect(botApiKeyHash(key)).toMatch(/^[0-9a-f]{64}$/)
    expect(newBotApiKey()).not.toBe(key)
    expect(botApiKeyLabel('  my bot\u0007 ')).toBe('my bot')
    expect(botApiKeyLabel('x'.repeat(60))).toHaveLength(40)
    expect(botApiKeyLabel(7)).toBe('')
  })

  it('verifies live keys to their owner, and stops a revoked one', async () => {
    const store = new MemoryBotApiKeyStore()
    const made = await store.create('p1', 'first')
    if (!made.ok) throw new Error(made.error)
    expect(await store.verify(made.key)).toEqual({ keyId: made.record.id, playerId: 'p1' })
    expect(await store.verify(newBotApiKey())).toBeNull()
    expect(await store.revoke('p2', made.record.id)).toBe(false)
    expect(await store.revoke('p1', made.record.id)).toBe(true)
    expect(await store.verify(made.key)).toBeNull()
    expect(await store.revoke('p1', made.record.id)).toBe(false)
  })

  it(`holds a player to ${BOT_API_MAX_KEYS} live keys`, async () => {
    const store = new MemoryBotApiKeyStore()
    const ids: string[] = []
    for (let index = 0; index < BOT_API_MAX_KEYS; index += 1) {
      const made = await store.create('p1', `k${index}`)
      if (!made.ok) throw new Error(made.error)
      ids.push(made.record.id)
    }
    expect((await store.create('p1', 'one more')).ok).toBe(false)
    await store.revoke('p1', ids[0] as string)
    expect((await store.create('p1', 'one more')).ok).toBe(true)
  })
})

describe('the bot API over HTTP', () => {
  it('passes every other path on untouched', async () => {
    const base = await start()
    const response = await fetch(`${base}/table`)
    expect(await response.text()).toBe('next')
  })

  it('lets a saved account make, list and revoke keys; guests and strangers are refused', async () => {
    const base = await start()
    expect((await call(base, '/api/bot/keys', { body: {} })).status).toBe(401)
    expect((await call(base, '/api/bot/keys', { token: 'forged', body: {} })).status).toBe(401)
    expect((await call(base, '/api/bot/keys', { token: 'guest', body: {} })).status).toBe(403)
    const made = await call(base, '/api/bot/keys', { token: 'member', body: { label: 'my bot' } })
    expect(made.status).toBe(201)
    const { key, id, label } = made.body as { key: string; id: string; label: string }
    expect(isBotApiKeyShape(key)).toBe(true)
    expect(label).toBe('my bot')
    const listed = await call(base, '/api/bot/keys', { method: 'GET', token: 'member' })
    expect(listed.status).toBe(200)
    expect(JSON.stringify(listed.body)).not.toContain(key)
    expect((listed.body as { keys: unknown[] }).keys).toHaveLength(1)
    expect(
      (await call(base, `/api/bot/keys/${id}`, { method: 'DELETE', token: 'other' })).status,
    ).toBe(404)
    expect(
      (await call(base, `/api/bot/keys/${id}`, { method: 'DELETE', token: 'member' })).status,
    ).toBe(204)
  })

  it('plays a hand with a key, and refuses a revoked key, a bad body and a huge one', async () => {
    const base = await start()
    const made = await call(base, '/api/bot/keys', { token: 'member', body: {} })
    const { key, id } = made.body as { key: string; id: string }
    const dealt = await call(base, '/api/bot/v1/hands', { token: key, body: { opponent: 'nyx' } })
    expect(dealt.status).toBe(200)
    const hand = dealt.body as { hand_id: string; seq: number; hole_cards: string[] }
    expect(hand.hole_cards).toHaveLength(2)
    const acted = await call(base, `/api/bot/v1/hands/${hand.hand_id}/act`, {
      token: key,
      body: { incr: 'c', seq: hand.seq },
    })
    expect(acted.status).toBe(200)
    expect((await call(base, '/api/bot/v1/hands', { token: key, raw: '{not json' })).status).toBe(
      400,
    )
    expect(
      (
        await call(base, '/api/bot/v1/hands', {
          token: key,
          raw: JSON.stringify({ pad: 'x'.repeat(9000) }),
        })
      ).status,
    ).toBe(413)
    await call(base, `/api/bot/keys/${id}`, { method: 'DELETE', token: 'member' })
    expect((await call(base, '/api/bot/v1/hands', { token: key, body: {} })).status).toBe(401)
    expect((await call(base, '/api/bot/nope', { token: key, body: {} })).status).toBe(404)
  })
})

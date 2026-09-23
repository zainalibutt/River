import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { SupabaseBotOpponentStore } from './bot-opponent-store.js'

const baseUrl = process.env.RIVER_BOT_CANARY_URL
const serviceRoleKey = process.env.RIVER_BOT_CANARY_SERVICE_KEY
const anonKey = process.env.RIVER_BOT_CANARY_ANON_KEY
const local =
  baseUrl !== undefined &&
  (new URL(baseUrl).hostname === '127.0.0.1' || new URL(baseUrl).hostname === 'localhost') &&
  serviceRoleKey !== undefined &&
  anonKey !== undefined

it.skipIf(!local)('persists private bot evidence through the local Supabase API', async () => {
  if (baseUrl === undefined || serviceRoleKey === undefined || anonKey === undefined) return
  const email = `bot-memory-${randomUUID()}@example.invalid`
  const password = randomUUID()
  const adminHeaders = {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    'content-type': 'application/json',
  }
  const created = await fetch(`${baseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  expect(created.status).toBe(200)
  const user = (await created.json()) as { id: string }
  expect(user.id).toMatch(/^[0-9a-f-]{36}$/)

  const store = new SupabaseBotOpponentStore({ supabaseUrl: baseUrl, serviceRoleKey })
  expect(await store.load('albie', user.id)).toBeNull()
  const hand = {
    botId: 'albie',
    playerId: user.id,
    handKey: `local-canary:${randomUUID()}`,
    observedAtMs: Date.now(),
    evidence: {
      vpip: true,
      pfr: true,
      aggressiveActions: 1,
      passiveCalls: 0,
      showdown: false,
      aggressivePotRatios: [0.75],
    },
  }
  await store.append(hand)
  await store.append(hand)
  expect((await store.load('albie', user.id))?.weightedHands).toBe(1)
  expect(await store.load('bernadette', user.id)).toBeNull()

  const session = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  expect(session.ok).toBe(true)
  const { access_token: accessToken } = (await session.json()) as { access_token: string }
  const readAsPlayer = await fetch(`${baseUrl}/rest/v1/bot_opponent_observations?select=hand_key`, {
    headers: { apikey: anonKey, authorization: `Bearer ${accessToken}` },
  })
  expect(readAsPlayer.ok).toBe(false)
  const readAsGuest = await fetch(`${baseUrl}/rest/v1/bot_opponent_observations?select=hand_key`, {
    headers: { apikey: anonKey, authorization: `Bearer ${anonKey}` },
  })
  expect(readAsGuest.ok).toBe(false)

  const deniedRow = {
    bot_id: hand.botId,
    player_id: user.id,
    model_version: 1,
    hand_key: `local-denied:${randomUUID()}`,
    observed_at: new Date(hand.observedAtMs).toISOString(),
    evidence: hand.evidence,
  }
  for (const token of [accessToken, anonKey]) {
    const insertAsPlayer = await fetch(`${baseUrl}/rest/v1/bot_opponent_observations`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(deniedRow),
    })
    expect(insertAsPlayer.ok).toBe(false)
  }
  const updateAsServer = await fetch(
    `${baseUrl}/rest/v1/bot_opponent_observations?hand_key=eq.${encodeURIComponent(hand.handKey)}`,
    {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ evidence: { ...hand.evidence, vpip: false } }),
    },
  )
  expect(updateAsServer.ok).toBe(false)
  expect((await store.load('albie', user.id))?.weightedHands).toBe(1)
})

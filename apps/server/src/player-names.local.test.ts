import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { SupabasePlayerNames } from './player-names.js'

// Against the local development database only: `npm run db:start`, then
// `node scripts/dev-db.mjs exec npx vitest run apps/server/src/player-names.local.test.ts`.
const baseUrl = process.env.RIVER_BOT_CANARY_URL
const serviceRoleKey = process.env.RIVER_BOT_CANARY_SERVICE_KEY
const local =
  baseUrl !== undefined &&
  ['127.0.0.1', 'localhost'].includes(new URL(baseUrl).hostname) &&
  serviceRoleKey !== undefined

it.skipIf(!local)('reads the name a new member was given as they arrived', async () => {
  const url = baseUrl ?? ''
  const key = serviceRoleKey ?? ''
  const headers = {
    apikey: key,
    authorization: `Bearer ${key}`,
    'content-type': 'application/json',
  }
  const created = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: `names-${randomUUID()}@example.invalid`, email_confirm: true }),
  })
  expect(created.status).toBe(200)
  const { id } = (await created.json()) as { id: string }
  const row = await fetch(`${url}/rest/v1/players?id=eq.${id}&select=display_name`, { headers })
  const generated = ((await row.json()) as { display_name: string }[])[0]?.display_name
  expect(generated).not.toBe('Player')

  const reader = new SupabasePlayerNames({ supabaseUrl: url, serviceRoleKey: key })
  expect(await reader.seatName(id)).toBe(generated)
})

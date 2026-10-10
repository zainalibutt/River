import { randomUUID } from 'node:crypto'
import { expect, type Page, test } from '@playwright/test'
import type { RoomView } from '@river/server'
import { createClient } from '@supabase/supabase-js'

// This file is about the menu, not the way in: the intro and its gate are already behind us.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.sessionStorage.setItem('river:intro-seen', '1'))
})

const origin = process.env.RIVER_E2E_URL
const backend = process.env.RIVER_BOT_CANARY_URL
const serviceKey = process.env.RIVER_BOT_CANARY_SERVICE_KEY
const mail = process.env.RIVER_CONNECTED_MAIL_URL
const local = (value: string | undefined) => {
  if (value === undefined) return false
  const url = new URL(value)
  return url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)
}
const enabled =
  process.env.RIVER_CONNECTED_E2E === '1' &&
  local(origin) &&
  local(backend) &&
  local(mail) &&
  serviceKey !== undefined

type Me = { playerId: string; anonymous: boolean; balance: number }
type Snapshot = { kind: 'snapshot'; view: RoomView; balance: number }

async function me(page: Page): Promise<Me> {
  return page.evaluate(async () => {
    const key = Object.keys(localStorage).find((value) => /^sb-.*-auth-token$/.test(value))
    if (key === undefined) throw new Error('No local River session')
    const session = JSON.parse(localStorage.getItem(key) ?? 'null') as { access_token: string }
    const response = await fetch('/api/me', {
      headers: { authorization: `Bearer ${session.access_token}` },
    })
    if (!response.ok) throw new Error(`Account response ${response.status}`)
    return response.json()
  })
}

async function ledger(playerId: string) {
  const response = await fetch(
    `${backend}/rest/v1/chip_ledger?player_id=eq.${playerId}&select=delta,reason,ref&order=id.asc`,
    { headers: { apikey: serviceKey ?? '', authorization: `Bearer ${serviceKey}` } },
  )
  expect(response.status).toBe(200)
  return (await response.json()) as { delta: number; reason: string; ref: string }[]
}

async function followLocalMail(page: Page, email: string, after: Set<string>) {
  let id = ''
  await expect
    .poll(async () => {
      const response = await fetch(`${mail}/api/v1/messages`)
      if (!response.ok) throw new Error(`Local mailbox response ${response.status}`)
      const data = (await response.json()) as {
        messages: { ID: string; To: { Address: string }[] }[]
      }
      id =
        data.messages.find(
          (message) => !after.has(message.ID) && message.To.some((to) => to.Address === email),
        )?.ID ?? ''
      return id.length > 0
    })
    .toBe(true)
  after.add(id)
  const response = await fetch(`${mail}/api/v1/message/${id}`)
  const body = (await response.json()) as { HTML: string }
  const hrefs = Array.from(body.HTML.matchAll(/href="([^"]+)"/g), (match) =>
    (match[1] ?? '').replaceAll('&amp;', '&'),
  )
  const link = hrefs.find((href) => {
    const url = new URL(href)
    return url.origin === backend && url.pathname === '/auth/v1/verify'
  })
  if (link === undefined) throw new Error('Local confirmation link missing')
  await page.goto(link)
}

test.describe('connected local phone acceptance', () => {
  test.skip(!enabled, 'Requires an explicitly enabled, isolated local auth/database/mail stack')
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('accepts a refreshed local session and rejects a forged bearer', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Sign in to keep this' })).toBeVisible()
    const guest = await me(page)
    const configResponse = await page.request.get('/api/config')
    const config = (await configResponse.json()) as { supabaseUrl: string; publishableKey: string }
    expect(config.supabaseUrl).toBe(backend)
    const refreshToken = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((value) => /^sb-.*-auth-token$/.test(value))
      if (key === undefined) throw new Error('No local River session')
      return (JSON.parse(localStorage.getItem(key) ?? 'null') as { refresh_token: string })
        .refresh_token
    })
    const client = createClient(config.supabaseUrl, config.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    const refreshed = await client.auth.refreshSession({ refresh_token: refreshToken })
    if (refreshed.error !== null || refreshed.data.session === null) {
      throw new Error('Local token refresh failed')
    }
    const accepted = await page.request.get('/api/me', {
      headers: { authorization: `Bearer ${refreshed.data.session.access_token}` },
    })
    expect(accepted.status()).toBe(200)
    expect(await accepted.json()).toMatchObject(guest)
    const refused = await page.request.get('/api/me', {
      headers: { authorization: 'Bearer not-a-signed-session' },
    })
    expect(refused.status()).toBe(401)
  })

  test('keeps a real guest bankroll through email confirmation and returning sign-in', async ({
    page,
    browser,
  }) => {
    const email = `phone-${randomUUID()}@example.invalid`
    const delivered = new Set<string>()
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Sign in to keep this' })).toBeVisible()
    const guest = await me(page)
    expect(guest.anonymous).toBe(true)
    expect(guest.balance).toBeGreaterThan(0)
    const rows = await ledger(guest.playerId)
    expect(rows.reduce((balance, row) => balance + row.delta, 0)).toBe(guest.balance)
    await page.getByRole('button', { name: 'Sign in to keep this' }).tap()
    await page.getByRole('textbox', { name: 'Email a sign-in link' }).fill(email)
    await page.getByRole('button', { name: 'Send sign-in link' }).tap()
    await expect(page.getByText('A link to keep this session is on its way.')).toBeVisible()
    await followLocalMail(page, email, delivered)
    await expect(page.getByRole('dialog', { name: 'Your name' })).toBeVisible()
    await page.getByRole('button', { name: 'Close', exact: true }).tap()
    await expect(page.getByText('Signed in', { exact: true })).toBeVisible()
    expect(await me(page)).toMatchObject({ ...guest, anonymous: false })
    expect(await ledger(guest.playerId)).toEqual(rows)
    await page.reload()
    await expect(page.getByText('Signed in', { exact: true })).toBeVisible()
    expect(await me(page)).toMatchObject({ ...guest, anonymous: false })

    const returningContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
    try {
      const returning = await returningContext.newPage()
      await returning.goto(origin ?? '')
      await expect(returning.getByRole('button', { name: 'Sign in to keep this' })).toBeVisible()
      const temporary = await me(returning)
      expect(temporary.playerId).not.toBe(guest.playerId)
      await returning.getByRole('button', { name: 'Sign in to keep this' }).click()
      await returning.getByRole('textbox', { name: 'Email a sign-in link' }).fill(email)
      await returning.getByRole('button', { name: 'Send sign-in link' }).click()
      await expect(
        returning.getByText('A link to sign back into your account is on its way.'),
      ).toBeVisible()
      await followLocalMail(returning, email, delivered)
      await expect(returning.getByText('Signed in', { exact: true })).toBeVisible()
      expect(await me(returning)).toMatchObject({ ...guest, anonymous: false })
      expect(await ledger(guest.playerId)).toEqual(rows)
    } finally {
      await returningContext.close()
    }
  })

  test('restores a real seat, hands a live hand between tabs and settles chips on leaving', async ({
    page,
  }) => {
    let snapshot: Snapshot | null = null
    const errors: string[] = []
    const watch = (target: Page) => {
      target.on('websocket', (socket) => {
        if (!socket.url().endsWith('/ws')) return
        socket.on('framereceived', ({ payload }) => {
          const message = JSON.parse(String(payload)) as Snapshot | { kind: 'error'; code: string }
          if (message.kind === 'snapshot') snapshot = message
          if (message.kind === 'error') errors.push(message.code)
        })
      })
    }
    watch(page)
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Sign in to keep this' })).toBeVisible()
    const guest = await me(page)
    await page.getByRole('button', { name: 'Champion, Nell 1v1', exact: true }).tap()
    await expect(page.locator('.phone-hand')).toContainText('100,000')
    await expect(page.locator('.phone-network')).toHaveText('LIVE')
    const rows = await ledger(guest.playerId)
    await page.reload()
    await expect(page.locator('.phone-network')).toHaveText('LIVE')
    await expect(page.locator('.phone-hand')).toContainText('100,000')
    expect(await ledger(guest.playerId)).toEqual(rows)
    expect((await me(page)).playerId).toBe(guest.playerId)
    await page.getByRole('button', { name: 'DEAL', exact: true }).tap()
    await expect(page.getByRole('button', { name: 'Fold', exact: true })).toBeEnabled()
    if (snapshot === null) throw new Error('No real table snapshot')
    const before = snapshot as Snapshot
    const hero = before.view.seats.find((seat) => seat.playerId === guest.playerId)
    expect(hero?.hole).toHaveLength(2)
    expect(before.view.seats.filter((seat) => seat.playerId?.startsWith('bot:'))).toHaveLength(1)
    expect(before.view.seats.some((seat) => seat.name === 'Nell')).toBe(true)
    const live = await page.context().newPage()
    watch(live)
    await live.goto(`${origin}/table`)
    await expect(live.locator('.phone-network')).toHaveText('LIVE')
    await expect(live.getByRole('button', { name: 'Fold', exact: true })).toBeEnabled()
    if (snapshot === null) throw new Error('No resumed table snapshot')
    const resumed = snapshot as Snapshot
    expect(resumed.view.handNumber).toBe(before.view.handNumber)
    expect(resumed.view.seats.find((seat) => seat.playerId === guest.playerId)?.hole).toEqual(
      hero?.hole,
    )
    expect(await ledger(guest.playerId)).toEqual(rows)
    expect((await me(live)).playerId).toBe(guest.playerId)
    await page.close()
    const peek = live.getByRole('button', { name: 'Press and hold to look at your cards' })
    await peek.focus()
    await live.keyboard.down('Space')
    await expect(live.locator('.phone-peek-display .playing-card')).toHaveCount(2)
    await live.keyboard.up('Space')
    await expect(live.locator('.phone-peek-display')).toHaveCount(0)

    const leave = live.getByRole('button', { name: 'Hold to leave table' })
    await leave.focus()
    await live.keyboard.down('Space')
    await expect(live).toHaveURL(`${origin}/`)
    await live.keyboard.up('Space')
    await expect(live.getByRole('button', { name: 'Sign in to keep this' })).toBeVisible()
    const settled = await me(live)
    const finalRows = await ledger(guest.playerId)
    expect(finalRows.length).toBeGreaterThan(rows.length)
    expect(finalRows.reduce((balance, row) => balance + row.delta, 0)).toBe(settled.balance)
    expect(settled.balance).toBe((before.balance ?? 0) + (hero?.stack ?? 0))
    expect(errors).toEqual([])
  })
})

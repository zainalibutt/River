import { expect, type Page, test } from '@playwright/test'

/**
 * Friends from the menu, against a faked server: no account or database is touched.
 */

const PLAYER = '00000000-0000-4000-8000-0000000000f1'
const FRIEND = '00000000-0000-4000-8000-0000000000f2'

async function fakeClub(page: Page, anonymous: boolean) {
  const posted: unknown[] = []
  await page.route('**/api/config', (route) =>
    route.fulfill({
      json: { supabaseUrl: 'https://river-auth.invalid', publishableKey: 'friends-test' },
    }),
  )
  await page.route('https://river-auth.invalid/**', (route) =>
    route.fulfill({
      json: {
        access_token: 'friends-fixture-token',
        refresh_token: 'friends-fixture-refresh',
        expires_in: 3600,
        token_type: 'bearer',
        user: {
          id: PLAYER,
          aud: 'authenticated',
          role: 'authenticated',
          is_anonymous: anonymous,
          app_metadata: {},
          user_metadata: {},
          created_at: '2026-10-01T00:00:00Z',
        },
      },
    }),
  )
  await page.route('**/api/me', (route) =>
    route.fulfill({ json: { playerId: PLAYER, anonymous, admin: false, balance: 90_000 } }),
  )
  await page.route('**/api/daily', (route) => route.fulfill({ status: 502, json: {} }))
  await page.route('**/api/friends', (route) => {
    if (anonymous)
      return route.fulfill({ status: 403, json: { error: 'Save your progress to add friends.' } })
    if (route.request().method() === 'POST') {
      posted.push(route.request().postDataJSON())
      return route.fulfill({ json: { ok: true, message: 'Request sent.' } })
    }
    return route.fulfill({
      json: {
        friends: [{ playerId: FRIEND, name: 'QuietHeron42', balance: 120_000, atTable: true }],
        incoming: [
          {
            id: 7,
            playerId: '00000000-0000-4000-8000-0000000000f3',
            name: 'Rook_9',
            createdAtMs: Date.now(),
          },
        ],
        outgoing: [],
        blocked: [],
        invites: [
          { id: 3, fromName: 'QuietHeron42', inviteCode: 'RIVER2', createdAtMs: Date.now() },
        ],
      },
    })
  })
  return { posted }
}

test('lists friends with their chips, answers a request, and sends one by name', async ({
  page,
}) => {
  const club = await fakeClub(page, false)
  await page.goto('/')
  await page.getByRole('button', { name: 'Friends', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: 'Your friends' })
  await expect(sheet).toContainText('QuietHeron42')
  await expect(sheet).toContainText('120,000 chips · at a table')
  await expect(sheet).toContainText('Invited to a table')
  await sheet.getByRole('button', { name: 'Accept' }).click()
  await sheet.getByLabel('Add a friend by their name').fill('Nightjar')
  await sheet.getByRole('button', { name: 'Send' }).click()
  await expect(sheet).toContainText('Request sent.')
  expect(club.posted).toEqual([
    { kind: 'accept', requestId: 7 },
    { kind: 'request', name: 'Nightjar' },
  ])
})

test('asks a guest to save their progress before adding friends', async ({ page }) => {
  await fakeClub(page, true)
  await page.goto('/')
  await page.getByRole('button', { name: 'Friends', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: 'Your friends' })
  await expect(sheet.getByRole('button', { name: 'Save your progress' })).toBeVisible()
})

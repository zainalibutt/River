import { expect, type Page, test } from '@playwright/test'

// This file is about the menu, not the way in: the intro and its gate are already behind us.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.sessionStorage.setItem('river:intro-seen', '1'))
})

/**
 * Daily chips on the menu, against a faked server: no account or database is touched.
 * The menu offers the day's spin when /api/daily says it is open, claims it once from the
 * wheel, counts the bankroll up after the wheel settles and says when the next spin opens.
 */

const PLAYER = '00000000-0000-4000-8000-0000000000d1'
const PRIZES = [10_000, 20_000, 30_000, 40_000, 50_000]

async function fakeClub(page: Page, claimable: boolean) {
  let claims = 0
  await page.route('**/api/config', (route) =>
    route.fulfill({
      json: { supabaseUrl: 'https://river-auth.invalid', publishableKey: 'daily-test' },
    }),
  )
  await page.route('https://river-auth.invalid/**', (route) =>
    route.fulfill({
      json: {
        access_token: 'daily-fixture-token',
        refresh_token: 'daily-fixture-refresh',
        expires_in: 3600,
        token_type: 'bearer',
        user: {
          id: PLAYER,
          aud: 'authenticated',
          role: 'authenticated',
          is_anonymous: true,
          app_metadata: {},
          user_metadata: {},
          created_at: '2026-10-01T00:00:00Z',
        },
      },
    }),
  )
  await page.route('**/api/me', (route) =>
    route.fulfill({ json: { playerId: PLAYER, anonymous: true, admin: false, balance: 40_000 } }),
  )
  const status = (open: boolean, streakDay: number) => ({
    daily: {
      claimable: open,
      amount: 0,
      streakDay,
      nextAtMs: open ? Date.now() : Date.now() + 5 * 3_600_000,
      prizes: PRIZES,
    },
    rescue: { claimable: false, amount: 0, left: 3 },
  })
  await page.route('**/api/daily', (route) => {
    if (route.request().method() === 'POST') {
      claims += 1
      return route.fulfill({
        json: {
          kind: 'granted',
          delta: 30_000,
          segment: 2,
          balance: 70_000,
          status: status(false, 2),
        },
      })
    }
    return route.fulfill({ json: { status: status(claimable, claimable ? 2 : 1) } })
  })
  return { claims: () => claims }
}

test('spins the daily wheel from the menu once, and says when the next spin opens', async ({
  page,
}) => {
  const club = await fakeClub(page, true)
  await page.goto('/')
  await expect(page.locator('.club-daily')).toContainText('Free spin ready')
  await page.getByRole('button', { name: 'Spin the daily wheel' }).click()
  const wheel = page.getByRole('dialog', { name: 'Daily spin' })
  await expect(wheel).toBeVisible()
  await expect(wheel.locator('.club-wheel-label')).toHaveText(['10K', '20K', '30K', '40K', '50K'])
  expect(club.claims()).toBe(0)
  await wheel.getByRole('button', { name: 'Spin', exact: true }).click()
  // The prize stays the wheel's to tell: the bankroll does not move while it turns.
  await expect(wheel.getByRole('status')).toHaveText('Spinning…')
  await expect(page.locator('.club-capsule-value')).toHaveText('40,000')
  await expect(wheel.getByRole('status')).toHaveText('+30,000 chips')
  await wheel.getByRole('button', { name: 'Collect', exact: true }).click()
  await expect(wheel).toHaveCount(0)
  await expect(page.locator('.club-daily')).toContainText('+30,000')
  await expect(page.locator('.club-daily')).toContainText(/next spin in \d+h/i)
  await expect(page.locator('.club-capsule-value')).toHaveText('70,000')
  await expect(page.getByRole('button', { name: 'Spin the daily wheel' })).toHaveCount(0)
  expect(club.claims()).toBe(1)
})

test('shows only the wait when today has been claimed', async ({ page }) => {
  await fakeClub(page, false)
  await page.goto('/')
  await expect(page.locator('.club-daily')).toContainText(/next in \d+h/i)
  await expect(page.getByRole('button', { name: 'Spin the daily wheel' })).toHaveCount(0)
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test('keeps the player capsule, daily chips included, on the screen', async ({ page }) => {
    await fakeClub(page, true)
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Spin the daily wheel' })).toBeVisible()
    const capsule = await page.locator('.club-capsule-player').boundingBox()
    expect(capsule).not.toBeNull()
    expect(capsule?.x ?? -1).toBeGreaterThanOrEqual(0)
    expect((capsule?.x ?? 0) + (capsule?.width ?? 0)).toBeLessThanOrEqual(390)
    await page.screenshot({ path: 'test-results/daily-chips-phone.png' })
  })
})

import { expect, test } from '@playwright/test'

/** The menu's moving room: on a wide screen only, and never with reduced motion. */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('river:intro-seen', '1'))
  await page.route('**/api/config', (route) => route.fulfill({ status: 503, json: {} }))
})

test('a wide screen plays the room and fades it in over the still', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.locator('.club-home-drift.playing')).toHaveCount(1, { timeout: 15_000 })
  await expect(page.locator('.club-home-art img')).toHaveCount(1)
})

test('a phone keeps the still', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.locator('.club-home-art img')).toHaveCount(1)
  await expect(page.locator('.club-home-drift')).toHaveCount(0)
})

test('reduced motion keeps the still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.locator('.club-home-art img')).toHaveCount(1)
  await expect(page.locator('.club-home-drift')).toHaveCount(0)
})

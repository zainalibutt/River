import { expect, test } from '@playwright/test'

/** The way in: once a visit, skippable, and never with reduced motion. */

test.beforeEach(async ({ page }) => {
  await page.route('**/api/config', (route) => route.fulfill({ status: 503, json: {} }))
})

test('plays once a visit, gives way to a press, and stays away on the next load', async ({
  page,
}) => {
  await page.goto('/')
  const intro = page.locator('.river-intro')
  await expect(page.locator('.intro-stage')).toBeVisible()
  await intro.dispatchEvent('pointerdown')
  await expect(intro).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Quick Play', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.locator('.intro-stage')).toHaveCount(0)
  await expect(intro).toHaveCount(0)
})

test('ends on its own after three seconds', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.intro-stage')).toBeVisible()
  await expect(page.locator('.river-intro')).toHaveCount(0, { timeout: 6_000 })
})

test('never plays with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.locator('.river-intro')).toHaveCount(0)
  await expect(page.locator('.intro-stage')).toHaveCount(0)
})

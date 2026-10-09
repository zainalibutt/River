import { expect, test } from '@playwright/test'

/** The way in: once a visit, skippable, film on a wide screen, cards alone on a phone. */

test.beforeEach(async ({ page }) => {
  await page.route('**/api/config', (route) => route.fulfill({ status: 503, json: {} }))
})

test('plays once a visit, gives way to a press, and stays away on the next load', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/')
  const intro = page.locator('.river-intro')
  await expect(page.locator('.intro-film')).toBeVisible()
  await intro.dispatchEvent('pointerdown')
  await expect(intro).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Quick Play', exact: true })).toBeVisible()
  await page.reload()
  await expect(intro).toHaveCount(0)
})

test('hands the film over to the cards and ends on its own', async ({ page }) => {
  test.setTimeout(40_000)
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/')
  await expect(page.locator('.intro-film')).toBeVisible()
  await expect(page.locator('.intro-ace')).toHaveCount(2, { timeout: 20_000 })
  await expect(page.locator('.intro-word')).toBeVisible()
  await expect(page.locator('.river-intro')).toHaveCount(0, { timeout: 8_000 })
})

test('a phone gets the cards alone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.locator('.river-intro.dealt .intro-ace')).toHaveCount(2)
  await expect(page.locator('.intro-film')).toHaveCount(0)
  await expect(page.locator('.river-intro')).toHaveCount(0, { timeout: 8_000 })
})

test('never plays with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.locator('.river-intro')).toHaveCount(0)
})

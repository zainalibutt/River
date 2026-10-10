import { expect, test } from '@playwright/test'

/**
 * The way in: a gate first, since nothing may sound before a press; then the film on a wide
 * screen or the mark alone on a phone; once a visit, skippable, never with reduced motion.
 */

test.beforeEach(async ({ page }) => {
  await page.route('**/api/config', (route) => route.fulfill({ status: 503, json: {} }))
})

test('waits at the gate until it is pressed', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/')
  const gate = page.getByRole('button', { name: 'Click to enter' })
  await expect(gate).toBeVisible()
  await page.waitForTimeout(3_000)
  await expect(gate).toBeVisible()
  await expect(page.locator('.intro-film')).toHaveCount(0)
})

test('plays once a visit, gives way to a press, and stays away on the next load', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Click to enter' }).click()
  const intro = page.locator('.river-intro')
  await expect(page.locator('.intro-film')).toBeVisible()
  await intro.dispatchEvent('pointerdown')
  await expect(intro).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Quick Play', exact: true })).toBeVisible()
  await page.reload()
  await expect(intro).toHaveCount(0)
})

test('runs the film into the mark and lands it on the menu', async ({ page }) => {
  test.setTimeout(40_000)
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Click to enter' }).click()
  await expect(page.locator('.intro-film')).toBeVisible()
  await expect(page.locator('.intro-lockup')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.river-intro.landing')).toHaveCount(1, { timeout: 8_000 })
  await expect(page.locator('.river-intro')).toHaveCount(0, { timeout: 4_000 })
})

test('a phone gets the mark alone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.locator('.intro-gate').click()
  await expect(page.locator('.intro-lockup')).toBeVisible()
  await expect(page.locator('.intro-film')).toHaveCount(0)
  await expect(page.locator('.river-intro')).toHaveCount(0, { timeout: 8_000 })
})

test('never plays with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.locator('.river-intro')).toHaveCount(0)
})

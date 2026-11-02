import { expect, type Locator, test } from '@playwright/test'

// This file is about the menu, not the way in: the intro and its gate are already behind us.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.sessionStorage.setItem('river:intro-seen', '1'))
})

/**
 * Settings from the table.
 *
 * The table's top row opens the same settings the menu's SETTINGS opens, over
 * the table rather than instead of it, and a change made at the table is the
 * one the menu shows afterwards. This needs only the web app.
 */

async function toggleNames(panel: Locator): Promise<string[]> {
  return panel
    .locator('[aria-pressed]')
    .evaluateAll((toggles) =>
      toggles.map((toggle) => toggle.querySelector('span')?.textContent ?? ''),
    )
}

/**
 * Press until the panel shows. A page drawn on the server can be pressed
 * before its buttons are live, and the press is lost; pressing again once the
 * panel is up would close it, so this looks first.
 */
async function openUntilShown(trigger: Locator, panel: Locator): Promise<void> {
  await expect(async () => {
    if (!(await panel.isVisible())) await trigger.click()
    await expect(panel).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 60_000 })
}

test('the table opens the menu settings without leaving the table', async ({ page }) => {
  await page.goto('/table')
  const row = page.getByRole('navigation', { name: 'Table menu' })
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await openUntilShown(row.getByRole('button', { name: 'SETTINGS', exact: true }), dialog)
  expect(new URL(page.url()).pathname).toBe('/table')
  const atTable = await toggleNames(dialog)
  expect(atTable).toContain('Censor profanity')

  const censor = dialog.getByRole('button', { name: /Censor profanity/ })
  await expect(censor).toHaveAttribute('aria-pressed', 'false')
  await censor.click()
  await expect(censor).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => localStorage.getItem('river:censor-profanity'))).toBe('on')

  await dialog.getByRole('button', { name: 'CLOSE' }).click()
  await expect(dialog).toBeHidden()
  expect(new URL(page.url()).pathname).toBe('/table')

  await page.goto('/')
  const menu = page.locator('.club-settings')
  await openUntilShown(page.getByRole('button', { name: 'Settings', exact: true }), menu)
  expect(await toggleNames(menu)).toEqual(atTable)
  await expect(menu.getByRole('button', { name: /Censor profanity/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('amounts at the table turn to big blinds as soon as the setting is on', async ({ page }) => {
  await page.goto('/table')
  // Whatever amounts the table is showing: stacks and piles once seated, or
  // the buy-in the rail asks for while the bankroll cannot cover one.
  const amounts = page.locator('.cluster-chips, .t2d-stack, .t2d-pile-amount, .ram-waiting > span')
  const figures = async () =>
    (await amounts.allTextContents()).map((text) => text.trim()).filter((text) => /\d/.test(text))
  await expect.poll(async () => (await figures()).length, { timeout: 60_000 }).toBeGreaterThan(0)
  expect((await figures()).filter((text) => text.includes('BB'))).toEqual([])

  const dialog = page.getByRole('dialog', { name: 'Settings' })
  const row = page.getByRole('navigation', { name: 'Table menu' })
  await openUntilShown(row.getByRole('button', { name: 'SETTINGS', exact: true }), dialog)
  const blinds = dialog.getByRole('button', { name: /Show amounts in big blinds/ })
  await expect(blinds).toHaveAttribute('aria-pressed', 'false')
  await blinds.click()
  await expect(blinds).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => localStorage.getItem('river:amounts-in-big-blinds'))).toBe('on')
  await dialog.getByRole('button', { name: 'CLOSE' }).click()

  await expect.poll(async () => (await figures()).every((text) => / BB\b/.test(text))).toBe(true)
  expect(new URL(page.url()).pathname).toBe('/table')
})

import { expect, test } from '@playwright/test'

/**
 * One hand, end to end, as a guest who has never been here: the menu renders,
 * the one-on-one table opens with a bot at it, DEAL starts a hand, the guest is
 * dealt in and gets a turn, and once the hand is over the browser checks the
 * revealed seed against the commit it was shown before the cards came.
 *
 * It needs the whole product behind it: the web app, the game server and the
 * database. The intro has its own file and is skipped here.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.sessionStorage.setItem('river:intro-seen', '1'))
})

test('a guest plays a hand at a bot table and the fairness check passes', async ({ page }) => {
  test.setTimeout(180_000)
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Quick Play', exact: true })).toBeVisible()
  // Heads up, so the hand is over as soon as one of the two folds.
  await page.getByRole('button', { name: 'Champion, Nyx 1v1', exact: true }).click()
  await expect(page).toHaveURL(/\/table\?new=1&strength=champion$/)

  await page.getByRole('button', { name: 'DEAL', exact: true }).click({ timeout: 60_000 })

  // Dealt in: two cards of the guest's own, and a commit published for the hand.
  await expect(page.locator('.hero-cards > *').first()).toBeVisible({ timeout: 30_000 })
  const pill = page.locator('.verify-pill-room')
  await expect(pill).toBeEnabled({ timeout: 30_000 })

  // The guest's turn comes round with the action controls on it. Folding ends
  // the hand; facing no bet a fold wants a hold, so check instead. A hand the
  // bot folds before the guest has acted proves no controls, so deal another.
  const menu = page.getByRole('region', { name: 'Your action' })
  const verified = page.locator('.verify-pill-room.verify-match')
  const deal = page.getByRole('button', { name: 'DEAL', exact: true })
  let turns = 0
  await expect(async () => {
    if (turns > 0 && (await verified.count()) > 0) return
    if (await deal.isVisible()) await deal.click({ timeout: 2_000 })
    await expect(menu).toBeVisible({ timeout: 1_000 })
    turns += 1
    const fold = menu.getByRole('button', { name: 'Fold', exact: true })
    if ((await fold.count()) > 0) await fold.click({ timeout: 2_000 })
    else await page.keyboard.press('c')
    await expect(verified).toHaveCount(1, { timeout: 2_000 })
  }).toPass({ timeout: 120_000, intervals: [250] })

  expect(turns).toBeGreaterThan(0)
  await expect(pill).toHaveAccessibleName(/^Fairness verified/)
  expect(pageErrors).toEqual([])
})

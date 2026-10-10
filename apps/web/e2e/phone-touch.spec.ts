import { expect, type Locator, type Page, test } from '@playwright/test'

// This file is about the menu, not the way in: the intro and its gate are already behind us.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.sessionStorage.setItem('river:intro-seen', '1'))
})

/**
 * River on a phone and a tablet, by touch.
 *
 * The upright table and menu answer a tap, and no page
 * table stays fixed; the club menu can scroll on short screens. Panels trap
 * focus and dismiss before another opens. These need only the web app.
 */

const PHONES = [
  { name: 'a phone held upright', width: 390, height: 844 },
  { name: 'a phone held sideways', width: 844, height: 390 },
  // Narrower than the menu's split, so it takes the upright layout while short.
  { name: 'a small phone held sideways', width: 667, height: 375 },
] as const

/**
 * Tap a menu item on its words, as a finger does, until its panel shows. The
 * items run the width of a narrow screen, so their middle can sit under an
 * open panel while their words do not. A page drawn on the server can also be
 * tapped before its buttons are live, and the tap is lost, so this taps again
 * until the panel is up, looking first so it never taps twice.
 */
async function tapMenuItem(page: Page, name: string, panel: Locator): Promise<void> {
  const item = page.getByRole('button', { name, exact: true })
  await expect(async () => {
    if (!(await panel.isVisible())) {
      await item.tap()
    }
    await expect(panel).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 60_000 })
}

/** Wholly inside the screen: nothing can scroll to reveal what is off it. */
async function expectOnScreen(page: Page, target: Locator): Promise<void> {
  const box = await target.boundingBox()
  const size = page.viewportSize()
  expect(box).not.toBeNull()
  expect(size).not.toBeNull()
  if (box === null || size === null) return
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(size.width)
  expect(box.y + box.height).toBeLessThanOrEqual(size.height)
}

/** What a finger at the middle of the control lands on is the control, not a layer over it. */
async function expectTappable(target: Locator): Promise<void> {
  expect(
    await target.evaluate((element) => {
      const box = element.getBoundingClientRect()
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      return hit !== null && element.contains(hit)
    }),
  ).toBe(true)
}

/** How the page is set up to take a finger: what the browser is told, not how it looks. */
async function touchSettings(page: Page, root: string) {
  return page.evaluate((selector) => {
    const element = document.querySelector(selector)
    return {
      viewport: document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '',
      htmlOverscroll: getComputedStyle(document.documentElement).overscrollBehavior,
      bodyOverscroll: getComputedStyle(document.body).overscrollBehavior,
      rootTouch: element === null ? null : getComputedStyle(element).touchAction,
      scrolls:
        document.scrollingElement !== null &&
        (document.scrollingElement.scrollHeight > window.innerHeight ||
          document.scrollingElement.scrollWidth > window.innerWidth),
    }
  }, root)
}

for (const phone of PHONES) {
  test.describe(phone.name, () => {
    test.use({
      viewport: { width: phone.width, height: phone.height },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    })

    test.beforeEach(async ({ page }) => {
      await page.route('**/api/config', (route) =>
        route.fulfill({ status: 503, json: { error: 'Offline touch-layout check' } }),
      )
    })

    test('optional table setup remains reachable by touch', async ({ page }) => {
      await page.goto('/')
      const setup = page.locator('.club-table-setup')
      await tapMenuItem(page, 'Table options', setup)
      await expectOnScreen(page, page.getByRole('dialog', { name: 'Table options' }))
      for (const name of ['People only', 'Bots', 'Tough']) {
        const choice = setup.getByRole('button', { name, exact: true })
        await choice.scrollIntoViewIfNeeded()
        await expectTappable(choice)
        await choice.tap()
        await expect(choice).toHaveAttribute('aria-pressed', 'true')
      }
      const seat = setup.getByRole('button', { name: 'Take a seat' })
      await seat.scrollIntoViewIfNeeded()
      await expectTappable(seat)
      await seat.tap()
      await page.waitForURL(/\/table\?/, { timeout: 60_000 })
      if (phone.height > phone.width) await expect(page.locator('.phone-table')).toBeVisible()
      else await expect(page.getByText('Turn your phone upright.')).toBeVisible()
    })

    test('join and settings panels can be dismissed and reached by touch', async ({ page }) => {
      await page.goto('/')
      const join = page.locator('.club-capsule-event', { has: page.locator('#club-invite') })
      await tapMenuItem(page, 'Join', join)
      await expectOnScreen(page, join)
      await expectTappable(page.locator('#club-invite'))
      await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).tap()
      await expect(join).toBeHidden()

      const settings = page.locator('.club-settings')
      await tapMenuItem(page, 'Settings', settings)
      await expectOnScreen(page, page.getByRole('dialog', { name: 'Settings' }))
      const censor = settings.getByRole('button', { name: /Censor profanity/ })
      await censor.scrollIntoViewIfNeeded()
      await expectTappable(censor)
      await censor.tap()
      await expect(censor).toHaveAttribute('aria-pressed', 'true')
    })

    test('the club scrolls internally on short screens while the table stays fixed', async ({
      page,
    }) => {
      await page.goto('/')
      const home = await touchSettings(page, '.club')
      await page.goto('/table')
      if (phone.height > phone.width) await expect(page.locator('.phone-table')).toBeVisible()
      else await expect(page.getByText('Turn your phone upright.')).toBeVisible()
      const table = await touchSettings(page, '.river-app')
      for (const screen of [home, table]) {
        expect(screen.viewport).toContain('maximum-scale=1')
        expect(screen.viewport).toContain('user-scalable=no')
        expect(screen.htmlOverscroll).toBe('none')
        expect(screen.bodyOverscroll).toBe('none')
        expect(screen.scrolls).toBe(false)
      }
      expect(home.rootTouch).toBe('pan-y')
      expect(table.rootTouch).toBe(phone.height > phone.width ? 'manipulation' : 'none')
    })
  })
}

test.describe('a tablet held upright', () => {
  test.use({
    viewport: { width: 820, height: 1180 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })

  test('shows an upright table that neither scrolls nor zooms', async ({ page }) => {
    await page.route('**/api/config', (route) =>
      route.fulfill({ status: 503, json: { error: 'Offline touch-layout check' } }),
    )
    await page.goto('/table')
    await expect(page.locator('.phone-table')).toBeVisible()
    await expect(page.getByText('River needs a bigger screen for now.')).toBeHidden()
    const table = await touchSettings(page, '.river-app')
    expect(table.viewport).toContain('user-scalable=no')
    expect(table.htmlOverscroll).toBe('none')
    expect(table.rootTouch).toBe('manipulation')
    expect(table.scrolls).toBe(false)
  })
})

test.describe('a tablet held sideways', () => {
  test.use({
    viewport: { width: 1180, height: 820 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })

  test('shows the table, which takes no pan or zoom of its own', async ({ page }) => {
    await page.route('**/api/config', (route) =>
      route.fulfill({ status: 503, json: { error: 'Offline touch-layout check' } }),
    )
    await page.goto('/table')
    await expect(page.locator('.river-stage')).toBeVisible()
    await expect(page.getByText('River needs a bigger screen for now.')).toBeHidden()
    const table = await touchSettings(page, '.river-stage')
    expect(table.rootTouch).toBe('none')
    expect(table.scrolls).toBe(false)
  })
})

import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/config', (route) =>
    route.fulfill({ status: 503, json: { error: 'Offline club check' } }),
  )
})

for (const viewport of [
  { width: 320, height: 740 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 820, height: 1180 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 390, height: 667 },
]) {
  test.describe(`${viewport.width}x${viewport.height} club`, () => {
    test.use({ viewport })

    test('primary actions have phone-sized targets and distinct destinations', async ({ page }) => {
      await page.goto('/')
      await expect(page.getByText('Premium poker.', { exact: true })).toBeVisible()
      await expect(page).toHaveTitle('River — Premium poker')
      await expect(page.getByText('Poker after dark.', { exact: true })).toHaveCount(0)
      await expect(page.getByText('A seat for you. A table for your friends.')).toHaveCount(0)
      expect(
        await page.locator('.club-home-art img').evaluate((image) => {
          const graphic = image as HTMLImageElement
          return graphic.complete && graphic.naturalWidth > 0
        }),
      ).toBe(true)
      for (const name of [
        'Quick Play',
        'Champion, Nell 1v1',
        'Create',
        'Join',
        'Table options',
        'Sound',
        'Settings',
      ]) {
        const button = page.getByRole('button', { name, exact: true })
        await expect(button).toBeVisible()
        const box = await button.boundingBox()
        expect(box?.height).toBeGreaterThanOrEqual(44)
        if (name === 'Quick Play' && box !== null) {
          const title = button.getByText(name, { exact: true })
          await expect
            .poll(() =>
              title.evaluate(async (element) => {
                await document.fonts.ready
                return getComputedStyle(element).fontFamily
              }),
            )
            .toContain('Barlow Condensed')
          const titleBox = await title.boundingBox()
          expect(titleBox).not.toBeNull()
          if (titleBox !== null) {
            const titleCenter = titleBox.x + titleBox.width / 2
            const buttonCenter = box.x + box.width / 2
            expect(Math.abs(titleCenter - buttonCenter)).toBeLessThanOrEqual(2)
          }
        }
        if (['Quick Play', 'Champion, Nell 1v1', 'Create'].includes(name)) {
          const size = page.viewportSize()
          expect(size).not.toBeNull()
          if (box !== null && size !== null)
            expect(box.y + box.height).toBeLessThanOrEqual(size.height)
        }
      }
      expect(
        await page
          .locator('.club-home')
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true)
      await page.route('**/table?**', (route) =>
        route.fulfill({ contentType: 'text/html', body: '<p>Table destination</p>' }),
      )
      await page.getByRole('button', { name: 'Quick Play', exact: true }).click()
      await expect(page).toHaveURL(/\/table\?new=1&strength=random$/)
      await page.goto('/')
      await page.getByRole('button', { name: 'Champion, Nell 1v1', exact: true }).click()
      await expect(page).toHaveURL(/\/table\?new=1&strength=champion$/)
      await page.goto('/')
      await page.getByRole('button', { name: 'Create', exact: true }).click()
      await expect(page).toHaveURL(/\/play$/)
    })
  })
}

test('join submits on screen, reports invalid links, and restores focus on close', async ({
  page,
}) => {
  await page.goto('/')
  const trigger = page.getByRole('button', { name: 'Join', exact: true })
  await trigger.click()
  const panel = page.getByRole('dialog', { name: 'Join a table' })
  const submit = panel.getByRole('button', { name: 'Join table', exact: true })
  await expect(submit).toBeDisabled()
  await panel.getByLabel('Paste an invite link').fill('not-an-invite')
  await submit.click()
  await expect(panel.getByRole('alert')).toBeVisible()
  await expect(panel.getByLabel('Paste an invite link')).toHaveAttribute('aria-invalid', 'true')
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(panel).toBeHidden()
  await expect(trigger).toBeFocused()
  await trigger.click()
  await panel.getByLabel('Paste an invite link').fill(`${new URL(page.url()).origin}/t/FRIEND`)
  await expect(panel.getByRole('alert')).toHaveCount(0)
  await page.route('**/t/FRIEND', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<p>Friend table destination</p>' }),
  )
  await submit.click()
  await expect(page).toHaveURL(/\/t\/FRIEND$/)
})

test('sound defaults on and a saved mute is shared with settings across reloads', async ({
  page,
}) => {
  await page.goto('/')
  const sound = page.getByRole('button', { name: 'Sound', exact: true })
  await expect(sound).toHaveAttribute('aria-pressed', 'true')
  await sound.click()
  await expect(sound).toHaveAttribute('aria-pressed', 'false')
  await page.reload()
  await expect(sound).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'Settings' })
  const setting = panel.getByRole('button', { name: 'Sound', exact: true })
  await expect(setting).toHaveAttribute('aria-pressed', 'false')
  await setting.click()
  await expect(setting).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(sound).toHaveAttribute('aria-pressed', 'true')
})

test.describe('home sheets with an overlay keyboard', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('keeps the invite field and submit action above the visible viewport edge', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const viewport = new EventTarget()
      Object.assign(viewport, { height: 500, offsetTop: 0, scale: 1 })
      Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true })
    })
    await page.goto('/')
    const trigger = page.getByRole('button', { name: 'Join', exact: true })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: 'Join a table' })
    await expect(dialog.getByLabel('Paste an invite link')).toBeFocused()
    await expect
      .poll(async () => {
        const box = await dialog.boundingBox()
        return box === null ? Infinity : box.y + box.height
      })
      .toBeLessThanOrEqual(500)
    await expect(dialog.getByRole('button', { name: 'Join table' })).toBeInViewport()
    await page.evaluate(() => {
      Object.assign(window.visualViewport as VisualViewport, { height: 620, offsetTop: 24 })
      window.visualViewport?.dispatchEvent(new Event('scroll'))
    })
    await expect
      .poll(async () => {
        const box = await dialog.boundingBox()
        return box === null ? Infinity : box.y + box.height
      })
      .toBeLessThanOrEqual(644)
    await page.evaluate(() => {
      Object.assign(window.visualViewport as VisualViewport, { height: 844, offsetTop: 0 })
      window.visualViewport?.dispatchEvent(new Event('resize'))
    })
    await expect
      .poll(async () => {
        const box = await dialog.boundingBox()
        return box === null ? 0 : box.y + box.height
      })
      .toBeGreaterThan(800)
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()
  })
})

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
]) {
  test.describe(`${viewport.width}x${viewport.height} private table setup`, () => {
    test.use({ viewport })

    test('keeps the fixed table settings in view and returns home', async ({ page }) => {
      await page.goto('/play')
      const settings = page.getByRole('region', { name: 'Table settings' })
      await expect(settings).toBeVisible()
      await expect(
        settings.getByRole('button', { name: 'Create table', exact: true }),
      ).toBeVisible()
      const values = await settings.locator('.club-private-details dd').allTextContents()
      expect(values[1]).toBe('9')
      expect(values[2]).toBe('100,000')
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true)
      await page.getByRole('button', { name: 'Back', exact: true }).click()
      await expect(page).toHaveURL('/')
    })
  })
}

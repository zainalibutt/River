import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'

/**
 * Captures the HUD material states as PNGs for review.
 *
 * Not a test. It asserts nothing and gates nothing; it exists because the only
 * honest way to judge material is to look at it, and driving a real table to
 * each state by hand costs a session every time somebody asks.
 *
 *   node apps/web/e2e/capture-material.mjs <outputDirectory>
 */
const base = process.env.RIVER_E2E_URL ?? 'http://localhost:3100'
const out = process.argv[2] ?? 'material-shots'

async function reachTurn(page) {
  const deal = page.getByRole('button', { name: 'DEAL', exact: true })
  const dial = page.locator('.betting-dial')
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    if (await dial.isVisible().catch(() => false)) return true
    if (await deal.isVisible().catch(() => false)) await deal.click().catch(() => {})
    await page.waitForTimeout(250)
  }
  return false
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
const page = await context.newPage()
await mkdir(out, { recursive: true })

// A fresh anonymous session, which is what carries the signup bankroll. Without
// this the run inherits whatever the last one left and every seat is disabled.
await page.goto(base)
await page.evaluate(() => {
  localStorage.clear()
  sessionStorage.clear()
})
await page.goto(`${base}/table`)
await page.waitForSelector('.open-seat', { timeout: 60_000 })
await page.waitForTimeout(9_000)

await page.screenshot({ path: `${out}/01-table-at-rest.png` })

const seat = page.locator('.open-seat').nth(4)
await seat.hover()
await page.waitForTimeout(400)
await page.screenshot({ path: `${out}/02-seat-lights-up.png` })
await seat.screenshot({ path: `${out}/03-seat-detail.png` }).catch(() => {})

await page.locator('.hud-corner-left').screenshot({ path: `${out}/04-chrome-detail.png` })

await seat.click()

/**
 * One crop per live turn.
 *
 * A turn ends on its own clock. Measuring four rectangles and then taking four
 * screenshots meant the last three were of the WAITING pill that had replaced
 * the ring, so each crop now measures and shoots inside the same turn and the
 * next one waits for a fresh turn of its own.
 */
async function captureWhileLive(key, selector) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (!(await reachTurn(page))) continue
    const clip = await page.evaluate((target) => {
      const el = document.querySelector(target)
      if (el === null) return null
      const box = el.getBoundingClientRect()
      if (box.width < 1 || box.height < 1) return null
      return { x: box.x, y: box.y, width: box.width, height: box.height }
    }, selector)
    if (clip === null) continue
    await page.screenshot({ path: `${out}/${key}.png`, clip })
    if (
      await page
        .locator('.betting-dial')
        .isVisible()
        .catch(() => false)
    )
      return true
  }
  console.error(`could not capture ${key} inside a live turn`)
  return false
}

if (await reachTurn(page)) {
  await page.screenshot({ path: `${out}/05-action-ring.png` })
}
await captureWhileLive('06-ring-detail', '.ram')
await captureWhileLive('07-cards-detail', '.hero-hand')
await captureWhileLive('09-dial-detail', '.betting-dial')
await captureWhileLive('10-sizing-rail', '.dial-presets')

if (await reachTurn(page)) {
  await page.keyboard.down('Tab')
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${out}/08-table-read-held.png` })
  await page.keyboard.up('Tab')
}

await context.close()
await browser.close()
console.log(`captured into ${out}`)

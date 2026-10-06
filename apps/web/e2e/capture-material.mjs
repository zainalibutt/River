import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'

/**
 * Captures the HUD states as PNGs for review.
 *
 * Not a test. It asserts nothing and gates nothing; it exists because the only
 * honest way to judge material is to look at it, and driving a real table to
 * each state by hand costs a session every time somebody asks.
 *
 *   node apps/web/e2e/capture-material.mjs <outputDirectory>
 *
 * Frames come from the devtools protocol rather than page.screenshot, which
 * waits on document.fonts and hung indefinitely against a busy dev server.
 */
const base = process.env.RIVER_E2E_URL ?? 'http://localhost:3100'
const out = process.argv[2] ?? 'material-shots'

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
const page = await context.newPage()
const cdp = await context.newCDPSession(page)
await mkdir(out, { recursive: true })

async function frame(name, selector = null, pad = 24) {
  let clip
  if (selector !== null) {
    const box = await page.evaluate((s) => {
      const el = document.querySelector(s)
      if (el === null) return null
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    }, selector)
    if (box === null) return false
    clip = {
      x: Math.max(0, box.x - pad),
      y: Math.max(0, box.y - pad * 2),
      width: box.width + pad * 2,
      height: box.height + pad * 3,
      scale: 1,
    }
  }
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip })
  await writeFile(`${out}/${name}.png`, Buffer.from(data, 'base64'))
  return true
}

const dealUntil = (selector, timeout) =>
  page
    .waitForFunction(
      (s) => {
        const deal = [...document.querySelectorAll('button')].find(
          (button) => button.textContent?.trim() === 'DEAL',
        )
        if (deal) deal.click()
        return document.querySelector(s) !== null
      },
      selector,
      { timeout, polling: 150 },
    )
    .then(() => true)
    .catch(() => false)

try {
  // A fresh anonymous session carries the signup bankroll; an inherited one can
  // leave every seat disabled.
  await page.goto(base)
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await page.goto(`${base}/table`)
  await page.waitForSelector('.open-seat', { timeout: 90_000 })
  await page.waitForTimeout(9_000)
  await frame('01-table-at-rest')

  const seat = page.locator('.open-seat').nth(4)
  await seat.hover({ force: true })
  await page.waitForTimeout(400)
  await frame('02-seat-lights-up')
  await seat.locator('button').click({ force: true })

  if (await dealUntil('.turn-watch', 90_000)) {
    await page.waitForTimeout(900)
    await frame('03-watch-detail', '.turn-watch', 40)
  }
  if (await dealUntil('.action-menu.ghosted', 60_000)) await frame('04-presets', '.action-menu', 60)
  if (await dealUntil('.action-menu:not(.ghosted)', 120_000)) {
    await frame('05-your-turn')
    await frame('06-menu-detail', '.action-menu', 60)
    await page.keyboard.press('r')
    await page.waitForTimeout(350)
    await frame('07-raise-layer', '.raise-layer', 50)
    await page.keyboard.press('Escape')
  }
  if (await dealUntil('.action-pin', 60_000)) {
    await page.waitForTimeout(3_000)
    await frame('08-action-pins')
  }
  await page.keyboard.down('Tab')
  await page.waitForTimeout(500)
  await frame('09-table-read-held')
  await page.keyboard.up('Tab')
} finally {
  await context.close()
  await browser.close()
}
console.log(`captured into ${out}`)

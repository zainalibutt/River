import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test'

const MIN_TARGET = 56
const CENTRE_TOLERANCE = 2
const HOLE_CARD = { width: 168, height: 235 }

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

interface Control {
  label: string
  width: number
  height: number
}

interface Snapshot {
  scale: number
  menu: Rect | null
  menuControls: Control[]
  statusLine: Rect | null
  menuOverStatus: boolean
  card: Rect | null
  layerOpenedByKey: boolean
  layerControls: Control[]
  notchLabels: Rect[]
}

let snapshot: Snapshot
let page: Page
let context: BrowserContext

/**
 * Reach the local player's turn from a session this run created.
 *
 * A fresh anonymous session carries the signup bankroll. An inherited one can
 * be empty, which disables every seat and used to surface as a setup timeout.
 * The seat click is forced because the targets move while the opening camera
 * settles; the harness measures the menu, not the click.
 */
async function reachLiveTurn(target: Page): Promise<void> {
  await target.goto('/')
  await target.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await target.goto('/table')
  await target.waitForFunction(
    () => {
      const seats = [...document.querySelectorAll('.seat')]
      return seats.length > 0 && seats.every((el) => el.style.getPropertyValue('--chair-x') !== '')
    },
    null,
    { timeout: 90_000, polling: 300 },
  )
  await target.waitForTimeout(5_000)
  await target.locator('.open-seat button').nth(3).click({ force: true, timeout: 15_000 })
  await target.waitForFunction(
    () => {
      const deal = [...document.querySelectorAll('button')].find(
        (button) => button.textContent?.trim() === 'DEAL',
      )
      if (deal) deal.click()
      return document.querySelector('.action-menu:not(.ghosted)') !== null
    },
    null,
    { timeout: 150_000, polling: 150 },
  )
}

function measureMenu(): Omit<Snapshot, 'layerOpenedByKey' | 'layerControls' | 'notchLabels'> {
  const rect = (el: Element | null): Rect | null => {
    if (el === null) return null
    const box = el.getBoundingClientRect()
    return { x: box.x, y: box.y, width: box.width, height: box.height }
  }
  const menu = rect(document.querySelector('.action-menu'))
  const statusLine = rect(document.querySelector('.status-line.populated'))
  const overlap = (a: Rect | null, b: Rect | null) =>
    a !== null &&
    b !== null &&
    Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) &&
    Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y)
  return {
    scale: Math.min(window.innerWidth / 1920, window.innerHeight / 1080),
    menu,
    menuControls: [...document.querySelectorAll('.action-menu button')].map((el) => {
      const box = el.getBoundingClientRect()
      return {
        label: el.getAttribute('aria-label') ?? '',
        width: Math.round(box.width),
        height: Math.round(box.height),
      }
    }),
    statusLine,
    menuOverStatus: overlap(menu, statusLine),
    // Layout size, not the on-screen box. The hand is tilted five degrees and
    // deals in from 0.85 scale, so its bounding box is never the card's size.
    card: (() => {
      const el = document.querySelector<HTMLElement>('.hero-hand .playing-card')
      return el === null ? null : { x: 0, y: 0, width: el.offsetWidth, height: el.offsetHeight }
    })(),
  }
}

function measureLayer(): Pick<Snapshot, 'layerControls' | 'notchLabels'> {
  return {
    layerControls: [...document.querySelectorAll('.raise-layer button')].map((el) => {
      const box = el.getBoundingClientRect()
      return {
        label: (el.textContent ?? '').trim() || (el.getAttribute('aria-label') ?? ''),
        width: Math.round(box.width),
        height: Math.round(box.height),
      }
    }),
    notchLabels: [...document.querySelectorAll('.raise-notch-label')].map((el) => {
      const box = el.getBoundingClientRect()
      return { x: box.x, y: box.y, width: box.width, height: box.height }
    }),
  }
}

test.describe('the action surface, in base-canvas pixels', () => {
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    test.setTimeout(300_000)
    context = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
    page = await context.newPage()
    await reachLiveTurn(page)
    // Measured in the state the defect lives in. The menu mounts in the same
    // frame the turn opens, before its key listener is attached, and the hole
    // cards are still in their deal animation at 0.85 scale. Measuring at that
    // instant failed a raise layer that opens and a card that is full size.
    await page.waitForTimeout(700)
    const menu = await page.evaluate(measureMenu)
    await page.keyboard.press('r')
    // Presence, not Playwright's visibility check, which reported the layer
    // hidden while the page had already rendered it.
    const layerOpenedByKey = await page
      .waitForFunction(() => document.querySelector('.raise-layer') !== null, null, {
        timeout: 3_000,
        polling: 100,
      })
      .then(() => true)
      .catch(() => false)
    const layer = layerOpenedByKey
      ? await page.evaluate(measureLayer)
      : { layerControls: [], notchLabels: [] }
    snapshot = { ...menu, layerOpenedByKey, ...layer }
  })

  test.afterAll(async () => {
    await context?.close()
  })

  test('measures at a stage scale of 1', () => {
    expect(snapshot.scale).toBeCloseTo(1, 3)
  })

  test('keeps the menu at the lower centre of the screen', () => {
    expect(snapshot.menu).not.toBeNull()
    const menu = snapshot.menu as Rect
    expect(Math.abs(menu.x + menu.width / 2 - 960)).toBeLessThanOrEqual(CENTRE_TOLERANCE)
    expect(menu.y + menu.height).toBeLessThanOrEqual(1080)
  })

  test('offers three named actions, each at least 56 x 56', () => {
    expect(snapshot.menuControls).toHaveLength(3)
    expect(snapshot.menuControls.every((control) => control.label.length > 0)).toBe(true)
    const undersized = snapshot.menuControls
      .filter((control) => control.width < MIN_TARGET || control.height < MIN_TARGET)
      .map((control) => `${control.label} at ${control.width}x${control.height}`)
    expect(undersized).toEqual([])
  })

  test('keeps the menu off the status line', () => {
    expect(snapshot.menuOverStatus).toBe(false)
  })

  test('opens the raise layer from the keyboard', () => {
    expect(snapshot.layerOpenedByKey).toBe(true)
  })

  test('gives every raise control at least 56 x 56', () => {
    expect(snapshot.layerControls.length).toBeGreaterThanOrEqual(5)
    const undersized = snapshot.layerControls
      .filter((control) => control.width < MIN_TARGET || control.height < MIN_TARGET)
      .map((control) => `${control.label} at ${control.width}x${control.height}`)
    expect(undersized).toEqual([])
  })

  /**
   * The arc started square-root and stacked the half, three-quarter and pot
   * labels on top of one another against a deep stack. Overlap is the defect,
   * so overlap is what this measures.
   */
  test('keeps the pot notch labels from overlapping', () => {
    const labels = snapshot.notchLabels
    const collisions: string[] = []
    for (let i = 0; i < labels.length; i += 1) {
      for (let j = i + 1; j < labels.length; j += 1) {
        const a = labels[i] as Rect
        const b = labels[j] as Rect
        const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
        const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
        if (width > 0 && height > 0) collisions.push(`${i} and ${j}`)
      }
    }
    expect(collisions).toEqual([])
  })

  test('gives the local hand the size the anatomy gives it', () => {
    expect(snapshot.card).not.toBeNull()
    expect(Math.round(snapshot.card?.width ?? 0)).toBeGreaterThanOrEqual(HOLE_CARD.width)
    expect(Math.round(snapshot.card?.height ?? 0)).toBeGreaterThanOrEqual(HOLE_CARD.height)
  })
})

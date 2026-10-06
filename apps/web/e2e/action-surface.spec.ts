import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test'

const MIN_TARGET = 56
const CENTRE_TOLERANCE = 2

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
  /** Every placard on the 2D table, and every fixed piece of HUD, as seen on the live turn. */
  placards: Rect[]
  hud: { name: string; rect: Rect }[]
  scale: number
  menu: Rect | null
  menuControls: Control[]
  statusLine: Rect | null
  menuOverStatus: boolean
  cardsAtRest: { backs: number; faces: number }
  cardsHeld: { backs: number; faces: number }
  platesWhileHeld: boolean
  platesAfterRelease: boolean
  raiseBeforeDrag: string
  raiseAfterDrag: string
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
 * The table now takes the first affordable seat automatically.
 */
async function reachLiveTurn(target: Page): Promise<void> {
  await target.goto('/')
  await target.evaluate(() => {
    localStorage.clear()
    sessionStorage.clear()
  })
  await target.goto('/table')
  await expect(target.getByRole('button', { name: 'DEAL', exact: true })).toBeVisible({
    timeout: 90_000,
  })
  // Bring the pointer into the room the way a seated player would before the
  // cards come.
  await target.mouse.move(700, 420)
  await target.mouse.move(1100, 520, { steps: 8 })
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

function measureMenu(): Pick<
  Snapshot,
  'scale' | 'menu' | 'menuControls' | 'statusLine' | 'menuOverStatus'
> {
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
    const table = await page.evaluate(() => {
      const rect = (el: Element) => {
        const box = el.getBoundingClientRect()
        return { x: box.x, y: box.y, width: box.width, height: box.height }
      }
      return {
        placards: [...document.querySelectorAll('.t2d-placard')].map(rect),
        hud: [
          ['left corner', '.hud-corner-left'],
          ['right corner', '.hud-corner-right'],
          ['cluster', '.table-cluster'],
          ['action menu', '.action-menu'],
        ].flatMap(([name, selector]) => {
          const el = document.querySelector(selector as string)
          return el === null ? [] : [{ name: name as string, rect: rect(el) }]
        }),
      }
    })
    const countCards = () =>
      page.evaluate(() => ({
        backs: document.querySelectorAll('.hero-cards .card-back').length,
        faces: document.querySelectorAll('.hero-cards .playing-card').length,
      }))
    const cardsAtRest = await countCards()
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
    let raiseBeforeDrag = ''
    let raiseAfterDrag = ''
    if (layerOpenedByKey) {
      const readout = () =>
        page
          .locator('.raise-readout strong')
          .innerText({ timeout: 2_000 })
          .catch(() => '')
      raiseBeforeDrag = await readout()
      const knob = await page
        .locator('.raise-knob')
        .boundingBox({ timeout: 2_000 })
        .catch(() => null)
      const arc = await page
        .locator('.raise-arc')
        .boundingBox({ timeout: 2_000 })
        .catch(() => null)
      if (knob !== null && arc !== null) {
        await page.mouse.move(knob.x + knob.width / 2, knob.y + knob.height / 2)
        await page.mouse.down()
        await page.mouse.move(arc.x + arc.width * 0.78, arc.y + arc.height * 0.2, { steps: 10 })
        await page.mouse.up()
        await page.waitForTimeout(150)
      }
      raiseAfterDrag = await readout()
    }
    if (layerOpenedByKey) await page.keyboard.press('Escape')
    let cardsHeld = { backs: -1, faces: -1 }
    const hand = await page
      .locator('.hero-cards')
      .boundingBox({ timeout: 2_000 })
      .catch(() => null)
    if (hand !== null) {
      await page.mouse.move(hand.x + hand.width / 2, hand.y + hand.height / 2)
      await page.mouse.down()
      await page.waitForTimeout(150)
      cardsHeld = await countCards()
      await page.mouse.up()
      await page.waitForTimeout(150)
    }
    const platesShown = () =>
      page.evaluate(() => document.querySelector('.seat-ring.plates-held') !== null)
    await page.keyboard.down('Tab')
    await page.waitForTimeout(150)
    const platesWhileHeld = await platesShown()
    await page.keyboard.up('Tab')
    await page.waitForTimeout(150)
    const platesAfterRelease = await platesShown()
    snapshot = {
      ...table,
      ...menu,
      layerOpenedByKey,
      ...layer,
      cardsAtRest,
      cardsHeld,
      platesWhileHeld,
      platesAfterRelease,
      raiseBeforeDrag,
      raiseAfterDrag,
    }
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

  /**
   * The 2D table's placards sit round the rail, and the rail runs behind the HUD's corners,
   * the cluster and the action menu. Measured on a live turn, when all of them are up.
   */
  test('keeps every placard on the stage, apart, and out from under the HUD', () => {
    expect(snapshot.placards.length).toBeGreaterThanOrEqual(7)
    const overlap = (a: Rect, b: Rect) =>
      Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1 &&
      Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1
    const problems: string[] = []
    snapshot.placards.forEach((placard, index) => {
      if (
        placard.x < 0 ||
        placard.y < 0 ||
        placard.x + placard.width > 1920 ||
        placard.y + placard.height > 1080
      )
        problems.push(`placard ${index} off the stage`)
      for (const hud of snapshot.hud) {
        if (overlap(placard, hud.rect)) problems.push(`placard ${index} under the ${hud.name}`)
      }
      snapshot.placards.slice(index + 1).forEach((other, offset) => {
        if (overlap(placard, other)) problems.push(`placards ${index} and ${index + offset + 1}`)
      })
    })
    expect(problems).toEqual([])
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

  test('keeps your cards face down until you press and hold them', () => {
    // Unparked with the 2D table. The gestures were never unreliable: the 3D
    // room drew in software in this browser, about a frame a second, and a timer
    // fired a second late. The 2D table draws no WebGL, and they run on time.
    expect(snapshot.cardsAtRest).toEqual({ backs: 2, faces: 0 })
    expect(snapshot.cardsHeld).toEqual({ backs: 0, faces: 2 })
  })

  test('shows the plates only while Tab is held', () => {
    expect(snapshot.platesWhileHeld).toBe(true)
    expect(snapshot.platesAfterRelease).toBe(false)
  })

  /**
   * The knob could not be dragged at all: the arc is a div inside a layer that
   * ignores the pointer, so the drag fell through and orbited the camera.
   */
  test('raises by dragging the knob', () => {
    // Unparked with the 2D table. The gestures were never unreliable: the 3D
    // room drew in software in this browser, about a frame a second, and a timer
    // fired a second late. The 2D table draws no WebGL, and they run on time.
    expect(snapshot.raiseBeforeDrag).not.toBe('')
    expect(snapshot.raiseAfterDrag).not.toBe(snapshot.raiseBeforeDrag)
  })
})

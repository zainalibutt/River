import { type Browser, expect, type Page, test } from '@playwright/test'

const MIN_TARGET = 56
/**
 * `04-anatomy.md` gives the RAM an outer diameter of 420 and says the betting
 * dial occupies its interior. An earlier version of this file asserted a
 * 330-pixel dial, a figure that came from a comment in `globals.css` rather
 * than from the spec, so the gate measured a quantity nothing had decided.
 */
const RAM_DIAMETER = 420
const CONCENTRIC_TOLERANCE = 2
const HOLE_CARD = { width: 168, height: 235 }
const RADIUS_SPREAD = 1.15

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

interface Snapshot {
  scale: number
  controls: { label: string; width: number; height: number }[]
  dial: Rect | null
  ram: Rect | null
  concentricOffset: number | null
  statusLine: Rect | null
  overlapping: { label: string; width: number; height: number }[]
  radii: number[]
  card: Rect | null
  presets: { label: string; amount: number }[]
  allInAmount: number
}

/**
 * One live turn, one snapshot, then every invariant asserts against it.
 *
 * Reaching a live turn costs about forty seconds: navigate, sit, deal, wait for
 * a bot ring to act. Paying that per assertion made the first version of this
 * file take longer than the fix it was written to gate, so the page is driven
 * once in `beforeAll` and the tests read numbers rather than the DOM.
 */
let snapshot: Snapshot
let page: Page

async function reachLiveTurn(target: Page): Promise<void> {
  await target.goto('/table')
  await target.getByRole('button', { name: 'SIT', exact: true }).first().click({ timeout: 30_000 })
  const deal = target.getByRole('button', { name: 'DEAL', exact: true })
  const dial = target.locator('.betting-dial')
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (await dial.isVisible().catch(() => false)) return
    if (await deal.isVisible().catch(() => false)) await deal.click().catch(() => {})
    await target.waitForTimeout(250)
  }
  throw new Error('no live turn with a betting dial inside 120s')
}

function capture(): Snapshot {
  const rect = (el: Element | null): Rect | null => {
    if (el === null) return null
    const box = el.getBoundingClientRect()
    return { x: box.x, y: box.y, width: box.width, height: box.height }
  }
  const name = (el: Element): string =>
    (el.getAttribute('aria-label') ?? el.textContent ?? 'unlabelled').replace(/\s+/g, ' ').trim()

  const dial = rect(document.querySelector('.betting-dial'))
  const ram = rect(document.querySelector('.ram'))
  const statusLine = rect(document.querySelector('.status-line'))
  const dialCentre =
    dial === null ? null : { x: dial.x + dial.width / 2, y: dial.y + dial.height / 2 }
  const ramCentre = ram === null ? null : { x: ram.x + ram.width / 2, y: ram.y + ram.height / 2 }

  const controls = [...document.querySelectorAll('.ram button')]
    .map((el) => ({ el, box: rect(el) }))
    .filter((entry) => entry.box !== null && entry.box.width > 0)
    .map((entry) => ({
      label: name(entry.el),
      width: Math.round(entry.box?.width ?? 0),
      height: Math.round(entry.box?.height ?? 0),
    }))

  const overlapping =
    statusLine === null
      ? []
      : [...document.querySelectorAll('.betting-dial, .dial-presets, .ram button')]
          .map((el) => ({ el, box: rect(el) }))
          .flatMap(({ el, box }) => {
            if (box === null) return []
            const width =
              Math.min(box.x + box.width, statusLine.x + statusLine.width) -
              Math.max(box.x, statusLine.x)
            const height =
              Math.min(box.y + box.height, statusLine.y + statusLine.height) -
              Math.max(box.y, statusLine.y)
            if (width <= 0 || height <= 0) return []
            return [{ label: name(el), width: Math.round(width), height: Math.round(height) }]
          })

  /**
   * Measured on the labels, not the buttons. Each wedge button fills the whole
   * 420 box and is cut to its segment by `clip-path`, which
   * `getBoundingClientRect` ignores, so every button reports the same box and a
   * correct ring measures as four radii of zero.
   */
  const radii =
    ramCentre === null
      ? []
      : [...document.querySelectorAll('.ram-wedge-label')].flatMap((el) => {
          const box = rect(el)
          if (box === null) return []
          return [
            Math.round(
              Math.hypot(box.x + box.width / 2 - ramCentre.x, box.y + box.height / 2 - ramCentre.y),
            ),
          ]
        })

  const presets = [...document.querySelectorAll('.dial-presets button:not(.dial-step)')].map(
    (el) => {
      const label = el.getAttribute('aria-label') ?? ''
      return {
        label: (el.textContent ?? '').trim(),
        amount: Number(label.replace(/^.*raise to /, '').replace(/,/g, '')),
      }
    },
  )

  return {
    scale: Math.min(window.innerWidth / 1920, window.innerHeight / 1080),
    controls,
    dial,
    ram,
    concentricOffset:
      dialCentre === null || ramCentre === null
        ? null
        : Math.round(Math.hypot(dialCentre.x - ramCentre.x, dialCentre.y - ramCentre.y)),
    statusLine,
    overlapping,
    radii,
    card: rect(document.querySelector('.playing-card')),
    presets,
    allInAmount: Number(
      (document.querySelector('.ram-wedge.all-in')?.textContent ?? '').replace(/[^\d]/g, ''),
    ),
  }
}

test.describe('the action surface, in base-canvas pixels', () => {
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
    await reachLiveTurn(page)
    snapshot = await page.evaluate(capture)
  })

  test.afterAll(async () => {
    await page?.close()
  })

  /**
   * The scale guard, and the reason it runs first. Every figure below comes
   * from `04-anatomy.md` and `06-interaction.md` in base-canvas pixels, and the
   * stage shrinks itself to fit the window. A viewport that is not 1920x1080
   * compares against the wrong numbers silently rather than failing.
   */
  test('measures at a stage scale of 1', () => {
    expect(snapshot.scale).toBeCloseTo(1, 3)
  })

  test('gives every control under time pressure at least 56 x 56', () => {
    expect(snapshot.controls.length).toBeGreaterThan(0)
    const undersized = snapshot.controls
      .filter((control) => control.width < MIN_TARGET || control.height < MIN_TARGET)
      .map((control) => `${control.label} at ${control.width}x${control.height}`)
    expect(undersized).toEqual([])
  })

  test('gives the menu the outer diameter the anatomy gives it', () => {
    expect(snapshot.ram).not.toBeNull()
    expect(Math.round(snapshot.ram?.width ?? 0)).toBe(RAM_DIAMETER)
    expect(Math.round(snapshot.ram?.height ?? 0)).toBe(RAM_DIAMETER)
  })

  test('seats the betting dial in the centre of the menu', () => {
    expect(snapshot.concentricOffset).not.toBeNull()
    expect(snapshot.concentricOffset ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
      CONCENTRIC_TOLERANCE,
    )
  })

  test('keeps the action surface off the status line', () => {
    expect(snapshot.overlapping.map((hit) => `${hit.label} by ${hit.width}x${hit.height}`)).toEqual(
      [],
    )
  })

  test('lays the wedges on a ring rather than in a grid', () => {
    expect(snapshot.radii.length).toBeGreaterThanOrEqual(3)
    const spread = Math.max(...snapshot.radii) / Math.min(...snapshot.radii)
    expect(
      spread,
      `wedge label radii from the menu centre: ${snapshot.radii.join(', ')}`,
    ).toBeLessThanOrEqual(RADIUS_SPREAD)
  })

  test('gives the local hand the size the anatomy gives it', () => {
    expect(snapshot.card).not.toBeNull()
    expect(Math.round(snapshot.card?.width ?? 0)).toBeGreaterThanOrEqual(HOLE_CARD.width)
    expect(Math.round(snapshot.card?.height ?? 0)).toBeGreaterThanOrEqual(HOLE_CARD.height)
  })

  test('offers four distinct raises and no second all-in', () => {
    expect(snapshot.presets).toHaveLength(4)
    const amounts = snapshot.presets.map((preset) => preset.amount)
    expect(amounts.every((amount) => Number.isFinite(amount))).toBe(true)
    expect(new Set(amounts).size, `sizing rail returned ${amounts.join(', ')}`).toBe(4)
    expect(amounts).not.toContain(snapshot.allInAmount)
  })
})

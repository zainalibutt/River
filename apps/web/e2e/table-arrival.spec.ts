import { expect, type Page, test, type WebSocketRoute } from '@playwright/test'

/**
 * Arriving at the table.
 *
 * The table comes up from black once, when the screen first appears, and not
 * again while it carries on: a connection that drops and comes back is the
 * same table, not a new one. This needs only the web app. With no game server
 * behind it the table keeps retrying its connection, which is the same path a
 * dropped connection takes, and with one the test drops the socket itself.
 */

interface SeenAnimation {
  name: string
  duration: string
  background: string
  opacity: string[]
}

/** Records every CSS animation the page starts, from before its first paint. */
async function recordAnimations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen: SeenAnimation[] = []
    Object.assign(window, { riverAnimations: seen })
    document.addEventListener(
      'animationstart',
      (event) => {
        const target = event.target
        if (!(target instanceof HTMLElement)) return
        const style = getComputedStyle(target)
        const running = target
          .getAnimations()
          .find(
            (animation) =>
              animation instanceof CSSAnimation && animation.animationName === event.animationName,
          )
        seen.push({
          name: event.animationName,
          duration: style.animationDuration,
          background: style.backgroundColor,
          opacity: (running?.effect?.getKeyframes() ?? []).map((frame) => String(frame.opacity)),
        })
      },
      true,
    )
  })
}

async function fades(page: Page): Promise<SeenAnimation[]> {
  return page.evaluate(() =>
    (window as unknown as { riverAnimations: SeenAnimation[] }).riverAnimations.filter(
      (animation) => animation.name === 'table-fade-in',
    ),
  )
}

test.describe('arriving at the table', () => {
  test('comes up from black over half a second, once', async ({ page }) => {
    await recordAnimations(page)
    await page.goto('/table')
    await expect(page.locator('.table-fade')).toHaveCount(0, { timeout: 15_000 })
    expect(await fades(page)).toEqual([
      { name: 'table-fade-in', duration: '0.5s', background: 'rgb(0, 0, 0)', opacity: ['1', '0'] },
    ])
  })

  test('does not fade again when the table reconnects', async ({ page }) => {
    await recordAnimations(page)
    // Only the table's own socket; a development server keeps sockets of its own.
    const sockets: WebSocketRoute[] = []
    await page.routeWebSocket(
      (url) => url.pathname === '/ws',
      (socket) => {
        socket.connectToServer()
        sockets.push(socket)
      },
    )
    let attempts = 0
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/config') attempts += 1
    })
    await page.goto('/table')
    await expect(page.locator('.table-fade')).toHaveCount(0, { timeout: 15_000 })
    await expect.poll(() => attempts, { timeout: 15_000 }).toBeGreaterThan(0)
    const before = attempts
    for (const socket of sockets) await socket.close()
    // Every connection attempt starts by fetching the sign-in config.
    await expect.poll(() => attempts, { timeout: 30_000 }).toBeGreaterThan(before)
    await page.waitForTimeout(1_500)
    await expect(page.locator('.table-fade')).toHaveCount(0)
    expect(await fades(page)).toHaveLength(1)
  })
})

test.describe('arriving at the table with less motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('shows the table without a fade', async ({ page }) => {
    await recordAnimations(page)
    await page.goto('/table')
    await expect(page.locator('.table-fade')).toHaveCount(0, { timeout: 15_000 })
    expect(await fades(page)).toEqual([])
  })
})

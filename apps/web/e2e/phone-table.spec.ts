import { expect, type Locator, type Page, test } from '@playwright/test'
import type { TurnAction } from '@river/engine'
import type { RoomView } from '@river/server'
import { overlaps } from '../src/lib/table-2d-geometry'

async function phoneFixture(page: Page, seatCount = 9) {
  const actions: TurnAction[] = []
  let signedUp = 0
  const id = '00000000-0000-4000-8000-000000000001'
  const heroSeat = seatCount - 1
  const view: RoomView = {
    venueId: 'rooftop',
    handNumber: 0,
    phase: 'open',
    street: 'preflop',
    board: [],
    pot: 0,
    currentBet: 0,
    countdownMs: 0,
    seats: Array.from({ length: seatCount }, (_, seat) => ({
      seat,
      playerId: seat === heroSeat ? null : `bot:phone-${seat}`,
      name:
        seat === heroSeat
          ? null
          : seatCount === 2
            ? 'Nell'
            : (['Mickey', 'Edna', 'Nell', 'Jules', 'Bernadette', 'Kazimir', 'Blaise', 'Vesper'][
                seat
              ] ?? 'Bot'),
      stack: seat === heroSeat ? 0 : 100000,
      betHand: 0,
      betStreet: 0,
      folded: false,
      allIn: false,
      hole: null,
      hasHole: false,
      sittingOut: false,
      busted: false,
      disconnected: false,
      dealer: seat === 0,
    })),
    currentActor: null,
    legal: null,
    turnDeadlineMs: null,
    turnBudgetMs: null,
    commit: null,
    revealedSeed: null,
    clientSeeds: null,
    message: null,
    revealed: false,
    selfId: id,
    challenges: [],
    hostPlayerId: id,
    inviteCode: 'PHONE1',
  }
  await page.route('**/api/config', (route) =>
    route.fulfill({
      json: { supabaseUrl: 'https://river-auth.invalid', publishableKey: 'phone-test' },
    }),
  )
  await page.route('https://river-auth.invalid/**', (route) => {
    signedUp += 1
    return route.fulfill({
      json: {
        access_token: 'phone-fixture-token',
        refresh_token: 'phone-fixture-refresh',
        expires_in: 3600,
        token_type: 'bearer',
        user: {
          id,
          aud: 'authenticated',
          role: 'authenticated',
          is_anonymous: true,
          app_metadata: {},
          user_metadata: {},
          created_at: '2026-09-30T00:00:00Z',
        },
      },
    })
  })
  await page.routeWebSocket(
    (url) => url.pathname === '/ws',
    (socket) => {
      const snapshot = (requestId: string | null) =>
        socket.send(
          JSON.stringify({
            kind: 'snapshot',
            requestId,
            roomId: 'phone-proof',
            view,
            events: [],
            balance: 150000,
            botSeats: 0,
            ownedItems: [],
            ownedCosmetics: [],
          }),
        )
      const deal = () => {
        view.handNumber += 1
        view.phase = 'hand'
        view.pot = seatCount === 2 ? 1500 : 750
        view.currentBet = seatCount === 2 ? 1000 : 500
        view.commit = 'a'.repeat(64)
        view.currentActor = { playerId: id, seat: heroSeat }
        view.turnBudgetMs = 30000
        view.turnDeadlineMs = Date.now() + 30000
        view.legal = {
          fold: { enabled: true },
          check: { enabled: false },
          call: { enabled: true, amount: 500 },
          raiseTo: { enabled: true, min: 1000, max: 100000 },
          allIn: { enabled: true, amount: 100000 },
        }
        for (const seat of view.seats) {
          seat.hasHole = true
          seat.dealer = seat.seat === (view.handNumber - 1) % seatCount
          seat.betStreet =
            seatCount === 2
              ? seat.seat === heroSeat
                ? 500
                : 1000
              : seat.seat === 0
                ? 250
                : seat.seat === 1
                  ? 500
                  : 0
          seat.betHand = seat.betStreet
        }
        const hero = view.seats[heroSeat]
        if (hero === undefined) throw new Error('Phone fixture has no hero seat')
        hero.hole = [
          { rank: 'A', suit: 'spades' },
          { rank: 'K', suit: 'hearts' },
        ]
      }
      socket.onMessage((raw) => {
        const message = JSON.parse(String(raw))
        if (message.kind === 'authenticate')
          socket.send(JSON.stringify({ kind: 'authenticated', playerId: id, anonymous: true }))
        if (message.kind === 'enter') snapshot(message.requestId)
        if (message.kind === 'command') {
          if (message.command.kind === 'sit') {
            const hero = view.seats[heroSeat]
            if (hero === undefined) throw new Error('Phone fixture has no hero seat')
            hero.playerId = id
            hero.name = 'Guest'
            hero.stack = 100000
          }
          if (message.command.kind === 'startHand') deal()
          if (message.command.kind === 'act') {
            actions.push(message.command.action)
            deal()
          }
          snapshot(message.requestId)
        }
      })
    },
  )
  return { actions, signups: () => signedUp }
}

async function onScreen(page: Page, locator: Locator) {
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  if (box === null) return
  const viewport = page.viewportSize()
  if (viewport === null) throw new Error('Phone fixture has no viewport')
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1)
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1)
}

async function targets(page: Page, scope = '.phone-table') {
  const boxes = await page
    .locator(`${scope} button:visible, ${scope} input:visible`)
    .evaluateAll((elements) =>
      elements.map((element) => {
        const box = element.getBoundingClientRect()
        return {
          label: element.getAttribute('aria-label') ?? element.textContent,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        }
      }),
    )
  for (const box of boxes) {
    expect(box.width, String(box.label)).toBeGreaterThanOrEqual(44)
    expect(box.height, String(box.label)).toBeGreaterThanOrEqual(44)
  }
  for (const [index, box] of boxes.entries())
    for (const other of boxes.slice(index + 1))
      expect(overlaps(box, other), `${box.label} / ${other.label}`).toBe(false)
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 360, height: 800 },
]) {
  test.describe(`upright phone ${viewport.width}`, () => {
    test.use({ viewport, isMobile: true, hasTouch: true })
    test('a fresh guest sits, peeks, acts and uses the panels', async ({ page }) => {
      const fixture = await phoneFixture(page)
      await page.goto('/table?new=1')
      await expect(page.locator('.phone-hand')).toContainText('100,000')
      await page.getByRole('button', { name: 'DEAL', exact: true }).tap()
      await expect(page.locator('.phone-actions .phone-call')).toBeEnabled()
      await targets(page)
      await onScreen(page, page.locator('.phone-dock'))
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <= innerWidth &&
            document.documentElement.scrollHeight <= innerHeight,
        ),
      ).toBe(true)
      const peek = page.getByRole('button', { name: 'Press and hold to look at your cards' })
      const box = await peek.boundingBox()
      if (box === null) throw new Error('Peek control is not visible')
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await expect(page.locator('.phone-peek-display .playing-card')).toHaveCount(2)
      await expect(page.locator('.phone-peek-display')).toContainText('A')
      await expect(page.locator('.phone-peek-display')).toContainText('K')
      await onScreen(page, page.locator('.phone-peek-display'))
      const enlarged = await page.locator('.phone-peek-display').boundingBox()
      if (enlarged === null) throw new Error('Held cards are not visible')
      expect(enlarged.y + enlarged.height).toBeLessThanOrEqual(box.y)
      await page.mouse.move(enlarged.x + enlarged.width / 2, enlarged.y + enlarged.height / 2, {
        steps: 8,
      })
      expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('')
      expect(
        await page
          .locator('.phone-peek-display > span')
          .evaluate((element) => getComputedStyle(element).userSelect),
      ).toBe('none')
      await page.mouse.up()
      await expect(page.locator('.phone-peek-display')).toHaveCount(0)
      await peek.focus()
      await page.keyboard.down('Space')
      await expect(page.locator('.phone-peek-display')).toBeVisible()
      await peek.dispatchEvent('pointercancel')
      await expect(page.locator('.phone-peek-display')).toHaveCount(0)
      await page.keyboard.up('Space')
      await page.getByRole('button', { name: 'Fold', exact: true }).tap()
      await expect.poll(() => fixture.actions.map((action) => action.kind)).toContain('fold')
      await page.locator('.phone-actions .phone-call').tap()
      await expect.poll(() => fixture.actions.map((action) => action.kind)).toContain('call')
      await page.getByRole('button', { name: 'Raise', exact: true }).tap()
      await expect(page.getByRole('dialog', { name: 'Raise to' })).toBeVisible()
      await targets(page, '.phone-sheet')
      await page.getByRole('button', { name: 'MIN', exact: true }).tap()
      await page.getByRole('button', { name: 'Confirm 1,000', exact: true }).tap()
      await expect.poll(() => fixture.actions).toContainEqual({ kind: 'raiseTo', to: 1000 })
      await page.getByRole('button', { name: 'Table menu' }).tap()
      await page.getByRole('button', { name: 'Chat', exact: true }).tap()
      await expect(page.getByRole('dialog', { name: 'Table chat' })).toBeVisible()
      await targets(page, '.phone-sheet')
      await page.getByRole('textbox', { name: 'Message the table' }).fill('Hello table')
      await page.getByRole('textbox', { name: 'Message the table' }).selectText()
      expect(
        await page.getByRole('textbox', { name: 'Message the table' }).evaluate((element) => {
          const input = element as HTMLInputElement
          return (input.selectionEnd ?? 0) - (input.selectionStart ?? 0)
        }),
      ).toBe(11)
      await page.getByRole('button', { name: 'Close panel' }).tap()
      await page.getByRole('button', { name: 'Table menu' }).tap()
      await page.getByRole('button', { name: /Hand history/ }).tap()
      await expect(page.getByRole('dialog', { name: 'Hand history' })).toBeVisible()
      await targets(page, '.history-modal')
      await page.getByRole('button', { name: 'CLOSE', exact: true }).tap()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      expect(fixture.signups()).toBe(1)
    })

    test('bets stay clear of nameplates and the account panel closes completely', async ({
      page,
    }) => {
      await phoneFixture(page)
      await page.goto('/table?new=1')
      await page.getByRole('button', { name: 'DEAL', exact: true }).tap()
      await expect(page.locator('.t2d-tag')).toHaveCount(2)
      await expect(page.locator('.t2d-pile-amount:visible')).toHaveCount(0)
      const labels = await page
        .locator('.t2d-tag, .t2d-note')
        .evaluateAll((elements) =>
          elements.map((element) => element.getBoundingClientRect().toJSON()),
        )
      const plates = await page
        .locator('.t2d-placard')
        .evaluateAll((elements) =>
          elements.map((element) => element.getBoundingClientRect().toJSON()),
        )
      for (const label of labels) {
        for (const plate of plates) expect(overlaps(label, plate)).toBe(false)
        expect(label.x).toBeGreaterThanOrEqual(0)
        expect(label.x + label.width).toBeLessThanOrEqual(viewport.width)
      }
      await page.getByRole('button', { name: 'Table menu' }).tap()
      await page.getByRole('button', { name: 'Log in', exact: true }).tap()
      await expect(page.getByRole('textbox', { name: 'SAVE YOUR PROGRESS' })).toBeVisible()
      await page
        .locator('.upgrade-panel')
        .getByRole('button', { name: 'NOT NOW', exact: true })
        .tap()
      await expect(page.getByRole('dialog')).toHaveCount(0)
    })

    test('heads-up faces the opponent and follows the server dealer flag across hands', async ({
      page,
    }) => {
      await phoneFixture(page, 2)
      await page.goto('/table?new=1&strength=champion')
      await page.getByRole('button', { name: 'DEAL', exact: true }).tap()
      await expect(page.locator('.t2d-dealer, .t2d-shoe')).toHaveCount(0)
      await expect(page.locator('.t2d-placard')).toHaveCount(1)
      await expect(page.locator('.phone-dealer')).toHaveText('DEALER')
      await expect(page.getByRole('img', { name: 'Dealer: Nell', exact: true })).toBeVisible()
      const opponent = await page.locator('.t2d-placard').boundingBox()
      if (opponent === null) throw new Error('No heads-up opponent')
      expect(opponent.x + opponent.width / 2).toBeCloseTo(viewport.width / 2, 0)
      await page.getByRole('button', { name: 'Fold', exact: true }).tap()
      await expect(page.getByRole('img', { name: 'Dealer: Guest', exact: true })).toBeVisible()
      await expect(page.locator('.phone-dealer')).toHaveCount(0)
      await expect(page.locator('.phone-hand')).toContainText('DEALER')
      await targets(page)
    })
  })
}

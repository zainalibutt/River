import { expect, type Locator, type Page, test, type WebSocketRoute } from '@playwright/test'
import type { TurnAction } from '@river/engine'
import type { RoomView } from '@river/server'
import { overlaps } from '../src/lib/table-2d-geometry'
import { installSoundProbe } from './sound-probe'

async function phoneFixture(page: Page, seatCount = 9) {
  const actions: TurnAction[] = []
  const commands: string[] = []
  const sockets: WebSocketRoute[] = []
  const waitingForAuthentication: WebSocketRoute[] = []
  let acceptingConnections = true
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
      sockets.push(socket)
      const authenticate = () =>
        socket.send(JSON.stringify({ kind: 'authenticated', playerId: id, anonymous: true }))
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
        if (message.kind === 'authenticate') {
          if (acceptingConnections) authenticate()
          else waitingForAuthentication.push(socket)
        }
        if (message.kind === 'enter') snapshot(message.requestId)
        if (message.kind === 'command') {
          commands.push(message.command.kind)
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
  return {
    actions,
    commands,
    update: (next: Partial<RoomView>) => {
      Object.assign(view, next)
      for (const socket of sockets)
        socket.send(
          JSON.stringify({
            kind: 'snapshot',
            requestId: null,
            roomId: 'phone-proof',
            view,
            events: [],
            balance: 150000,
            botSeats: 0,
            ownedItems: [],
            ownedCosmetics: [],
          }),
        )
    },
    hero: { playerId: id, seat: heroSeat },
    signups: () => signedUp,
    connections: () => sockets.length,
    waiting: () => waitingForAuthentication.length,
    disconnect: async () => {
      acceptingConnections = false
      const socket = sockets.at(-1)
      if (socket === undefined) throw new Error('Phone fixture has no connected socket')
      await socket.close({ code: 1012, reason: 'Fixture connection interrupted' })
    },
    reconnect: () => {
      acceptingConnections = true
      for (const socket of waitingForAuthentication.splice(0))
        socket.send(JSON.stringify({ kind: 'authenticated', playerId: id, anonymous: true }))
    },
  }
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

test.describe('mobile waiting controls and burns', () => {
  for (const viewport of [
    { width: 320, height: 740 },
    { width: 390, height: 844 },
  ]) {
    test.describe(`${viewport.width}px`, () => {
      test.use({ viewport, isMobile: true, hasTouch: true })

      test('keeps pre-actions in the material language and honours arming and cancellation', async ({
        page,
      }) => {
        const fixture = await phoneFixture(page, 2)
        await page.goto('/table?new=1&strength=champion')
        await page.getByRole('button', { name: 'DEAL', exact: true }).tap()
        fixture.update({ currentActor: { playerId: 'bot:phone-0', seat: 0 } })
        const waiting = page.locator('.phone-actions > .phone-preset')
        await expect(waiting).toHaveCount(3)
        await targets(page)
        for (const button of await waiting.all()) {
          expect(await button.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain(
            'conic-gradient',
          )
          expect(await button.evaluate((el) => getComputedStyle(el).fontFamily)).toContain(
            'Barlow Condensed',
          )
          await expect(button.locator('svg path')).toHaveCount(1)
          await button.tap()
          await expect(button).toHaveAttribute('aria-pressed', 'true')
          await button.tap()
          await expect(button).toHaveAttribute('aria-pressed', 'false')
        }
        expect(fixture.actions).toEqual([])
        await page.getByRole('button', { name: 'CALL ANY', exact: true }).tap()
        fixture.update({ currentActor: fixture.hero })
        await expect.poll(() => fixture.actions).toEqual([{ kind: 'call' }])
        await expect(page.getByRole('button', { name: 'Raise', exact: true })).toBeVisible()
        await targets(page)
      })

      test('places the face-down burn beside the community board, not Nell’s private cards', async ({
        page,
      }) => {
        const fixture = await phoneFixture(page, 2)
        await page.goto('/table?new=1&strength=champion')
        await page.getByRole('button', { name: 'DEAL', exact: true }).tap()
        await expect(page.locator('.t2d-card-hole:not(.moving)')).toHaveCount(4)
        fixture.update({
          street: 'flop',
          board: [
            { rank: '2', suit: 'diamonds' },
            { rank: '7', suit: 'clubs' },
            { rank: 'J', suit: 'hearts' },
          ],
          currentActor: { playerId: 'bot:phone-0', seat: 0 },
        })
        const burn = page.locator('.t2d-card-burn:not(.moving)')
        await expect(burn).toHaveCount(1)
        await expect(page.locator('.t2d-card-board:not(.moving)')).toHaveCount(3)
        await expect(burn.getByRole('img', { name: 'Face-down card' })).toBeVisible()
        const box = await burn.boundingBox()
        if (box === null) throw new Error('Burn pile is not visible')
        for (const card of await page.locator('.t2d-card-hole, .t2d-card-board').all()) {
          const other = await card.boundingBox()
          if (other === null) throw new Error('Table card is not visible')
          expect(overlaps(box, other)).toBe(false)
        }
        const board = await page.locator('.t2d-card-board').first().boundingBox()
        if (board === null) throw new Error('Community board is not visible')
        expect(box.y + box.height).toBeLessThan(board.y)
        expect(board.y - box.y - box.height).toBeLessThan(30)
        await onScreen(page, burn)
      })
    })
  }
})

test.describe('mobile betting material', () => {
  test.describe('all-in material feedback', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

    for (const reducedMotion of ['no-preference', 'reduce'] as const) {
      test(`hold keeps its confirmation guard with ${reducedMotion} motion`, async ({ page }) => {
        const fixture = await phoneFixture(page)
        await page.emulateMedia({ reducedMotion })
        await page.goto('/table?new=1')
        await page.getByRole('button', { name: 'DEAL', exact: true }).tap()
        await page.getByRole('button', { name: 'Raise', exact: true }).tap()
        const hold = page.getByRole('button', { name: 'Hold to go all in' })
        await hold.focus()
        await page.keyboard.down('Space')
        await expect(hold).toHaveClass(/holding/)
        expect(await hold.evaluate((el) => getComputedStyle(el, '::after').animationName)).toBe(
          reducedMotion === 'reduce' ? 'none' : 'phone-material-hold',
        )
        expect(await hold.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain(
          'conic-gradient',
        )
        await hold.dispatchEvent('pointercancel')
        await page.keyboard.up('Space')
        await expect(hold).not.toHaveClass(/holding/)
        await page.waitForTimeout(650)
        expect(fixture.actions).toEqual([])
        await page.keyboard.down('Space')
        await expect.poll(() => fixture.actions).toEqual([{ kind: 'allIn' }])
        await page.keyboard.up('Space')
        await expect(page.getByRole('dialog')).toHaveCount(0)
      })
    }
  })

  for (const viewport of [
    { width: 320, height: 740 },
    { width: 390, height: 844 },
  ]) {
    test.describe(`${viewport.width}px upright controls`, () => {
      test.use({ viewport, isMobile: true, hasTouch: true })

      test('reuses wheel graphics while preserving labelled touch actions and native sizing', async ({
        page,
      }) => {
        const fixture = await phoneFixture(page)
        await page.goto('/table?new=1')
        await page.getByRole('button', { name: 'DEAL', exact: true }).tap()
        const actions = page.getByRole('region', { name: 'Your actions' })
        await expect(actions.getByRole('button')).toHaveCount(3)
        expect(
          await actions
            .locator('svg path')
            .evaluateAll((paths) => paths.map((p) => p.getAttribute('d'))),
        ).toEqual([
          'M7 7l10 10M17 7 7 17',
          'M12 19V6M6.5 11.5 12 6l5.5 5.5',
          'M12 21V11M7 15.5l5-5 5 5M7 9.5l5-5 5 5',
        ])
        await expect(actions.getByRole('button', { name: 'Fold', exact: true })).toBeVisible()
        await expect(actions.getByRole('button', { name: 'Call 500', exact: true })).toBeVisible()
        const raise = actions.getByRole('button', { name: 'Raise', exact: true })
        await expect
          .poll(() => raise.evaluate((el) => getComputedStyle(el).fontFamily))
          .toContain('Barlow Condensed')
        expect(await raise.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain(
          'conic-gradient',
        )
        await targets(page)
        await onScreen(page, page.locator('.phone-dock'))
        await raise.tap()
        const sheet = page.getByRole('dialog', { name: 'Raise to', exact: true })
        await expect(sheet).toHaveClass(/phone-raise-sheet/)
        await targets(page, '.phone-sheet')
        await onScreen(page, sheet)
        const slider = sheet.getByRole('slider', { name: 'Raise amount' })
        await expect(slider).toHaveAttribute('type', 'range')
        await expect(slider).toHaveAttribute('min', '1000')
        await expect(slider).toHaveAttribute('max', '100000')
        await expect(slider).toHaveAttribute('step', '1')
        await expect
          .poll(() => sheet.locator('output').evaluate((el) => getComputedStyle(el).fontFamily))
          .toContain('Fraunces')
        await slider.fill('2000')
        await slider.press('ArrowRight')
        await expect(slider).toHaveValue('2001')
        expect(fixture.actions).toEqual([])
        expect(await sheet.locator('.phone-confirm svg path').count()).toBe(2)
        await sheet.getByRole('button', { name: 'MIN', exact: true }).tap()
        await expect(slider).toHaveValue('1000')
        await sheet.getByRole('button', { name: 'Confirm 1,000', exact: true }).tap()
        await expect.poll(() => fixture.actions).toEqual([{ kind: 'raiseTo', to: 1000 }])
        await expect(page.getByRole('dialog')).toHaveCount(0)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        )
      })
    })
  }
})

test.describe('phone card and sizing feedback', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`peek conceals immediately with ${reducedMotion} motion`, async ({ page }) => {
      const fixture = await phoneFixture(page)
      await page.emulateMedia({ reducedMotion })
      await page.goto('/table?new=1')
      await page.getByRole('button', { name: 'DEAL', exact: true }).tap()
      const peek = page.getByRole('button', { name: 'Press and hold to look at your cards' })
      await peek.focus()
      await page.keyboard.down('Space')
      const display = page.getByRole('region', { name: 'Your enlarged cards' })
      await expect(display.locator('.playing-card')).toHaveCount(2)
      await expect(display).toContainText('A')
      await expect(display).toContainText('K')
      expect(await display.evaluate((element) => getComputedStyle(element).animationName)).toBe(
        reducedMotion === 'reduce' ? 'none' : 'phone-peek-reveal',
      )
      expect(await display.evaluate((element) => getComputedStyle(element).animationDuration)).toBe(
        reducedMotion === 'reduce' ? '0s' : '0.14s',
      )
      await page.keyboard.up('Space')
      expect(await display.count()).toBe(0)
      expect(fixture.actions).toEqual([])
      await page.keyboard.down('Space')
      await expect(display).toBeVisible()
      await peek.dispatchEvent('pointercancel')
      expect(await display.count()).toBe(0)
      await page.keyboard.up('Space')
      await page.keyboard.down('Space')
      await expect(display).toBeVisible()
      await page.evaluate(() => window.dispatchEvent(new Event('blur')))
      expect(await display.count()).toBe(0)
      await page.keyboard.up('Space')
    })
  }

  test('ticks changed sizing only, keeps mute and sends nothing before confirmation', async ({
    page,
  }) => {
    const fixture = await phoneFixture(page)
    const sound = await installSoundProbe(page)
    await page.goto('/table?new=1')
    await page.getByRole('button', { name: 'DEAL', exact: true }).tap()
    await expect.poll(sound.decoded).toBe(14)
    const peek = page.getByRole('button', { name: 'Press and hold to look at your cards' })
    await peek.focus()
    await page.keyboard.down('Space')
    await expect.poll(() => sound.count('card_peek')).toBe(1)
    await page.keyboard.up('Space')
    await page.getByRole('button', { name: 'Raise', exact: true }).tap()
    const slider = page.getByRole('slider', { name: 'Raise amount' })
    await expect(slider).toBeVisible()
    expect(await sound.count('wheel_tick')).toBe(0)
    await slider.fill('2000')
    await expect.poll(() => sound.count('wheel_tick')).toBe(1)
    await expect(slider).toHaveValue('2000')
    await page.getByRole('button', { name: 'MIN', exact: true }).tap()
    await expect.poll(() => sound.count('wheel_tick')).toBe(2)
    await page.getByRole('button', { name: 'MIN', exact: true }).tap()
    await expect(slider).toHaveValue('1000')
    expect(await sound.count('wheel_tick')).toBe(2)
    await slider.press('ArrowLeft')
    expect(await sound.count('wheel_tick')).toBe(2)
    await page.getByRole('button', { name: 'Close panel' }).tap()
    await page.getByRole('button', { name: 'Raise', exact: true }).tap()
    await expect(slider).toHaveValue('1000')
    expect(await sound.count('wheel_tick')).toBe(2)
    expect(fixture.actions).toEqual([])
    await page.getByRole('button', { name: 'Close panel' }).tap()
    await page.getByRole('button', { name: 'Table menu' }).tap()
    await page.getByRole('button', { name: 'Settings', exact: true }).tap()
    await page.getByRole('button', { name: 'Sound', exact: true }).click()
    await page.getByRole('button', { name: 'Close panel' }).tap()
    await page.getByRole('button', { name: 'Raise', exact: true }).tap()
    await slider.fill('2500')
    await expect(slider).toHaveValue('2500')
    expect(await sound.count('wheel_tick')).toBe(2)
    expect(fixture.actions).toEqual([])
    await page.getByRole('button', { name: 'Confirm 2,500', exact: true }).tap()
    await expect.poll(() => fixture.actions).toEqual([{ kind: 'raiseTo', to: 2500 }])
  })
})

for (const viewport of [
  { width: 390, height: 844 },
  { width: 360, height: 800 },
]) {
  test.describe(`upright phone ${viewport.width}`, () => {
    test.use({ viewport, isMobile: true, hasTouch: true })
    test('a connection interruption keeps the hand and does not repeat the buy-in', async ({
      page,
    }) => {
      const fixture = await phoneFixture(page)
      await page.goto('/table?new=1')
      await page.getByRole('button', { name: 'DEAL', exact: true }).tap()
      const call = page.locator('.phone-actions .phone-call')
      await expect(call).toBeEnabled()
      const handBefore = await page.locator('.phone-hand').innerText()
      const potBefore = await page.locator('.phone-pot > span').innerText()
      await fixture.disconnect()
      await expect(page.locator('.phone-network')).toHaveText('LINK')
      await expect(call).toBeDisabled()
      await expect(page.getByRole('button', { name: 'Fold', exact: true })).toBeDisabled()
      await expect(page.getByRole('button', { name: 'Raise', exact: true })).toBeDisabled()
      expect(await page.locator('.phone-hand').innerText()).toBe(handBefore)
      expect(await page.locator('.phone-pot > span').innerText()).toBe(potBefore)
      await expect.poll(() => fixture.waiting()).toBe(1)
      fixture.reconnect()
      await expect(page.locator('.phone-network')).toHaveText('LIVE')
      await expect(call).toBeEnabled()
      expect(fixture.connections()).toBe(2)
      expect(fixture.signups()).toBe(1)
      expect(fixture.commands.filter((kind) => kind === 'sit')).toHaveLength(1)
      expect(fixture.commands.filter((kind) => kind === 'startHand')).toHaveLength(1)
      expect(fixture.actions).toEqual([])
      expect(await page.locator('.phone-hand').innerText()).toBe(handBefore)
      expect(await page.locator('.phone-pot > span').innerText()).toBe(potBefore)
      const peek = page.getByRole('button', { name: 'Press and hold to look at your cards' })
      await peek.focus()
      await page.keyboard.down('Space')
      await expect(page.locator('.phone-peek-display .playing-card')).toHaveCount(2)
      await expect(page.locator('.phone-peek-display')).toContainText('A')
      await expect(page.locator('.phone-peek-display')).toContainText('K')
      await page.keyboard.up('Space')
      await expect(page.locator('.phone-peek-display')).toHaveCount(0)
    })

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

    test('sheets own focus and isolate the table until they close', async ({ page }) => {
      await phoneFixture(page)
      await page.goto('/table?new=1')
      await page.getByRole('button', { name: 'DEAL', exact: true }).tap()
      const menu = page.getByRole('button', { name: 'Table menu' })
      await menu.tap()
      const close = page.getByRole('button', { name: 'Close panel' })
      await expect(close).toBeFocused()
      expect(await page.locator('.phone-dock').evaluate((element) => element.inert)).toBe(true)
      await page.keyboard.press('Tab')
      await expect(page.getByRole('button', { name: 'Chat', exact: true })).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      await expect(close).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      await expect(page.getByRole('button', { name: 'Log in', exact: true })).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(close).toBeFocused()
      await page.getByRole('button', { name: 'Settings', exact: true }).focus()
      await page.keyboard.press('Space')
      await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
      await expect(page.locator('.phone-peek-display')).toHaveCount(0)
      await page.keyboard.press('Escape')
      await expect(menu).toBeFocused()
      expect(await page.locator('.phone-dock').evaluate((element) => element.inert)).toBe(false)
      await menu.tap()
      await page.getByRole('button', { name: /Hand history/ }).tap()
      await expect(
        page.getByRole('dialog', { name: 'Hand history' }).getByRole('button', {
          name: 'CLOSE',
          exact: true,
        }),
      ).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(menu).toBeFocused()
    })

    test('chat stays above an overlay keyboard without disabling text editing', async ({
      page,
    }) => {
      await page.addInitScript(() => {
        const viewport = new EventTarget()
        Object.assign(viewport, { height: 500, offsetTop: 0, scale: 1 })
        Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true })
      })
      await phoneFixture(page)
      await page.goto('/table?new=1')
      await page.getByRole('button', { name: 'Table menu' }).tap()
      await page.getByRole('button', { name: 'Chat', exact: true }).tap()
      const dialog = page.getByRole('dialog', { name: 'Table chat' })
      const input = dialog.getByRole('textbox', { name: 'Message the table' })
      await input.fill('Hello table')
      await input.selectText()
      await expect(input).toHaveValue('Hello table')
      expect(
        await input.evaluate((element) => {
          const text = element as HTMLInputElement
          return (text.selectionEnd ?? 0) - (text.selectionStart ?? 0)
        }),
      ).toBe(11)
      for (const control of [
        dialog,
        input,
        dialog.getByRole('button', { name: 'Send', exact: true }),
      ]) {
        const box = await control.boundingBox()
        if (box === null) throw new Error('Chat control is not visible')
        expect(box.y).toBeGreaterThanOrEqual(0)
        expect(box.y + box.height).toBeLessThanOrEqual(500)
      }
      await page.keyboard.press('Escape')
      await expect(page.getByRole('button', { name: 'Table menu' })).toBeFocused()
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

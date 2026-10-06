import { expect, type Page, test } from '@playwright/test'
import type { TurnAction } from '@river/engine'
import type { RoomView } from '@river/server'
import { installSoundProbe } from './sound-probe'

async function offlineTableFixture(page: Page) {
  const commands: string[] = []
  const id = '00000000-0000-4000-8000-000000000001'
  const heroSeat = 8
  const view: RoomView = {
    venueId: 'rooftop',
    handNumber: 0,
    phase: 'open',
    street: 'preflop',
    board: [],
    pot: 0,
    currentBet: 0,
    countdownMs: 0,
    seats: Array.from({ length: 9 }, (_, seat) => ({
      seat,
      playerId: seat === heroSeat ? null : `bot:control-${seat}`,
      name: seat === heroSeat ? null : `Player ${seat + 1}`,
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
    clientSeeds: null,
    revealedSeed: null,
    message: null,
    revealed: false,
    selfId: id,
    challenges: [],
    hostPlayerId: id,
    inviteCode: 'STYLE1',
  }
  const snapshot = (socket: { send: (message: string) => void }, requestId: string | null) =>
    socket.send(
      JSON.stringify({
        kind: 'snapshot',
        requestId,
        roomId: 'control-language',
        view,
        events: [],
        balance: 150000,
        botSeats: 0,
        ownedItems: [],
        ownedCosmetics: [],
      }),
    )
  await page.route('**/api/config', (route) =>
    route.fulfill({
      json: { supabaseUrl: 'https://river-auth.invalid', publishableKey: 'control-test' },
    }),
  )
  await page.route('https://river-auth.invalid/**', (route) =>
    route.fulfill({
      json: {
        access_token: 'control-fixture-token',
        refresh_token: 'control-fixture-refresh',
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
    }),
  )
  await page.routeWebSocket(
    (url) => url.pathname === '/ws',
    (socket) => {
      socket.onMessage((raw) => {
        const message = JSON.parse(String(raw))
        if (message.kind === 'authenticate')
          socket.send(JSON.stringify({ kind: 'authenticated', playerId: id, anonymous: true }))
        if (message.kind === 'enter') snapshot(socket, message.requestId)
        if (message.kind === 'command') {
          const command = message.command as { kind: string; action?: TurnAction }
          commands.push(command.kind)
          if (command.kind === 'sit') {
            const hero = view.seats[heroSeat]
            if (hero === undefined) throw new Error('Offline fixture has no hero seat')
            hero.playerId = id
            hero.name = 'Guest'
            hero.stack = 100000
          }
          if (command.kind === 'startHand') {
            view.handNumber += 1
            view.phase = 'hand'
            view.pot = 750
            view.currentBet = 500
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
              seat.dealer = seat.seat === 0
              seat.betStreet = seat.seat === 0 ? 250 : seat.seat === 1 ? 500 : 0
              seat.betHand = seat.betStreet
            }
            const hero = view.seats[heroSeat]
            if (hero === undefined) throw new Error('Offline fixture has no hero seat')
            hero.hole = [
              { rank: 'A', suit: 'spades' },
              { rank: 'K', suit: 'hearts' },
            ]
          }
          snapshot(socket, message.requestId)
        }
      })
    },
  )
  return { commands }
}

test.describe('the desktop control language baseline', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`card reveal and wheel feedback preserve control behaviour with ${reducedMotion}`, async ({
      page,
    }) => {
      const fixture = await offlineTableFixture(page)
      const sound = await installSoundProbe(page)
      await page.emulateMedia({ reducedMotion })
      await page.goto('/table?new=1')
      await page.getByRole('button', { name: 'DEAL', exact: true }).click()
      await expect.poll(sound.decoded).toBe(14)
      await page.keyboard.down('Space')
      const faces = page.locator('.hero-cards .playing-card')
      await expect(faces).toHaveCount(2)
      expect(
        await faces.first().evaluate((element) => getComputedStyle(element).animationName),
      ).toBe(reducedMotion === 'reduce' ? 'none' : 'hero-peek-reveal')
      await expect.poll(() => sound.count('card_peek')).toBe(1)
      await page.keyboard.up('Space')
      expect(await faces.count()).toBe(0)
      await expect(page.locator('.hero-cards .card-back')).toHaveCount(2)
      const wheel = page.locator('.action-menu')
      const wheelBox = await wheel.boundingBox()
      expect(wheelBox).toMatchObject({ width: 244, height: 244 })
      await page.keyboard.press('r')
      const arc = page.getByRole('slider', { name: 'Raise to' })
      await expect(arc).toBeVisible()
      const before = await arc.boundingBox()
      const knob = page.locator('.raise-knob')
      const knobBefore = await knob.boundingBox()
      expect(await sound.count('wheel_tick')).toBe(0)
      await arc.press('ArrowRight')
      await expect(arc).toHaveAttribute('aria-valuenow', '1500')
      await expect.poll(() => sound.count('wheel_tick')).toBe(1)
      const position = await knob.getAttribute('transform')
      await page.keyboard.press('ArrowLeft')
      await expect(arc).toHaveAttribute('aria-valuenow', '1000')
      await expect.poll(() => sound.count('wheel_tick')).toBe(2)
      expect(await knob.getAttribute('transform')).not.toBe(position)
      await page.keyboard.press('ArrowLeft')
      await expect(arc).toHaveAttribute('aria-valuenow', '1000')
      expect(await sound.count('wheel_tick')).toBe(2)
      expect(await arc.boundingBox()).toEqual(before)
      expect(await knob.boundingBox()).toMatchObject({
        width: knobBefore?.width,
        height: knobBefore?.height,
      })
      const well = page.locator('.raise-knob-well')
      await expect
        .poll(() => well.evaluate((element) => getComputedStyle(element).stroke))
        .toBe('rgba(255, 236, 196, 0.85)')
      expect(await well.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe(
        reducedMotion === 'reduce' ? '0s' : '0.12s',
      )
      expect(fixture.commands.filter((kind) => kind === 'act')).toEqual([])
      await page.keyboard.press('Escape')
      expect(await wheel.boundingBox()).toEqual(wheelBox)
      await page.keyboard.press('r')
      await expect(arc).toHaveAttribute('aria-valuenow', '1000')
      expect(await sound.count('wheel_tick')).toBe(2)
      await page.keyboard.press('Enter')
      await expect.poll(() => fixture.commands.filter((kind) => kind === 'act')).toHaveLength(1)
    })
  }

  test('keeps the wheel labels and interactions intact while recording style baselines', async ({
    page,
  }) => {
    const fixture = await offlineTableFixture(page)
    await page.goto('/table?new=1')
    const deal = page.getByRole('button', { name: 'DEAL', exact: true })
    await expect(deal).toBeVisible()
    await expect
      .poll(() =>
        deal.evaluate(async (element) => {
          await document.fonts.ready
          const style = getComputedStyle(element)
          return { fontFamily: style.fontFamily, fontSize: style.fontSize }
        }),
      )
      .toMatchObject({ fontFamily: expect.stringContaining('Barlow Condensed'), fontSize: '23px' })
    await deal.click()
    const menu = page.getByRole('region', { name: 'Your action' })
    await expect(menu).toBeVisible()
    await expect.poll(() => fixture.commands.filter((kind) => kind === 'startHand').length).toBe(1)
    expect(fixture.commands).toContain('sit')
    const menuLabels = await menu
      .locator('.action-button')
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')))
    expect(menuLabels).toEqual(['CALL 500', 'RAISE', 'Fold'])

    const backsAtRest = page.locator('.hero-cards .card-back')
    const faces = page.locator('.hero-cards .playing-card')
    await expect(backsAtRest).toHaveCount(2)
    await expect(faces).toHaveCount(0)
    const hand = page.locator('.hero-cards')
    const handBox = await hand.boundingBox()
    expect(handBox).not.toBeNull()
    if (handBox === null) throw new Error('Offline fixture has no hero cards')
    await page.mouse.move(handBox.x + handBox.width / 2, handBox.y + handBox.height / 2)
    await page.mouse.down()
    await expect(faces).toHaveCount(2)
    await expect(backsAtRest).toHaveCount(0)
    await page.mouse.up()
    await expect(faces).toHaveCount(0)
    await expect(backsAtRest).toHaveCount(2)

    const seatRing = page.locator('.seat-ring')
    await page.keyboard.down('Tab')
    await expect(seatRing).toHaveClass(/plates-held/)
    await page.keyboard.up('Tab')
    await expect(seatRing).not.toHaveClass(/plates-held/)

    const measureStyles = (styleSelectors: string[]) =>
      page.evaluate((selectorsToMeasure) => {
        const properties = [
          'backgroundImage',
          'backgroundColor',
          'color',
          'fontFamily',
          'fontSize',
          'width',
          'height',
          'borderRadius',
        ] as const
        return Object.fromEntries(
          selectorsToMeasure.map((selector) => [
            selector,
            [...document.querySelectorAll(selector)].map((element) => {
              const style = getComputedStyle(element)
              const box = element.getBoundingClientRect()
              return {
                label: element.getAttribute('aria-label'),
                text: (element.textContent ?? '').trim(),
                ...Object.fromEntries(properties.map((property) => [property, style[property]])),
                rectWidth: box.width,
                rectHeight: box.height,
              }
            }),
          ]),
        )
      }, styleSelectors)
    const actionStructure = await page.evaluate(() => ({
      slots: [...document.querySelectorAll('.action-menu .action-slot')].map((slot) =>
        [...slot.classList].filter(
          (name) => name === 'call' || name === 'raise' || name === 'fold',
        ),
      ),
      actionIcons: document.querySelectorAll('.action-menu .action-button > svg > path').length,
      seams: document.querySelectorAll('.action-base .action-seams').length,
    }))
    expect(actionStructure.slots).toEqual([['call'], ['raise'], ['fold']])
    expect(actionStructure.actionIcons).toBe(3)
    expect(actionStructure.seams).toBe(1)
    const menuSelectors = [
      '.action-menu',
      '.action-menu .action-base',
      '.action-menu .action-slot',
      '.action-menu .action-button',
    ]
    const menuStyles = await measureStyles(menuSelectors)
    await page.keyboard.press('r')
    const raiseLayer = page.locator('.raise-layer')
    await expect(raiseLayer).toBeVisible()
    const raiseSelectors = ['.raise-layer', '.raise-arc', '.raise-knob']
    const raiseStyles = await measureStyles(raiseSelectors)
    const styles = { ...menuStyles, ...raiseStyles }
    for (const selector of [...menuSelectors, ...raiseSelectors]) {
      const entries = styles[selector]
      expect(entries, selector).toBeDefined()
      expect(entries?.length, selector).toBeGreaterThan(0)
    }
    expect(styles['.action-menu .action-slot']).toHaveLength(3)
    expect(styles['.action-menu .action-button']).toHaveLength(3)
    expect(styles['.raise-layer']).toHaveLength(1)
    expect(styles['.raise-arc']).toHaveLength(1)
    expect(styles['.raise-knob']).toHaveLength(1)

    expect(styles['.action-menu']?.[0]).toMatchObject({
      backgroundImage: 'none',
      backgroundColor: 'rgba(0, 0, 0, 0)',
      color: 'rgb(242, 234, 223)',
      fontFamily: 'Inter, "Inter Fallback", "Segoe UI", system-ui, sans-serif',
      fontSize: '16px',
      width: '244px',
      height: '244px',
      borderRadius: '0px',
      rectWidth: 244,
      rectHeight: 244,
    })
    expect(styles['.action-menu .action-base']?.[0]).toMatchObject({
      backgroundColor: 'rgba(0, 0, 0, 0)',
      fontFamily: 'Inter, "Inter Fallback", "Segoe UI", system-ui, sans-serif',
      fontSize: '16px',
      width: '216px',
      height: '216px',
      borderRadius: '50%',
      rectWidth: 216,
      rectHeight: 216,
    })
    expect(styles['.action-menu .action-base']?.[0]?.backgroundImage).toContain(
      'data:image/svg+xml',
    )
    expect(styles['.action-menu .action-base']?.[0]?.backgroundImage).toContain('radial-gradient')
    expect(styles['.action-menu .action-base']?.[0]?.backgroundImage).toContain('conic-gradient')
    expect(styles['.action-menu .action-slot']?.map((slot) => [slot.width, slot.height])).toEqual(
      [0, 1, 2].map(() => ['66px', '66px']),
    )
    expect(
      styles['.action-menu .action-button']?.map((button) => [
        button.label,
        button.backgroundImage,
        button.color,
        button.fontFamily,
        button.fontSize,
        button.width,
        button.height,
        button.borderRadius,
        button.rectWidth,
        button.rectHeight,
      ]),
    ).toEqual([
      [
        'CALL 500',
        expect.stringContaining('radial-gradient'),
        'rgb(98, 166, 242)',
        'Inter, "Inter Fallback", "Segoe UI", system-ui, sans-serif',
        '16px',
        '66px',
        '66px',
        '50%',
        66,
        66,
      ],
      [
        'RAISE',
        expect.stringContaining('radial-gradient'),
        'rgb(99, 209, 138)',
        'Inter, "Inter Fallback", "Segoe UI", system-ui, sans-serif',
        '16px',
        '66px',
        '66px',
        '50%',
        66,
        66,
      ],
      [
        'Fold',
        expect.stringContaining('radial-gradient'),
        'rgb(230, 125, 99)',
        'Inter, "Inter Fallback", "Segoe UI", system-ui, sans-serif',
        '16px',
        '66px',
        '66px',
        '50%',
        66,
        66,
      ],
    ])
    expect(styles['.raise-layer']?.[0]).toMatchObject({
      backgroundImage: 'none',
      backgroundColor: 'rgba(0, 0, 0, 0)',
      color: 'rgb(242, 234, 223)',
      fontFamily: 'Inter, "Inter Fallback", "Segoe UI", system-ui, sans-serif',
      fontSize: '16px',
      width: '380px',
      height: '299px',
      borderRadius: '0px',
      rectWidth: 380,
      rectHeight: 299,
    })
    expect(styles['.raise-arc']?.[0]).toMatchObject({
      backgroundImage: 'none',
      backgroundColor: 'rgba(0, 0, 0, 0)',
      color: 'rgb(242, 234, 223)',
      fontFamily: 'Inter, "Inter Fallback", "Segoe UI", system-ui, sans-serif',
      fontSize: '16px',
      width: '300px',
      height: '158px',
      borderRadius: '0px',
      rectWidth: 300,
      rectHeight: 158,
    })
    expect(styles['.raise-knob']?.[0]).toMatchObject({
      backgroundImage: 'none',
      backgroundColor: 'rgba(0, 0, 0, 0)',
      color: 'rgb(242, 234, 223)',
      fontFamily: 'Inter, "Inter Fallback", "Segoe UI", system-ui, sans-serif',
      fontSize: '16px',
      width: 'auto',
      height: 'auto',
      borderRadius: '0px',
      rectWidth: 30,
      rectHeight: 30,
    })

    const raiseStructure = await page.evaluate(() => ({
      raisePaths: ['raise-rim', 'raise-track', 'raise-fill'].map(
        (name) => document.querySelectorAll(`.raise-arc .${name}`).length,
      ),
      knobCircles: document.querySelectorAll('.raise-knob circle').length,
    }))
    expect(raiseStructure.raisePaths).toEqual([1, 1, 1])
    expect(raiseStructure.knobCircles).toBe(2)
    await page.keyboard.press('Escape')
    const tableMenu = page.getByRole('navigation', { name: 'Table menu' })
    await tableMenu.getByRole('button', { name: 'SETTINGS', exact: true }).click()
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await expect(settings).toBeVisible()
    const heading = settings.locator('h2')
    await expect
      .poll(() =>
        heading.evaluate(async (element) => {
          await document.fonts.ready
          const style = getComputedStyle(element)
          return { fontFamily: style.fontFamily, fontSize: style.fontSize }
        }),
      )
      .toMatchObject({ fontFamily: expect.stringContaining('Barlow Condensed'), fontSize: '32px' })
  })
})

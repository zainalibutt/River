import { expect, test } from '@playwright/test'

/**
 * The private record page against a faked server and database: the scorecard, the hands
 * against Nell, the recent sittings and the replay, with no account or database touched.
 */

const PLAYER = '00000000-0000-4000-8000-0000000000e1'

function hand(handNumber: number, net: number, opponents: string[], playedAt: string) {
  return {
    hand_id: `room:${handNumber}:c${handNumber}`,
    played_at: playedAt,
    room_kind: 'bots',
    big_blind: 500,
    net_chips: net,
    showed: net > 0,
    own_hole: [
      { rank: 'A', suit: 's' },
      { rank: 'K', suit: 'd' },
    ],
    opponents,
    record: {
      handNumber,
      startedAtMs: Date.parse(playedAt),
      stake: { smallBlind: 250, bigBlind: 500 },
      seats: [
        { seat: 0, playerId: PLAYER, startingStack: 100_000 },
        { seat: 1, playerId: 'bot:nell', startingStack: 100_000 },
      ],
      actions: [],
      board: [],
      potSize: Math.abs(net) * 2,
      results: [
        { seat: 0, delta: net, showed: net > 0 },
        { seat: 1, delta: -net, showed: false },
      ],
      commit: `c${handNumber}`,
      revealedSeed: null,
    },
  }
}

test('shows a player their own record and replays their hands', async ({ page }) => {
  await page.route('**/api/config', (route) =>
    route.fulfill({
      json: { supabaseUrl: 'https://river-auth.invalid', publishableKey: 'record-test' },
    }),
  )
  await page.route('https://river-auth.invalid/**', (route) =>
    route.fulfill({
      json: {
        access_token: 'record-fixture-token',
        refresh_token: 'record-fixture-refresh',
        expires_in: 3600,
        token_type: 'bearer',
        user: {
          id: PLAYER,
          aud: 'authenticated',
          role: 'authenticated',
          is_anonymous: true,
          app_metadata: {},
          user_metadata: {},
          created_at: '2026-10-01T00:00:00Z',
        },
      },
    }),
  )
  await page.route('https://river-auth.invalid/rest/v1/player_hands**', (route) =>
    route.fulfill({
      json: [
        hand(3, 1_500, ['Nell'], '2026-10-09T18:10:00Z'),
        hand(2, -500, ['Nell'], '2026-10-09T18:05:00Z'),
        hand(1, 2_000, ['Jules'], '2026-10-08T12:00:00Z'),
      ],
    }),
  )
  await page.goto('/record')
  const folio = page.getByRole('region', { name: 'Your record' })
  await expect(folio).toContainText('Your record')
  await expect(folio).toContainText('+6 bb')
  await expect(folio).toContainText('A short record: over 3 hands')
  await expect(folio).toContainText('Against Nell')
  await expect(folio).toContainText('+2 bb')
  await expect(folio.locator('.record-sittings li')).toHaveCount(2)
  await page.screenshot({ path: 'test-results/player-record.png' })
  await page.getByRole('button', { name: 'Replay your last hands' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
})

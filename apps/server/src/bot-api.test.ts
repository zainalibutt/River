import { describe, expect, it } from 'vitest'
import { BotApi, type BotApiHandView, type BotApiMatchView, handleBotApi } from './bot-api.js'
import { pokerGuardPolicy } from './bot-poker-guard.js'
import { slumbotMoves } from './bot-slumbot.js'

/** An API with a cheap bot, fixed hand ids and a clock the test moves. */
function testApi(options: { dailyHands?: number; handTtlMs?: number } = {}) {
  let clock = 1_000_000
  let ids = 0
  const api = new BotApi({
    ...options,
    now: () => clock,
    newId: () => {
      ids += 1
      return `h${ids}`
    },
    policies: { nyx: pokerGuardPolicy },
  })
  return {
    api,
    tick: (ms: number) => {
      clock += ms
    },
  }
}

function hand(result: ReturnType<BotApi['newHand']>): BotApiHandView {
  if (!result.ok) throw new Error(result.error)
  return result.hand
}

/** Plays the client by calling or checking until the hand ends. */
function playOut(api: BotApi, key: string, start: BotApiHandView): BotApiHandView {
  let view = start
  for (let step = 0; view.winnings === undefined; step += 1) {
    if (step > 40) throw new Error(`hand did not end: ${view.action}`)
    const facing = /b\d+$/.test(view.action.split('/').at(-1) ?? '')
    const preflopBlind = view.action === '' && view.client_pos === 1
    view = hand(api.act(key, view.hand_id, facing || preflopBlind ? 'c' : 'k', view.seq))
  }
  return view
}

describe('the bot API', () => {
  it('deals two hole cards and no board, and alternates the client between button and big blind', () => {
    const { api } = testApi()
    const first = hand(api.newHand('k1', 'nyx'))
    expect(first.hole_cards).toHaveLength(2)
    expect(first.board).toEqual([])
    expect(first.client_pos).toBe(1)
    expect(first.action).toBe('')
    const second = hand(api.newHand('k1', 'nyx'))
    expect(second.client_pos).toBe(0)
    // On the big blind the bot opens first, so the client meets its move.
    expect(second.action).not.toBe('')
    expect(second.seq).toBe(slumbotMoves(second.action).length)
  })

  it('plays hands to the end, scoring them zero-sum against the stacks', () => {
    const { api } = testApi()
    let total = 0
    for (let index = 0; index < 20; index += 1) {
      const done = playOut(api, 'k1', hand(api.newHand('k1', 'nyx')))
      expect(Math.abs(done.winnings ?? 0)).toBeLessThanOrEqual(20_000)
      expect(done.board.length === 5 || done.action.endsWith('f')).toBe(true)
      total += done.winnings ?? 0
    }
    expect(Number.isFinite(total)).toBe(true)
  })

  it('writes the streets the way Slumbot does, and shows the board for each', () => {
    const { api } = testApi()
    const done = playOut(api, 'k1', hand(api.newHand('k1', 'nyx')))
    const streets = done.action.split('/').length - 1
    expect(done.board).toHaveLength([0, 3, 4, 5][streets] ?? -1)
    if (!done.action.endsWith('f')) expect(done.bot_hole_cards).toHaveLength(2)
  })

  it('runs out the board after an all-in call, written with every street closed', () => {
    const { api } = testApi()
    // Client on the button shoves; whatever the bot does, the action is read back consistently.
    const start = hand(api.newHand('k1', 'nyx'))
    const shove = hand(api.act('k1', start.hand_id, 'b20000', start.seq))
    expect(shove.winnings).toBeDefined()
    if (shove.action.endsWith('f')) {
      expect(shove.action).toBe('b20000f')
      expect(shove.winnings).toBe(100)
    } else {
      expect(shove.action).toBe('b20000c///')
      expect(shove.board).toHaveLength(5)
      expect(shove.bot_hole_cards).toHaveLength(2)
      expect(Math.abs(shove.winnings ?? 0)).toBe(20_000)
    }
  })

  it('returns the same state when a move is resent with the seq it came with', () => {
    const { api } = testApi()
    const start = hand(api.newHand('k1', 'nyx'))
    const once = hand(api.act('k1', start.hand_id, 'c', start.seq))
    const again = hand(api.act('k1', start.hand_id, 'c', start.seq))
    expect(again).toEqual(once)
  })

  it('refuses a stale seq, an illegal move, two moves at once, and another key', () => {
    const { api } = testApi()
    const start = hand(api.newHand('k1', 'nyx'))
    expect(api.act('k1', start.hand_id, 'c', start.seq + 1)).toMatchObject({
      ok: false,
      status: 409,
    })
    expect(api.act('k1', start.hand_id, 'b150', start.seq)).toMatchObject({
      ok: false,
      status: 400,
    })
    expect(api.act('k1', start.hand_id, 'cc', start.seq)).toMatchObject({ ok: false, status: 400 })
    expect(api.act('k1', start.hand_id, 'x', start.seq)).toMatchObject({ ok: false, status: 400 })
    expect(api.act('k2', start.hand_id, 'c', start.seq)).toMatchObject({ ok: false, status: 404 })
    // None of those moved the hand.
    expect(hand(api.act('k1', start.hand_id, 'c', start.seq)).seq).toBeGreaterThan(start.seq)
  })

  it('folds a hand left too long, and the next deal folds an open one', () => {
    const { api, tick } = testApi({ handTtlMs: 1_000 })
    const start = hand(api.newHand('k1', 'nyx'))
    tick(2_000)
    expect(api.act('k1', start.hand_id, 'c', start.seq)).toMatchObject({ ok: false, status: 410 })
    expect(api.act('k1', start.hand_id, 'c', start.seq)).toMatchObject({ ok: false, status: 409 })
    const open = hand(api.newHand('k1', 'nyx'))
    hand(api.newHand('k1', 'nyx'))
    expect(api.act('k1', open.hand_id, 'c', open.seq)).toMatchObject({ ok: false, status: 409 })
  })

  it('stops a key at its daily limit and lets it play again the next day', () => {
    const { api, tick } = testApi({ dailyHands: 2 })
    hand(api.newHand('k1', 'nyx'))
    hand(api.newHand('k1', 'nyx'))
    expect(api.newHand('k1', 'nyx')).toMatchObject({ ok: false, status: 429 })
    expect(api.newHand('k2', 'nyx').ok).toBe(true)
    tick(86_400_000)
    expect(api.newHand('k1', 'nyx').ok).toBe(true)
  })
})

describe('the HTTP calls', () => {
  const keys = (token: string) => (token === 'good' ? 'k1' : null)

  it('needs a key and POST, and routes the two calls', () => {
    const { api } = testApi()
    const call = (path: string, body: unknown, authorization?: string, method = 'POST') =>
      handleBotApi(api, { method, path, authorization, body }, keys)
    expect(call('/v1/hands', {}).status).toBe(401)
    expect(call('/v1/hands', {}, 'Bearer bad').status).toBe(401)
    expect(call('/v1/hands', {}, 'Bearer good', 'GET').status).toBe(405)
    expect(call('/v1/hands', { opponent: 'slumbot' }, 'Bearer good').status).toBe(400)
    expect(call('/v1/nope', {}, 'Bearer good').status).toBe(404)
    const dealt = call('/v1/hands', { opponent: 'nyx' }, 'Bearer good')
    expect(dealt.status).toBe(200)
    const view = dealt.body as BotApiHandView
    expect(call(`/v1/hands/${view.hand_id}/act`, { incr: 'c' }, 'Bearer good').status).toBe(400)
    expect(
      call(`/v1/hands/${view.hand_id}/act`, { incr: 'c', seq: view.seq }, 'Bearer good').status,
    ).toBe(200)
  })
})

describe('duplicate matches', () => {
  function match(result: ReturnType<BotApi['newMatch']>): BotApiMatchView {
    if (!result.ok) throw new Error(result.error)
    return result.match
  }

  it('deals each deal twice with the seats swapped and the same board', () => {
    const { api } = testApi()
    const opened = match(api.newMatch('k1', 'nyx', 2))
    const first = hand(api.newHand('k1', 'nyx', opened.match_id))
    const firstDone = playOut(api, 'k1', first)
    const second = hand(api.newHand('k1', 'nyx', opened.match_id))
    expect(first.client_pos).toBe(1)
    expect(second.client_pos).toBe(0)
    const secondDone = playOut(api, 'k1', second)
    // The client holds in the second hand what the bot held in the first, when shown.
    if (firstDone.bot_hole_cards !== undefined) {
      expect(second.hole_cards).toEqual(firstDone.bot_hole_cards)
    }
    if (firstDone.board.length === 5 && secondDone.board.length === 5) {
      expect(secondDone.board).toEqual(firstDone.board)
    }
  })

  it('scores a deal once both its hands are over, as half their sum', () => {
    const { api } = testApi()
    const opened = match(api.newMatch('k1', 'nyx', 3))
    expect(opened).toMatchObject({ deals: 3, hands_dealt: 0, deals_scored: 0, bb_per_100: null })
    const results: number[] = []
    for (let index = 0; index < 6; index += 1) {
      const done = playOut(api, 'k1', hand(api.newHand('k1', 'nyx', opened.match_id)))
      results.push(done.winnings ?? 0)
      const now = match(api.match('k1', opened.match_id))
      expect(now.hands_dealt).toBe(index + 1)
      expect(now.deals_scored).toBe(Math.floor((index + 1) / 2))
    }
    const scores = [0, 1, 2].map(
      (deal) => ((results[2 * deal] ?? 0) + (results[2 * deal + 1] ?? 0)) / 2,
    )
    const final = match(api.match('k1', opened.match_id))
    expect(final.bb_per_100).toBeCloseTo(scores.reduce((sum, x) => sum + x, 0) / 3, 9)
    expect(final.interval).not.toBeNull()
    expect(api.newHand('k1', 'nyx', opened.match_id)).toMatchObject({ ok: false, status: 409 })
  })

  it('keeps a match to its own key and refuses impossible sizes', () => {
    const { api } = testApi()
    const opened = match(api.newMatch('k1', 'nyx', 1))
    expect(api.match('k2', opened.match_id)).toMatchObject({ ok: false, status: 404 })
    expect(api.newHand('k2', 'nyx', opened.match_id)).toMatchObject({ ok: false, status: 404 })
    expect(api.newMatch('k1', 'nyx', 0)).toMatchObject({ ok: false, status: 400 })
    expect(api.newMatch('k1', 'nyx', 1.5)).toMatchObject({ ok: false, status: 400 })
    expect(api.newMatch('k1', 'nyx', 10_001)).toMatchObject({ ok: false, status: 400 })
  })

  it('opens, deals and reads matches over HTTP', () => {
    const { api } = testApi()
    const keys = (token: string) => (token === 'good' ? 'k1' : null)
    const call = (path: string, body: unknown) =>
      handleBotApi(api, { method: 'POST', path, authorization: 'Bearer good', body }, keys)
    expect(call('/v1/matches', {}).status).toBe(400)
    const opened = call('/v1/matches', { deals: 1 })
    expect(opened.status).toBe(200)
    const id = (opened.body as BotApiMatchView).match_id
    expect(call('/v1/hands', { match_id: 7 }).status).toBe(400)
    expect(call('/v1/hands', { match_id: id }).status).toBe(200)
    expect(call(`/v1/matches/${id}`, {}).body).toMatchObject({ hands_dealt: 1 })
    expect(call('/v1/matches/nope', {}).status).toBe(404)
  })
})

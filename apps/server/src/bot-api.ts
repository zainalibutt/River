import {
  type BotPersonality,
  type BotPolicy,
  type Card,
  cardToString,
  championPersonality,
  makeDeck,
  mulberry32,
  type Street,
  seedFromString,
  shuffle,
  type TurnAction,
} from '@river/engine'
import { pokerGuardPolicy } from './bot-poker-guard.js'
import { RIVER_CANDIDATE_TUNING, riverSolverPolicy } from './bot-river-policy.js'
import { botPlayerId } from './bot-service.js'
import {
  type SlumbotMemory,
  slumbotIncrement,
  slumbotMemory,
  slumbotMoves,
  slumbotRoom,
} from './bot-slumbot.js'
import type { Room } from './room.js'

// A public heads-up API for River's bots, shaped like Slumbot's so a Slumbot
// client plays it by changing one URL: 50/100 blinds, 20,000-chip stacks that
// reset every hand, and the same action strings ('k' check, 'c' call, 'f' fold,
// 'bN' a bet to N chips on the street, '/' between streets). The server deals
// and holds both hands; the client sees its own cards, the board so far and
// the action, and the bot's cards only at a showdown.
//
// Unlike Slumbot, a move can be sent again safely. Every response carries seq,
// the number of moves in the action so far; the client sends back the seq it
// saw with its move. Sending the same move with the same seq again (after a
// timeout, say) returns the hand as it now stands instead of refusing it, so a
// lost response never costs the hand.

/** The bots the API serves. Only Nyx so far; Midas joins once its live table has proven the path. */
export const BOT_API_OPPONENTS = ['nyx'] as const
export type BotApiOpponent = (typeof BOT_API_OPPONENTS)[number]

export interface BotApiOptions {
  /** Hands a key may start in a day. */
  readonly dailyHands?: number
  /** A hand left this long without a move is folded for the client. */
  readonly handTtlMs?: number
  readonly now?: () => number
  /** A fresh id for each hand; random in production, fixed in tests. */
  readonly newId?: () => string
  /** Each opponent's policy, built once; tests pass cheap ones. */
  readonly policies?: Partial<Record<BotApiOpponent, BotPolicy>>
}

/** What the client sees of a hand, in Slumbot's field names. */
export interface BotApiHandView {
  readonly hand_id: string
  readonly opponent: BotApiOpponent
  /** 1 when the client is the small blind, on the button; 0 when it is the big blind. */
  readonly client_pos: 0 | 1
  readonly hole_cards: readonly string[]
  readonly board: readonly string[]
  readonly action: string
  readonly seq: number
  /** The client's chips won or lost, once the hand is over. */
  readonly winnings?: number
  readonly bot_hole_cards?: readonly string[]
}

/** A duplicate match: every deal is played twice, the client taking each seat once. */
export interface BotApiMatchView {
  readonly match_id: string
  readonly opponent: BotApiOpponent
  readonly deals: number
  /** Hands dealt so far, of 2 x deals. */
  readonly hands_dealt: number
  /** Deals whose two hands are both over. */
  readonly deals_scored: number
  /**
   * The client's result in big blinds a hundred hands, over scored deals: each
   * deal scores half the client's winnings from its two hands, so the cards'
   * luck cancels. The interval is 95%, from the spread between deals.
   */
  readonly bb_per_100: number | null
  readonly interval: readonly [number, number] | null
}

export type BotApiMatchResult =
  | { readonly ok: true; readonly match: BotApiMatchView }
  | { readonly ok: false; readonly status: 400 | 404; readonly error: string }

export type BotApiResult =
  | { readonly ok: true; readonly hand: BotApiHandView }
  | {
      readonly ok: false
      readonly status: 400 | 404 | 409 | 410 | 429
      readonly error: string
    }

interface Hand {
  readonly id: string
  readonly key: string
  readonly opponent: BotApiOpponent
  readonly clientPos: 0 | 1
  readonly clientHole: readonly Card[]
  readonly botHole: readonly Card[]
  readonly board: readonly Card[]
  action: string
  updatedAtMs: number
  /** The client's last accepted move and the seq it was sent with, for a safe resend. */
  last: { readonly seq: number; readonly incr: string } | null
  over: boolean
  /** The client's chips won or lost, set when the hand ends. */
  winnings?: number
  /** The match this hand belongs to, and its place in the match's order. */
  readonly match?: { readonly id: string; readonly index: number }
}

interface Match {
  readonly id: string
  readonly key: string
  readonly opponent: BotApiOpponent
  readonly deals: number
  next: number
  /** The client's winnings by hand index, filled in as hands end. */
  readonly results: (number | undefined)[]
}

interface KeyState {
  day: number
  handsToday: number
  dealt: number
  open: Hand | null
  readonly memory: Partial<Record<BotApiOpponent, SlumbotMemory>>
}

const DAY_MS = 86_400_000
const STREETS: readonly Street[] = ['preflop', 'flop', 'turn', 'river']
const BOARD_SHOWN = [0, 3, 4, 5] as const
const CLIENT = botPlayerId('api-client')
const LIMITS = { dailyHands: 10_000, handTtlMs: 5 * 60_000 }
/** The most deals a match may ask for. */
export const BOT_API_MAX_DEALS = 10_000

/** Nyx, as River's tables play it: the river solver over the poker guard, with reads. */
export function nyxPolicy(): BotPolicy {
  return riverSolverPolicy(pokerGuardPolicy, 'river-solver', 1, RIVER_CANDIDATE_TUNING).policy
}

export function isBotApiOpponent(value: unknown): value is BotApiOpponent {
  return typeof value === 'string' && (BOT_API_OPPONENTS as readonly string[]).includes(value)
}

export class BotApi {
  private readonly hands = new Map<string, Hand>()
  private readonly matches = new Map<string, Match>()
  private readonly keys = new Map<string, KeyState>()
  private readonly dailyHands: number
  private readonly handTtlMs: number
  private readonly now: () => number
  private readonly newId: () => string
  private readonly policies: Partial<Record<BotApiOpponent, BotPolicy>>
  private readonly personality: BotPersonality = championPersonality()

  constructor(options: BotApiOptions = {}) {
    this.dailyHands = options.dailyHands ?? LIMITS.dailyHands
    this.handTtlMs = options.handTtlMs ?? LIMITS.handTtlMs
    this.now = options.now ?? Date.now
    this.newId = options.newId ?? (() => crypto.randomUUID())
    this.policies = { ...options.policies }
  }

  /** Opens a duplicate match of the given number of deals; its hands are dealt by `newHand`. */
  newMatch(key: string, opponent: BotApiOpponent, deals: number): BotApiMatchResult {
    if (!Number.isSafeInteger(deals) || deals < 1 || deals > BOT_API_MAX_DEALS) {
      return { ok: false, status: 400, error: `deals must be 1 to ${BOT_API_MAX_DEALS}` }
    }
    const match: Match = {
      id: this.newId(),
      key,
      opponent,
      deals,
      next: 0,
      results: Array.from({ length: 2 * deals }, () => undefined),
    }
    this.matches.set(match.id, match)
    return { ok: true, match: matchView(match) }
  }

  /** A match as it stands: hands dealt, deals scored, and the score so far. */
  match(key: string, matchId: string): BotApiMatchResult {
    const match = this.matches.get(matchId)
    if (match === undefined || match.key !== key) {
      return { ok: false, status: 404, error: 'no such match' }
    }
    return { ok: true, match: matchView(match) }
  }

  /**
   * Deals a new hand for the key: the next hand of a match when one is named,
   * otherwise a fresh deal. A hand the key left open is folded first, as
   * Slumbot does. If the bot is on the button it moves before the client sees
   * the hand.
   */
  newHand(key: string, opponent: BotApiOpponent, matchId?: string): BotApiResult {
    const match = matchId === undefined ? undefined : this.matches.get(matchId)
    if (matchId !== undefined && (match === undefined || match.key !== key)) {
      return { ok: false, status: 404, error: 'no such match' }
    }
    if (match !== undefined && match.next >= 2 * match.deals) {
      return { ok: false, status: 409, error: 'every hand of the match has been dealt' }
    }
    const state = this.keyState(key)
    if (state.handsToday >= this.dailyHands) {
      return { ok: false, status: 429, error: 'daily hand limit reached' }
    }
    if (state.open !== null) this.foldForClient(state.open)
    state.handsToday += 1
    const id = this.newId()
    // A match deals the same cards twice: the client takes the button with
    // them first, then the big blind.
    const index = match?.next ?? 0
    const seed =
      match === undefined
        ? `bot-api:${key}:${id}`
        : `bot-api:match:${match.id}:${Math.floor(index / 2)}`
    const deck = shuffle(makeDeck(), mulberry32(seedFromString(seed)))
    const clientPos: 0 | 1 =
      match === undefined ? (state.dealt % 2 === 0 ? 1 : 0) : index % 2 === 0 ? 1 : 0
    const button = deck.slice(0, 2)
    const bigBlind = deck.slice(2, 4)
    const hand: Hand = {
      id,
      key,
      opponent: match?.opponent ?? opponent,
      clientPos,
      clientHole: clientPos === 1 ? button : bigBlind,
      botHole: clientPos === 1 ? bigBlind : button,
      board: deck.slice(4, 9),
      action: '',
      updatedAtMs: this.now(),
      last: null,
      over: false,
      ...(match === undefined ? {} : { match: { id: match.id, index } }),
    }
    if (match !== undefined) match.next += 1
    state.dealt += 1
    state.open = hand
    this.hands.set(id, hand)
    this.playBot(hand)
    return { ok: true, hand: this.view(hand) }
  }

  /** Applies the client's move, sent with the seq it saw, then the bot's replies. */
  act(key: string, handId: string, incr: string, seq: number): BotApiResult {
    const hand = this.hands.get(handId)
    if (hand === undefined || hand.key !== key)
      return { ok: false, status: 404, error: 'no such hand' }
    const current = moveCount(hand.action)
    // The same move resent with the seq it first came with: the hand as it stands.
    if (hand.last !== null && hand.last.seq === seq && hand.last.incr === incr) {
      return { ok: true, hand: this.view(hand) }
    }
    if (hand.over) return { ok: false, status: 409, error: 'hand is over' }
    if (this.now() - hand.updatedAtMs > this.handTtlMs) {
      this.foldForClient(hand)
      return { ok: false, status: 410, error: 'hand expired and was folded' }
    }
    if (seq !== current) {
      return { ok: false, status: 409, error: `stale seq ${seq}; the hand is at ${current}` }
    }
    let moves: ReturnType<typeof slumbotMoves>
    try {
      moves = slumbotMoves(incr)
    } catch {
      return { ok: false, status: 400, error: `unreadable move ${JSON.stringify(incr)}` }
    }
    if (moves.length !== 1 || incr.includes('/')) {
      return { ok: false, status: 400, error: 'send exactly one move' }
    }
    const move = moves[0]
    if (move === undefined || !this.apply(hand, CLIENT, move.action, incr)) {
      return { ok: false, status: 400, error: `illegal move ${incr} after ${hand.action}` }
    }
    hand.last = { seq, incr }
    hand.updatedAtMs = this.now()
    this.playBot(hand)
    return { ok: true, hand: this.view(hand) }
  }

  /** Folds every hand left open longer than the time limit. */
  expire(): number {
    let folded = 0
    for (const hand of this.hands.values()) {
      if (!hand.over && this.now() - hand.updatedAtMs > this.handTtlMs) {
        this.foldForClient(hand)
        folded += 1
      }
    }
    return folded
  }

  private keyState(key: string): KeyState {
    const day = Math.floor(this.now() / DAY_MS)
    let state = this.keys.get(key)
    if (state === undefined) {
      state = { day, handsToday: 0, dealt: 0, open: null, memory: {} }
      this.keys.set(key, state)
    }
    if (state.day !== day) {
      state.day = day
      state.handsToday = 0
    }
    return state
  }

  private policy(opponent: BotApiOpponent): BotPolicy {
    let policy = this.policies[opponent]
    if (policy === undefined) {
      policy = nyxPolicy()
      this.policies[opponent] = policy
    }
    return policy
  }

  private memory(hand: Hand): SlumbotMemory {
    const state = this.keyState(hand.key)
    let memory = state.memory[hand.opponent]
    if (memory === undefined) {
      memory = slumbotMemory()
      state.memory[hand.opponent] = memory
    }
    return memory
  }

  /** The hand as the server knows it: every card real, both seats played out so far. */
  private room(hand: Hand): Room {
    return slumbotRoom(
      {
        action: hand.action,
        clientPos: hand.clientPos,
        hole: hand.clientHole,
        theirHole: hand.botHole,
        board: hand.board,
      },
      { ours: CLIENT, theirs: this.botId(hand) },
    )
  }

  private botId(hand: Hand): string {
    return botPlayerId(this.personalityFor(hand).id)
  }

  private personalityFor(_hand: Hand): BotPersonality {
    return this.personality
  }

  /**
   * Plays one move for the given player if it is theirs to make and the table
   * takes it, and writes it into the action string with a '/' for every street
   * it closes. A hand that ends all in runs the rest of the board out, written
   * as Slumbot writes it: 'b20000c///'.
   */
  private apply(hand: Hand, playerId: string, action: TurnAction, text: string): boolean {
    const room = this.room(hand)
    const before = room.viewFor('')
    if (before.currentActor?.playerId !== playerId) return false
    const seat = before.seats.find((entry) => entry.playerId === playerId)
    const allIn =
      action.kind === 'raiseTo' && seat !== undefined && action.to >= seat.stack + seat.betStreet
    if (!room.submit({ kind: 'act', playerId, action: allIn ? { kind: 'allIn' } : action }).ok) {
      return false
    }
    const from = streetNumber(before.street)
    const settled = room.recentHands(1)[0]
    if (settled !== undefined) {
      hand.over = true
      const folded = action.kind === 'fold'
      hand.action += text + (folded ? '' : '/'.repeat(Math.max(0, 3 - from)))
      const clientSeat = before.seats.find((entry) => entry.playerId === CLIENT)?.seat
      hand.winnings = settled.results.find((result) => result.seat === clientSeat)?.delta ?? 0
      const match = hand.match === undefined ? undefined : this.matches.get(hand.match.id)
      if (match !== undefined && hand.match !== undefined) {
        match.results[hand.match.index] = hand.winnings
      }
      this.remember(hand)
      return true
    }
    const to = streetNumber(room.viewFor('').street)
    hand.action += text + '/'.repeat(Math.max(0, to - from))
    return true
  }

  /** The bot moves for as long as it is the bot's turn. */
  private playBot(hand: Hand): void {
    const botId = this.botId(hand)
    const policy = this.policy(hand.opponent)
    const memory = this.memory(hand)
    for (let step = 0; !hand.over && step < 64; step += 1) {
      const view = this.room(hand).viewFor('')
      if (view.currentActor?.playerId !== botId) return
      const rng = mulberry32(seedFromString(`bot-api:${hand.id}:${hand.action}`))
      const incr = slumbotIncrement(
        {
          action: hand.action,
          clientPos: hand.clientPos === 1 ? 0 : 1,
          hole: hand.botHole,
          board: hand.board.slice(0, BOARD_SHOWN[slashes(hand.action)]),
        },
        policy,
        this.personalityFor(hand),
        rng,
        memory.options(),
      )
      const move = slumbotMoves(incr)[0]
      if (move === undefined || !this.apply(hand, botId, move.action, incr)) {
        throw new Error(`the bot's move ${incr} was refused after ${hand.action}`)
      }
    }
  }

  private foldForClient(hand: Hand): void {
    if (hand.over) return
    const view = this.room(hand).viewFor('')
    if (view.currentActor?.playerId === CLIENT) {
      const text = view.legal?.check.enabled === true ? 'k' : 'f'
      // A free check is not a fold; keep checking until the hand ends or a bet is faced.
      if (text === 'k') {
        this.apply(hand, CLIENT, { kind: 'check' }, 'k')
        this.playBot(hand)
        this.foldForClient(hand)
        return
      }
      this.apply(hand, CLIENT, { kind: 'fold' }, 'f')
    }
    hand.over = true
    const state = this.keys.get(hand.key)
    if (state?.open === hand) state.open = null
  }

  /** The bot learns from the finished hand, as a table remembers an opponent. */
  private remember(hand: Hand): void {
    const state = this.keys.get(hand.key)
    if (state?.open === hand) state.open = null
    const showdown = !hand.action.endsWith('f')
    this.memory(hand).observe(
      {
        action: hand.action,
        clientPos: hand.clientPos === 1 ? 0 : 1,
        hole: hand.botHole,
        board: hand.board.slice(0, BOARD_SHOWN[slashes(hand.action)]),
        ...(showdown ? { theirHole: hand.clientHole } : {}),
      },
      this.botId(hand),
      state?.dealt ?? 0,
    )
  }

  private view(hand: Hand): BotApiHandView {
    const shown = BOARD_SHOWN[slashes(hand.action)]
    const base = {
      hand_id: hand.id,
      opponent: hand.opponent,
      client_pos: hand.clientPos,
      hole_cards: hand.clientHole.map(cardToString),
      board: hand.board.slice(0, shown).map(cardToString),
      action: hand.action,
      seq: moveCount(hand.action),
    }
    if (!hand.over) return base
    const showdown = !hand.action.endsWith('f')
    return {
      ...base,
      winnings: hand.winnings ?? 0,
      ...(showdown ? { bot_hole_cards: hand.botHole.map(cardToString) } : {}),
    }
  }
}

function matchView(match: Match): BotApiMatchView {
  const scores: number[] = []
  for (let deal = 0; deal < match.deals; deal += 1) {
    const first = match.results[2 * deal]
    const second = match.results[2 * deal + 1]
    // At a 100-chip big blind, chips a hand are big blinds a hundred hands.
    if (first !== undefined && second !== undefined) scores.push((first + second) / 2)
  }
  const mean = scores.length === 0 ? null : scores.reduce((sum, x) => sum + x, 0) / scores.length
  let interval: readonly [number, number] | null = null
  if (mean !== null && scores.length >= 2) {
    const variance = scores.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (scores.length - 1)
    const half = 1.96 * Math.sqrt(variance / scores.length)
    interval = [mean - half, mean + half]
  }
  return {
    match_id: match.id,
    opponent: match.opponent,
    deals: match.deals,
    hands_dealt: match.next,
    deals_scored: scores.length,
    bb_per_100: mean,
    interval,
  }
}

function moveCount(action: string): number {
  return action === '' ? 0 : slumbotMoves(action).length
}

function slashes(action: string): 0 | 1 | 2 | 3 {
  return Math.min(3, action.split('/').length - 1) as 0 | 1 | 2 | 3
}

function streetNumber(street: Street | null | undefined): number {
  return street === null || street === undefined ? 0 : STREETS.indexOf(street)
}

// --- HTTP ---

export interface BotApiRequest {
  readonly method: string
  /** The path below the API root, e.g. '/v1/hands' or '/v1/hands/<id>/act'. */
  readonly path: string
  readonly authorization: string | undefined
  readonly body: unknown
}

export interface BotApiResponse {
  readonly status: number
  readonly body: unknown
}

/**
 * The API's calls over plain request and response values, so any server
 * can mount it. `keyFor` turns a bearer token into the key it belongs to, or
 * null; key storage and hashing live with whoever issues them.
 */
export function handleBotApi(
  api: BotApi,
  request: BotApiRequest,
  keyFor: (token: string) => string | null,
): BotApiResponse {
  const token = /^Bearer (\S+)$/.exec(request.authorization ?? '')?.[1]
  const key = token === undefined ? null : keyFor(token)
  if (key === null) return { status: 401, body: { error: 'a valid API key is required' } }
  if (request.method !== 'POST') return { status: 405, body: { error: 'use POST' } }
  const body = (typeof request.body === 'object' && request.body !== null ? request.body : {}) as {
    readonly opponent?: unknown
    readonly incr?: unknown
    readonly seq?: unknown
    readonly deals?: unknown
    readonly match_id?: unknown
  }
  const opponent = body.opponent ?? 'nyx'
  if (!isBotApiOpponent(opponent)) {
    return {
      status: 400,
      body: { error: `opponent must be one of ${BOT_API_OPPONENTS.join(', ')}` },
    }
  }
  if (request.path === '/v1/matches') {
    if (typeof body.deals !== 'number') {
      return { status: 400, body: { error: 'send { deals: integer }' } }
    }
    return respondMatch(api.newMatch(key, opponent, body.deals))
  }
  const match = /^\/v1\/matches\/([A-Za-z0-9-]{1,64})$/.exec(request.path)
  if (match?.[1] !== undefined) return respondMatch(api.match(key, match[1]))
  if (request.path === '/v1/hands') {
    if (body.match_id !== undefined && typeof body.match_id !== 'string') {
      return { status: 400, body: { error: 'match_id must be a string' } }
    }
    return respond(api.newHand(key, opponent, body.match_id))
  }
  const act = /^\/v1\/hands\/([A-Za-z0-9-]{1,64})\/act$/.exec(request.path)
  if (act?.[1] !== undefined) {
    if (
      typeof body.incr !== 'string' ||
      typeof body.seq !== 'number' ||
      !Number.isSafeInteger(body.seq)
    ) {
      return { status: 400, body: { error: 'send { incr: string, seq: integer }' } }
    }
    return respond(api.act(key, act[1], body.incr, body.seq))
  }
  return { status: 404, body: { error: 'no such call' } }
}

function respondMatch(result: BotApiMatchResult): BotApiResponse {
  return result.ok
    ? { status: 200, body: result.match }
    : { status: result.status, body: { error: result.error } }
}

function respond(result: BotApiResult): BotApiResponse {
  return result.ok
    ? { status: 200, body: result.hand }
    : { status: result.status, body: { error: result.error } }
}

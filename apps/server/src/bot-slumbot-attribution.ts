import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { describeHand, evaluateBest, handScore, parseCard } from '@river/engine'
import { showdownShare } from './bot-allin-equity.js'
import { studentT975 } from './bot-session-evaluation.js'
import { SLUMBOT_STAKE, slumbotMoves } from './bot-slumbot.js'

// Usage: npx tsx apps/server/src/bot-slumbot-attribution.ts [--block-size 250]
//   [--top 20] <hands.jsonl> [more.jsonl ...]
// JSON on stdout, grouped by `focal`. Like bot-slumbot-pool.ts, parse nonblank
// JSONL lines and use the shared slumbotMoves ACPC parser. No solving or I/O
// beyond reading the named logs. `--self-test` runs synthetic accounting cases.
interface LoggedHand {
  hand: number
  focal: string
  clientPos: 0 | 1
  hole: string[]
  slumbotHole: string[] | null
  board: string[]
  action: string
  winnings: number
}
type End = 'preflop fold' | 'preflop all-in' | 'flop' | 'turn' | 'river' | 'showdown'
type Size = 'small' | 'medium' | 'pot' | 'overbet' | 'all-in'
interface Encounter {
  street: number
  size: Size
  fraction: number
  mdf: number
  fold: boolean
  raise: boolean
  offTree: boolean
  beyondRaiseCap: boolean
  facingRaise: boolean
}
interface Parsed {
  log: LoggedHand
  file: string
  line: number
  session: number
  block: number
  end: End
  lastStreet: number
  preflop: 'fold' | 'call' | '3-bet' | 'open' | 'limp' | 'other'
  openBB: number | null
  aggressor: 'ours' | 'Slumbot' | 'unraised'
  encounters: Encounter[]
  postflop: boolean
  invested: number
  lastOurs: string
  lastDecision: {
    kind: string
    street: number
    added: number
    potBefore: number
    callShare: number | null
  }
  closure: 'fold' | 'all-in' | 'showdown'
  payoutVerified: boolean
}
const BB = SLUMBOT_STAKE.bigBlind
const STACK = SLUMBOT_STAKE.defaultBuyIn
const STREETS = ['preflop', 'flop', 'turn', 'river']
const ENDS: End[] = ['preflop fold', 'preflop all-in', 'flop', 'turn', 'river', 'showdown']
const SIZES: Size[] = ['small', 'medium', 'pot', 'overbet', 'all-in']

function parse(
  log: LoggedHand,
  file: string,
  line: number,
  session: number,
  block: number,
): Parsed {
  if (
    ![0, 1].includes(log.clientPos) ||
    !Number.isFinite(log.winnings) ||
    !Number.isSafeInteger(log.hand) ||
    typeof log.focal !== 'string' ||
    !Array.isArray(log.hole) ||
    log.hole.length !== 2 ||
    !Array.isArray(log.board)
  )
    throw new Error('invalid hand schema')
  const cards = [...log.hole, ...log.board, ...(log.slumbotHole ?? [])]
  cards.forEach(parseCard)
  if (new Set(cards).size !== cards.length) throw new Error('duplicate cards')
  const moves = slumbotMoves(log.action)
  if (moves.length === 0) throw new Error('empty action')
  const paid: [number, number] = [BB, SLUMBOT_STAKE.smallBlind]
  let bets: [number, number] = [...paid]
  let actor: 0 | 1 = 1
  let street = 0
  let terminal = false
  let folded: 0 | 1 | null = null
  let raises = 0
  let aggressor: Parsed['aggressor'] = 'unraised'
  let lastOurs = ''
  let lastDecision: Parsed['lastDecision'] = {
    kind: '',
    street: 0,
    added: 0,
    potBefore: 0,
    callShare: null,
  }
  const encounters: Encounter[] = []
  const ours = log.clientPos
  for (const [index, move] of moves.entries()) {
    if (terminal) throw new Error('action after terminal')
    if (move.street > 3 || move.street < street) throw new Error('invalid street')
    if (move.street !== street) {
      if (bets[0] !== bets[1]) throw new Error('unmatched street')
      street = move.street
      bets = [0, 0]
      actor = 0
      raises = 0
    }
    const other: 0 | 1 = actor === 0 ? 1 : 0
    const current = Math.max(...bets)
    const call = current - bets[actor]
    const pot = paid[0] + paid[1]
    const action = move.action
    if (actor === ours) {
      lastOurs = `${STREETS[street]} ${action.kind}${action.kind === 'raiseTo' ? ` ${action.to}` : ''}`
      lastDecision = {
        kind: action.kind,
        street,
        added:
          action.kind === 'raiseTo' ? action.to - bets[actor] : action.kind === 'call' ? call : 0,
        potBefore: pot,
        callShare: call > 0 ? call / (pot + call) : null,
      }
    }
    if (action.kind === 'raiseTo') {
      if (action.to <= current || action.to - bets[actor] > STACK - paid[actor]) {
        throw new Error('invalid raise target')
      }
      const allIn = paid[actor] + action.to - bets[actor] === STACK
      if (street === 0) aggressor = actor === ours ? 'ours' : 'Slumbot'
      if (street > 0 && actor !== ours) {
        const reply = moves[index + 1]
        if (reply?.street !== street) throw new Error('missing reply to bet')
        // River solver: extra = round(toCall + 0.66 * potAfterCall).
        // For a raise, measure the increment beyond a call, against the pot
        // after that call. The MDF below is the requested sizing heuristic,
        // not a claim that equilibrium must defend this often on every street.
        const fraction = (action.to - current) / (pot + call)
        const size: Size = allIn
          ? 'all-in'
          : fraction <= 0.4
            ? 'small'
            : fraction <= 0.8
              ? 'medium'
              : fraction <= 1.2
                ? 'pot'
                : 'overbet'
        encounters.push({
          street,
          size,
          fraction,
          mdf: 1 / (1 + fraction),
          fold: reply.action.kind === 'fold',
          raise: reply.action.kind === 'raiseTo',
          offTree: !allIn && action.to !== bets[actor] + Math.round(call + 0.66 * (pot + call)),
          beyondRaiseCap: call > 0 && raises >= 1,
          facingRaise: call > 0,
        })
      }
      if (call > 0) raises += 1
      paid[actor] += action.to - bets[actor]
      bets[actor] = action.to
    } else if (action.kind === 'call') {
      if (call <= 0) throw new Error('call with nothing to call')
      paid[actor] += call
      bets[actor] += call
      terminal = paid[0] === STACK && paid[1] === STACK
    } else if (action.kind === 'fold') {
      if (call <= 0) throw new Error('fold with nothing to call')
      folded = actor
      terminal = true
    } else if (action.kind === 'check' && call > 0) throw new Error('check facing bet')
    actor = other
  }
  const last = moves.at(-1)
  if (last === undefined) throw new Error('missing final move')
  if (folded === null && (bets[0] !== bets[1] || (!terminal && street !== 3))) {
    throw new Error('incomplete hand')
  }
  const end: End =
    street === 0
      ? folded === null
        ? 'preflop all-in'
        : 'preflop fold'
      : folded === null && street === 3
        ? 'showdown'
        : street === 1
          ? 'flop'
          : street === 2
            ? 'turn'
            : 'river'
  let preflop: Parsed['preflop'] = 'other'
  const first = moves[0]?.action
  const second = moves[1]?.action
  const openBB = first?.kind === 'raiseTo' ? first.to / BB : null
  if (ours === 1) {
    preflop = first?.kind === 'raiseTo' ? 'open' : first?.kind === 'call' ? 'limp' : 'fold'
  } else if (first?.kind === 'raiseTo') {
    preflop = second?.kind === 'raiseTo' ? '3-bet' : second?.kind === 'call' ? 'call' : 'fold'
  }
  let expected: number | null = null
  if (folded !== null) expected = folded === ours ? -paid[ours] : paid[ours === 0 ? 1 : 0]
  else if (log.slumbotHole != null && log.board.length === 5) {
    const ourScore = handScore([...log.hole, ...log.board].map(parseCard))
    const theirScore = handScore([...log.slumbotHole, ...log.board].map(parseCard))
    expected =
      ourScore > theirScore ? paid[ours === 0 ? 1 : 0] : ourScore < theirScore ? -paid[ours] : 0
  }
  if (expected !== null && expected !== log.winnings)
    throw new Error(`payout ${expected} != ${log.winnings}`)
  return {
    log,
    file,
    line,
    session,
    block,
    end,
    lastStreet: street,
    preflop,
    openBB,
    aggressor,
    encounters,
    postflop: moves.some((move) => move.street > 0),
    invested: paid[ours],
    lastOurs,
    lastDecision,
    closure: folded !== null ? 'fold' : terminal ? 'all-in' : 'showdown',
    payoutVerified: expected !== null,
  }
}

interface Observation {
  block: number
  x: number
  y: number
}
interface Estimate {
  value: number | null
  interval95: [number, number] | null
  observations: number
  activeBlocks: number
}
/** Cluster sandwich for a ratio of totals; retain zero-exposure blocks. */
function ratio(rows: Observation[], blocks: number, scale = 1): Estimate {
  const sums = Array.from({ length: blocks }, () => ({ x: 0, y: 0 }))
  for (const row of rows) {
    const sum = sums[row.block]
    if (sum === undefined) throw new Error('invalid cluster')
    sum.x += row.x
    sum.y += row.y
  }
  const x = sums.reduce((a, b) => a + b.x, 0)
  const y = sums.reduce((a, b) => a + b.y, 0)
  const activeBlocks = sums.filter((sum) => sum.y > 0).length
  const value = y > 0 ? x / y : null
  let interval95: [number, number] | null = null
  if (value !== null && blocks >= 2 && activeBlocks >= 5) {
    const residual = sums.reduce((a, b) => a + (b.x - value * b.y) ** 2, 0)
    const radius = (studentT975(blocks - 1) * Math.sqrt((blocks / (blocks - 1)) * residual)) / y
    interval95 = [(value - radius) * scale, (value + radius) * scale]
  }
  return {
    value: value === null ? null : value * scale,
    interval95,
    observations: rows.length,
    activeBlocks,
  }
}

function describe(hands: Parsed[], blocks: number, all: Parsed[]) {
  const profit = hands.reduce((a, h) => a + h.log.winnings, 0)
  const total = all.reduce((a, h) => a + h.log.winnings, 0)
  const selected = new Set(hands)
  return {
    n: hands.length,
    netBB: profit / BB,
    conditionalBB100: ratio(
      hands.map((h) => ({ block: h.block, x: h.log.winnings, y: 1 })),
      blocks,
      100 / BB,
    ),
    contributionBB100: ratio(
      all.map((h) => ({ block: h.block, x: selected.has(h) ? h.log.winnings : 0, y: 1 })),
      blocks,
      100 / BB,
    ),
    // Signed accounting share, not the fraction that could be recovered.
    lossSharePct: total < 0 ? (100 * profit) / total : null,
  }
}

function frequency(all: Parsed[], test: (h: Parsed) => boolean, blocks: number) {
  return ratio(
    all.map((h) => ({ block: h.block, x: Number(test(h)), y: 1 })),
    blocks,
    100,
  )
}

function summarise(hands: Parsed[], blockSize: number, top: number) {
  // Reindex per bot: other bot rows must not create empty independent clusters.
  const keys = [...new Set(hands.map((h) => h.block))]
  const ids = new Map(keys.map((key, index) => [key, index]))
  hands = hands.map((h) => ({ ...h, block: ids.get(h.block) as number }))
  const blocks = keys.length
  const by = (select: (h: Parsed) => boolean) => describe(hands.filter(select), blocks, hands)
  const pf = (position: 0 | 1, category: Parsed['preflop']) => {
    const eligible = hands.filter(
      (h) => h.log.clientPos === position && (position === 1 || h.openBB !== null),
    )
    return {
      position: position === 0 ? 'BB facing open' : 'BTN first action',
      action: category,
      frequencyPct: frequency(eligible, (h) => h.preflop === category, blocks),
      ...describe(
        eligible.filter((h) => h.preflop === category),
        blocks,
        hands,
      ),
    }
  }
  const encounters = hands.flatMap((h) => h.encounters.map((e) => ({ ...e, hand: h })))
  const sizeRow = (
    size: Size,
    street: number | null = null,
    facingRaise: boolean | null = null,
  ) => {
    const rows = encounters.filter(
      (e) =>
        e.size === size &&
        (street === null || e.street === street) &&
        (facingRaise === null || e.facingRaise === facingRaise),
    )
    const metric = (get: (e: (typeof rows)[number]) => number, scale = 100) =>
      ratio(
        rows.map((e) => ({ block: e.hand.block, x: get(e), y: 1 })),
        blocks,
        scale,
      )
    return {
      size,
      street: street === null ? 'all' : STREETS[street],
      type: facingRaise === null ? 'both' : facingRaise ? 'raise' : 'bet',
      n: rows.length,
      uniqueHands: new Set(rows.map((e) => e.hand)).size,
      foldPct: metric((e) => Number(e.fold)),
      defendPct: metric((e) => Number(!e.fold)),
      raisePct: metric((e) => Number(e.raise)),
      mdfPct: metric((e) => e.mdf),
      defendMinusMdfPP: metric((e) => Number(!e.fold) - e.mdf),
      offTreePct: metric((e) => Number(e.offTree)),
      beyondRaiseCapPct: metric((e) => Number(e.beyondRaiseCap)),
      meanPotFraction: metric((e) => e.fraction, 1),
      // Repeated whole-hand outcomes per encounter: intentionally nonadditive.
      outcomeBB100Encounters: metric((e) => e.hand.log.winnings, 100 / BB),
      uniqueHandResults: describe([...new Set(rows.map((e) => e.hand))], blocks, hands),
    }
  }
  const preflop = [
    pf(0, 'fold'),
    pf(0, 'call'),
    pf(0, '3-bet'),
    pf(1, 'open'),
    pf(1, 'limp'),
    pf(1, 'fold'),
  ]
  const openSizes = [
    ...new Set(
      hands
        .filter((h) => h.log.clientPos === 0 && h.openBB !== null)
        .map((h) => h.openBB as number),
    ),
  ]
    .sort((a, b) => a - b)
    .map((size) => {
      const eligible = hands.filter((h) => h.log.clientPos === 0 && h.openBB === size)
      return {
        openBB: size,
        n: eligible.length,
        actions: ['fold', 'call', '3-bet'].map((action) => ({
          action,
          frequencyPct: frequency(eligible, (h) => h.preflop === action, blocks),
          ...describe(
            eligible.filter((h) => h.preflop === action),
            blocks,
            hands,
          ),
        })),
      }
    })
  const costliest = [...hands]
    .sort(
      (a, b) => a.log.winnings - b.log.winnings || a.file.localeCompare(b.file) || a.line - b.line,
    )
    .slice(0, top)
    .map((h) => ({
      file: h.file,
      line: h.line,
      hand: h.log.hand,
      position: h.log.clientPos === 0 ? 'BB' : 'BTN',
      hole: h.log.hole,
      slumbotHole: h.log.slumbotHole,
      board: h.log.board,
      action: h.log.action,
      netBB: h.log.winnings / BB,
      end: h.end,
      lastStreet: STREETS[h.lastStreet],
      closure: h.closure,
      lastDecision: h.lastDecision,
      ...knownCardsAtClosure(h),
      diagnosis: `${STREETS[h.lastStreet]} ${h.preflop}, PFA=${h.aggressor}; ${h.lastOurs}; ${h.encounters.filter((e) => e.offTree).length} off-tree sizes faced; ${h.closure !== 'fold' ? 'showdown outcome; error versus cooler/runout needs range EV' : 'hand ended by fold; correctness needs range EV'}`,
      encounters: h.encounters,
    }))
  const sessionIds = [...new Set(hands.map((h) => h.session))]
  const sensitivity = [100, 250, 500].map((size) => {
    const counts = new Map<number, number>()
    const clusterKeys = new Map<string, number>()
    const rows = hands.map((h) => {
      const count = counts.get(h.session) ?? 0
      counts.set(h.session, count + 1)
      const key = `${h.session}:${Math.floor(count / size)}`
      if (!clusterKeys.has(key)) clusterKeys.set(key, clusterKeys.size)
      return { block: clusterKeys.get(key) as number, x: h.log.winnings, y: 1 }
    })
    return {
      blockSize: size,
      clusters: clusterKeys.size,
      estimate: ratio(rows, clusterKeys.size, 100 / BB),
    }
  })
  const sessionRows = hands.map((h) => ({
    block: sessionIds.indexOf(h.session),
    x: h.log.winnings,
    y: 1,
  }))
  // A small exact runout check on flop/turn stack-offs only. This prices the
  // observed matchups, not the EV of a shove against the opponent's range.
  const earlyAllIns = new Map(
    hands
      .filter(
        (h) =>
          h.closure === 'all-in' &&
          (h.lastStreet === 1 || h.lastStreet === 2) &&
          h.log.slumbotHole != null,
      )
      .map((h) => {
        const equity = showdownShare(
          h.log.hole.map(parseCard),
          (h.log.slumbotHole as string[]).map(parseCard),
          h.log.board.slice(0, h.lastStreet === 1 ? 3 : 4).map(parseCard),
          'exact',
        )
        return [h, (2 * equity - 1) * STACK] as const
      }),
  )
  return {
    bot: hands[0]?.log.focal,
    n: hands.length,
    files: [...new Set(hands.map((h) => h.file))],
    blockSize,
    blocks,
    sessions: sessionIds.length,
    payoutVerified: hands.filter((h) => h.payoutVerified).length,
    overall: by(() => true),
    blockSensitivity: sensitivity,
    sessionEstimate: ratio(sessionRows, sessionIds.length, 100 / BB),
    earlyAllInRunoutCheck: {
      n: earlyAllIns.size,
      expectedContributionBB100: ratio(
        hands.map((h) => ({ block: h.block, x: earlyAllIns.get(h) ?? 0, y: 1 })),
        blocks,
        100 / BB,
      ),
      expectedMinusRawBB100: ratio(
        hands.map((h) => ({
          block: h.block,
          x: earlyAllIns.has(h) ? (earlyAllIns.get(h) as number) - h.log.winnings : 0,
          y: 1,
        })),
        blocks,
        100 / BB,
      ),
    },
    positions: [0, 1].map((position) => ({
      position: position === 0 ? 'BB' : 'BTN',
      ...by((h) => h.log.clientPos === position),
    })),
    endings: [0, 1].flatMap((position) =>
      ENDS.map((end) => ({
        position: position === 0 ? 'BB' : 'BTN',
        end,
        ...by((h) => h.log.clientPos === position && h.end === end),
      })),
    ),
    preflop,
    openSizes,
    postflopAggressor: ['ours', 'Slumbot', 'unraised'].map((aggressor) => ({
      aggressor,
      ...by((h) => h.postflop && h.aggressor === aggressor),
    })),
    sizes: SIZES.map((size) => sizeRow(size)),
    sizesByStreet: [1, 2, 3].flatMap((street) => SIZES.map((size) => sizeRow(size, street))),
    sizesByType: [false, true].flatMap((raise) => SIZES.map((size) => sizeRow(size, null, raise))),
    encounterCount: encounters.length,
    offTreeEncounters: encounters.filter((e) => e.offTree).length,
    slices: [
      {
        name: 'postflop our final fold to small/medium',
        ...by(
          (h) =>
            h.postflop &&
            h.lastDecision.kind === 'fold' &&
            ['small', 'medium'].includes(h.encounters.at(-1)?.size ?? ''),
        ),
      },
      {
        name: 'flop/turn called all-ins',
        ...by((h) => h.closure === 'all-in' && (h.lastStreet === 1 || h.lastStreet === 2)),
      },
      ...[1, 2].flatMap((street) =>
        ['fold', 'all-in'].map((closure) => ({
          name: `${STREETS[street]} ${closure} closure`,
          ...by((h) => h.lastStreet === street && h.closure === closure),
        })),
      ),
      {
        name: 'BTN first-action folds',
        ...by((h) => h.log.clientPos === 1 && h.preflop === 'fold'),
      },
      {
        name: 'BB first-response folds',
        ...by((h) => h.log.clientPos === 0 && h.openBB !== null && h.preflop === 'fold'),
      },
      {
        name: 'BB called open then postflop',
        ...by((h) => h.log.clientPos === 0 && h.preflop === 'call' && h.postflop),
      },
      {
        name: 'postflop faced any off-tree size',
        ...by((h) => h.postflop && h.encounters.some((e) => e.offTree)),
      },
      {
        name: 'postflop faced only on-tree sizes',
        ...by(
          (h) => h.postflop && h.encounters.length > 0 && h.encounters.every((e) => !e.offTree),
        ),
      },
      { name: 'postflop faced no bet', ...by((h) => h.postflop && h.encounters.length === 0) },
      ...SIZES.map((size) => ({
        name: `postflop first faced ${size}`,
        ...by((h) => h.encounters[0]?.size === size),
      })),
    ],
    costliest,
  }
}

/** Hindsight diagnostics only, for the requested top N (not every hand). */
function knownCardsAtClosure(h: Parsed) {
  const count = [0, 3, 4, 5][h.lastStreet] as number
  const board = h.log.board.slice(0, count).map(parseCard)
  const ours = h.log.hole.map(parseCard)
  const theirs = h.log.slumbotHole?.map(parseCard)
  return {
    madeAtClosure: board.length >= 3 ? describeHand(evaluateBest([...ours, ...board])) : null,
    opponentMadeAtClosure:
      board.length >= 3 && theirs !== undefined
        ? describeHand(evaluateBest([...theirs, ...board]))
        : null,
    // Exact postflop runouts; seeded 4,000-board Monte Carlo preflop, as pool.ts.
    knownOpponentEquity:
      h.closure !== 'fold' && theirs !== undefined
        ? showdownShare(ours, theirs, board, `attribution:${h.file}:${h.line}`)
        : null,
  }
}

function selfTest() {
  const hand = (
    action: string,
    winnings: number,
    board: string[] = [],
    clientPos: 0 | 1 = 0,
  ): LoggedHand => ({
    hand: 0,
    focal: 'test',
    clientPos,
    hole: ['As', 'Ah'],
    slumbotHole: null,
    board,
    action,
    winnings,
  })
  const flop = ['2c', '3d', '4h']
  const check = (ok: boolean) => {
    if (!ok) throw new Error('self-test failed')
  }
  check(parse(hand('b200f', -100), 'test', 1, 0, 0).end === 'preflop fold')
  check(parse(hand('f', 50), 'test', 1, 0, 0).log.winnings === 50)
  check(parse(hand('b200b20000c///', 0), 'test', 1, 0, 0).end === 'preflop all-in')
  const bet = parse(hand('b200c/kb264f', -200, flop), 'test', 1, 0, 0)
  check(bet.encounters[0]?.offTree === false && bet.encounters[0]?.fraction === 0.66)
  const raise = parse(hand('b200c/b264b876f', -464, flop), 'test', 1, 0, 0)
  check(raise.encounters[0]?.offTree === false && raise.encounters[0]?.fraction === 612 / 928)
  check(parse(hand('b200c/kb100f', -200, flop), 'test', 1, 0, 0).encounters[0]?.offTree === true)
  check(parse(hand('b200c/b264f', -200, flop, 1), 'test', 1, 0, 0).end === 'flop')
  const estimate = ratio(
    Array.from({ length: 5 }, (_, block) => ({ block, x: block, y: 1 })),
    5,
  )
  check(estimate.value === 2 && estimate.interval95 !== null)
  const absent = ratio([], 5)
  check(absent.value === null && absent.interval95 === null)
  process.stdout.write('9 synthetic accounting/statistics checks passed\n')
}

function main() {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === '--self-test') return selfTest()
  let blockSize = 250
  let top = 20
  const files: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string
    if (arg === '--block-size' || arg === '--top') {
      const value = Number(args[++index])
      if (!Number.isSafeInteger(value) || value < (arg === '--top' ? 0 : 1))
        throw new Error(`invalid ${arg}`)
      if (arg === '--top') top = value
      else blockSize = value
    } else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`)
    else files.push(resolve(arg))
  }
  if (files.length === 0)
    throw new Error('usage: [--block-size 250] [--top 20] <hands.jsonl> [more.jsonl ...]')
  if (new Set(files).size !== files.length) throw new Error('duplicate input path')
  const hands: Parsed[] = []
  const sessions: { file: string; hands: number; resets: number; missingHandIds: number }[] = []
  let session = -1
  let block = -1
  for (const file of files) {
    session += 1
    let count = 0
    let previous = -1
    let resets = 0
    let missingHandIds = 0
    const lines = readFileSync(file, 'utf8').split('\n')
    for (const [index, line] of lines.entries()) {
      if (line.trim() === '') continue
      try {
        const log = JSON.parse(line) as LoggedHand
        if (log.hand <= previous) {
          session += 1
          count = 0
          resets += 1
        } else if (previous >= 0) missingHandIds += log.hand - previous - 1
        if (count % blockSize === 0) block += 1
        hands.push(parse(log, basename(file), index + 1, session, block))
        previous = log.hand
        count += 1
      } catch (error) {
        throw new Error(`${file}:${index + 1}: ${String(error)}`)
      }
    }
    sessions.push({
      file,
      hands: lines.filter((line) => line.trim() !== '').length,
      resets,
      missingHandIds,
    })
  }
  const bots = [...new Set(hands.map((h) => h.log.focal))].map((bot) =>
    summarise(
      hands.filter((h) => h.log.focal === bot),
      blockSize,
      top,
    ),
  )
  process.stdout.write(
    `${JSON.stringify(
      {
        methodology: {
          units:
            'BB=100 chips; contribution per 100 ALL bot hands; conditional per 100 bucket hands',
          intervals:
            'two-sided t, cluster sandwich ratio; contiguous blocks within file/reset; null if <5 exposed blocks; zero-exposure blocks retained',
          limitation:
            'blocks assume dependence does not span blocks; file/session intervals withheld with fewer than 5 sessions; no pairing across bots',
          endings:
            'last actual action street; pre-river called all-ins stay on commitment street; showdown means river nonfold closure; trailing empty slashes ignored',
          sizes:
            'small <=0.4; medium (0.4,0.8]; pot (0.8,1.2]; overbet >1.2; all-in overrides; raise increment/(pot after call)',
          offTree:
            'exact rounded 0.66-pot target or all-in; maxRaises=1 violation reported separately; local size coverage, not carried-path reachability',
          mdf: 'mean 1/(1+fraction); compare to 100-foldPct; raises use normalized sizing heuristic, not an exact raise bluff-indifference bound',
          outcomes:
            'raw whole-hand net; encounter results overlap; unique first-faced-size slices and ending buckets do not',
          lossShare:
            'signed net bucket / signed net bot loss; winners negative; not recoverable EV; no ratio CI when total loss may be near zero',
          worstHands:
            'ties broken by filename then line; hole cards after the fact do not prove a decision error',
        },
        sessions,
        bots,
      },
      null,
      2,
    )}\n`,
  )
}

main()

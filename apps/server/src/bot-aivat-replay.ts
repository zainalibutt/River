import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { DEFAULT_STAKE, parseCard } from '@river/engine'
import { type AivatDecision, aivatChips } from './bot-aivat.js'
import { lateBoardCorrection } from './bot-aivat-chance.js'
import { enumerableAivatToy } from './bot-aivat-toy.js'
import { allInEquityChips } from './bot-allin-equity.js'
import { beginBenchmark } from './bot-benchmark-provenance.js'
import { clusteredEstimate, studentT975 } from './bot-session-evaluation.js'
import { SLUMBOT_STAKE, slumbotMoves, slumbotRoom } from './bot-slumbot.js'

export interface AivatLoggedHand {
  readonly hand: number
  readonly focal: string
  readonly reads?: boolean
  readonly clientPos: 0 | 1
  readonly hole: readonly string[]
  readonly slumbotHole: readonly string[] | null
  readonly board: readonly string[]
  readonly action: string
  readonly winnings: number
  readonly aivatDecisions?: readonly AivatDecision[]
}

/** No policy reconstruction is claimed here. Historical logs without decision
 * records support chance controls only, even if today's policy can be queried. */
export function replaySlumbotHand(hand: AivatLoggedHand, chanceAvailable: boolean) {
  const ours = 'bot:aivat-hero'
  const theirs = 'bot:aivat-other'
  const hole = hand.hole.map(parseCard)
  const other = hand.slumbotHole?.map(parseCard)
  const board = hand.board.map(parseCard)
  const state = {
    action: hand.action,
    clientPos: hand.clientPos,
    hole,
    board,
    ...(other ? { theirHole: other } : {}),
  }
  const room = slumbotRoom(state, { ours, theirs })
  const final = room.viewFor(ours)
  const seat = final.seats.find((entry) => entry.playerId === ours)
  if (
    final.phase !== 'between' ||
    seat === undefined ||
    seat.stack - SLUMBOT_STAKE.defaultBuyIn !== hand.winnings
  )
    throw new Error('payout mismatch')
  const pieces = hand.action.split('/')
  let chance = 0
  if (chanceAvailable && other) {
    // The previous street's closing action already deals the next board.
    for (let street = 2; street <= 3; street++) {
      const after = street + 2
      if (board.length < after || pieces.length <= street) continue
      const beforeRoom = slumbotRoom(
        { ...state, action: pieces.slice(0, street).join('/') },
        { ours, theirs },
      )
      const view = beforeRoom.viewFor('')
      if (view.phase !== 'hand') continue // betting closed: no double correction
      chance += lateBoardCorrection(hole, other, [
        {
          before: board.slice(0, after - 1),
          after: board.slice(0, after),
          pot: view.seats.reduce((sum, entry) => sum + entry.betHand, 0),
        },
      ])
    }
  }
  const last = slumbotMoves(hand.action).at(-1)
  let valued = hand.winnings
  if (other && last && last.action.kind !== 'fold' && last.street < 3) {
    const stack = SLUMBOT_STAKE.defaultBuyIn
    valued =
      allInEquityChips(
        [
          { playerId: ours, contributed: stack, contending: true },
          { playerId: theirs, contributed: stack, contending: true },
        ],
        new Map([
          [ours, hole],
          [theirs, other],
        ]),
        board.slice(0, [0, 3, 4, 5][last.street]),
        ours,
        hand.winnings,
        `slumbot-aivat:${hand.hand}`,
      ) ?? hand.winnings
  }
  const controls =
    hand.aivatDecisions?.flatMap((decision) => (decision.control ? [decision.control] : [])) ?? []
  return {
    raw: hand.winnings,
    valued,
    chanceOnly: hand.winnings + chance,
    aivat: aivatChips(hand.winnings, controls) + chance,
    knownActions: controls.length,
    missingActions:
      hand.aivatDecisions?.filter((decision) => decision.control === null).length ?? null,
  }
}

export function estimatorSummary(
  rows: readonly { session: number; value: number }[],
  clusters: number,
  bigBlind: number,
) {
  const estimate = clusteredEstimate(rows, clusters, bigBlind)
  return {
    ...estimate,
    standardError:
      (estimate.interval95[1] - estimate.interval95[0]) / (2 * studentT975(clusters - 1)),
  }
}

interface DuplicatePiece {
  readonly a: string
  readonly b: string
  readonly prefix: string
  readonly scores: readonly {
    session: number
    value: number
    raw?: number
    corrected?: number
    aivat?: number
  }[]
}

if (process.argv[1]?.endsWith('bot-aivat-replay.ts')) {
  const [out, ...files] = process.argv.slice(2)
  if (!out || files.length === 0)
    throw new Error('usage: <out.json> <logs.jsonl | duplicate-pieces.json ...>')
  const deadline = Date.now() + 500_000
  const inputs = files.map((file) => ({ file, text: readFileSync(file, 'utf8') }))
  const slumbot = files.every((file) => file.endsWith('.jsonl'))
  if (!slumbot && files.some((file) => file.endsWith('.jsonl')))
    throw new Error('do not mix Slumbot and duplicate inputs')
  const identity = inputs.map(({ file, text }) => ({
    name: basename(file),
    sha256: createHash('sha256').update(text).digest('hex'),
  }))
  if (new Set(identity.map((input) => input.sha256)).size !== identity.length)
    throw new Error('duplicate input content')
  let result: unknown
  let count = 0
  if (slumbot) {
    const runs = inputs.map(({ text }) =>
      text
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as AivatLoggedHand),
    )
    const hands = runs.flat()
    const focal = new Set(hands.map((hand) => hand.focal))
    if (focal.size !== 1) throw new Error('mixed focal policies')
    const hasReads = hands.some((hand) => hand.reads === true)
    const chanceAvailable = hands.every((hand) => hand.slumbotHole?.length === 2)
    const recorded = hands.every((hand) => hand.aivatDecisions !== undefined)
    const provenance = beginBenchmark(out, 'aivat-replay-slumbot', {
      policies: [...focal],
      seeds: [],
      plannedHands: hands.length,
      settings: { inputs: identity, historical: true },
    })
    const rows: {
      session: number
      raw: number
      valued: number
      chanceOnly: number
      aivat: number
    }[] = []
    let known = 0
    let missing = 0
    for (let run = 0; run < runs.length; run++) {
      const seen = new Set<number>()
      for (const hand of runs[run] ?? []) {
        if (Date.now() > deadline) throw new Error('replay time budget exceeded; split input files')
        if (seen.has(hand.hand)) throw new Error('duplicate hand in a run')
        seen.add(hand.hand)
        const replay = replaySlumbotHand(hand, chanceAvailable)
        known += replay.knownActions
        missing += replay.missingActions ?? 0
        rows.push({ session: hasReads ? run : rows.length, ...replay })
      }
    }
    const clusters = hasReads ? runs.length : rows.length
    const summary = (key: 'raw' | 'valued' | 'chanceOnly' | 'aivat') =>
      estimatorSummary(
        rows.map((row) => ({ session: row.session, value: row[key] })),
        clusters,
        100,
      )
    const raw = summary('raw')
    const valued = summary('valued')
    const chanceOnly = summary('chanceOnly')
    const aivat = recorded ? summary('aivat') : null
    result = {
      kind: 'slumbot',
      inputs: identity,
      hands: hands.length,
      clusters,
      raw,
      valued,
      chanceOnly,
      aivat,
      knownActions: known,
      missingActions: recorded ? missing : null,
      chanceAvailable,
      replayFailures: 0,
      sourceRunFailures: null,
      qualification: 'retrospective-analysis-only',
      aivatUnavailableReason: recorded
        ? null
        : 'Historical exact strategy probabilities and policy fingerprints absent; no action AIVAT claimed',
      standardErrorReduction: {
        rawToChanceOnly: raw.standardError / chanceOnly.standardError,
        valuedToChanceOnly: valued.standardError / chanceOnly.standardError,
        rawToAivat: aivat ? raw.standardError / aivat.standardError : null,
        valuedToAivat: aivat ? valued.standardError / aivat.standardError : null,
      },
      varianceGatePassed:
        aivat !== null &&
        raw.standardError / aivat.standardError >= 2 &&
        valued.standardError / aivat.standardError >= 2,
      provenance: provenance.provenance,
    }
    count = hands.length
    writeFileSync(out, `${JSON.stringify({ toy: enumerableAivatToy(), result }, null, 2)}\n`)
    provenance.finish(count)
  } else {
    const pieces = inputs.map(({ text }) => JSON.parse(text) as DuplicatePiece)
    const pair = pieces[0]
    if (!pair || pieces.some((piece) => piece.a !== pair.a || piece.b !== pair.b))
      throw new Error('mixed duplicate pairs')
    const occupied = new Set<string>()
    const cluster = new Map<string, number>()
    const rows = pieces.flatMap((piece) => {
      const sessions = new Set(piece.scores.map((row) => row.session))
      for (const session of sessions) {
        const key = `${piece.prefix}:${session}`
        if (occupied.has(key)) throw new Error('overlapping duplicate sessions')
        occupied.add(key)
        cluster.set(key, cluster.size)
      }
      return piece.scores.map((row) => ({
        ...row,
        cluster: cluster.get(`${piece.prefix}:${row.session}`) as number,
      }))
    })
    const summary = (value: (row: (typeof rows)[number]) => number) =>
      estimatorSummary(
        rows.map((row) => ({ session: row.cluster, value: value(row) })),
        cluster.size,
        DEFAULT_STAKE.bigBlind,
      )
    const raw = rows.every((row) => row.raw !== undefined)
      ? summary((row) => row.raw as number)
      : null
    const valued = summary((row) => row.value)
    const aivat = rows.every((row) => row.aivat !== undefined)
      ? summary((row) => row.aivat as number)
      : null
    const provenance = beginBenchmark(out, 'aivat-replay-duplicate', {
      policies: [pair.a, pair.b],
      seeds: pieces.map((piece) => piece.prefix),
      plannedHands: rows.length,
      settings: { inputs: identity },
    })
    result = {
      kind: 'duplicate',
      inputs: identity,
      pairs: rows.length,
      clusters: cluster.size,
      raw,
      valued,
      aivat,
      historicalChanceCorrected: rows.every((row) => row.corrected !== undefined)
        ? summary((row) => row.corrected as number)
        : null,
      aivatUnavailableReason: aivat
        ? null
        : 'Pieces contain scores only, without exact action records or replay states',
      varianceGatePassed:
        raw !== null &&
        aivat !== null &&
        aivat.standardError > 0 &&
        raw.standardError / aivat.standardError >= 2 &&
        valued.standardError / aivat.standardError >= 2,
      provenance: provenance.provenance,
    }
    count = rows.length
    writeFileSync(out, `${JSON.stringify({ toy: enumerableAivatToy(), result }, null, 2)}\n`)
    provenance.finish(count)
  }
  process.stdout.write(
    `${JSON.stringify({ out: basename(out), hands: count, toy: enumerableAivatToy() })}\n`,
  )
}

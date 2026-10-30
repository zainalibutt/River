import { appendFileSync, createReadStream, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { championPersonality, mulberry32, parseCard, seedFromString } from '@river/engine'
import type { AivatDecision } from './bot-aivat.js'
import { showdownShare } from './bot-allin-equity.js'
import { releasePolicyHand } from './bot-policy-hand.js'
import { actionFor } from './bot-service.js'
import { focalRotation } from './bot-session-campaign.js'
import { SLUMBOT_STAKE, slumbotMoves, slumbotRoom } from './bot-slumbot.js'
import { v9gPolicy } from './bot-v9g-policy.js'

// tsx apps/server/src/bot-flop-defence-replay.ts --spots 2 --seed example
//   --variant prod --shard 1/1 --out art/out/flop-prod.jsonl <hands.jsonl ...>
// Shards are ONE-based. Uniform sampling without replacement precedes sharding.
// Leaf networks/backends are entirely caller-controlled, as in the runner.
// --summarise <prod.jsonl> <big.jsonl> requires the same selected spots.
export interface ReplayHand {
  hand: number
  focal: string
  personality: string
  clientPos: 0 | 1
  hole: string[]
  slumbotHole: string[] | null
  action: string
  aivatDecisions: AivatDecision[]
}

export interface Spot {
  file: string
  line: number
  hand: number
  decision: number
  fraction: number
}
type Choices = readonly { action: string; probability: number }[]
export interface ReplayRow extends Spot {
  variant: 'prod' | 'big'
  hole: string[]
  slumbotHole: string[]
  board: string[]
  pot: number
  toCall: number
  equity: number
  loggedChoices: Choices
  variantChoices: Choices
  foldAbsDifference: number
  maxChoiceAbsDifference: number
  /** Policy construction, replay through target, and release; excludes equity enumeration. */
  ms: number
}

/** Attribution's increment / pot-after-call sizing, restricted to a first bet. */
export function flopSpots(log: ReplayHand, file: string, line: number): Spot[] {
  if (log.focal !== 'v9gp' || log.clientPos !== 0 || log.slumbotHole?.length !== 2) return []
  return (log.aivatDecisions ?? []).flatMap((decision, index) => {
    const o = decision.observation
    if (o.street !== 'flop' || o.amountToCall <= 0 || decision.control === null) return []
    const moves = o.actions?.filter((move) => move.street === 'flop') ?? []
    const bet = moves.at(-1)
    if (
      !bet ||
      bet.seat === o.actor.seat ||
      (bet.action.kind !== 'raiseTo' && bet.action.kind !== 'allIn') ||
      moves
        .slice(0, -1)
        .some((move) => move.action.kind === 'raiseTo' || move.action.kind === 'allIn')
    )
      return []
    // No earlier aggression means our street investment is zero. Subtracting
    // the outstanding bet recovers attribution's pot before Slumbot bet.
    const fraction = o.amountToCall / (o.pot - o.amountToCall)
    if (!(fraction > 0.4 && fraction <= 0.8)) return []
    return [{ file, line, hand: log.hand, decision: index, fraction }]
  })
}

export function selectSpots(spots: readonly Spot[], count: number, seed: string, shard = '1/1') {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('--spots must be positive')
  const match = /^(\d+)\/(\d+)$/.exec(shard)
  const k = Number(match?.[1])
  const total = Number(match?.[2])
  if (!Number.isSafeInteger(total) || total < 1 || !Number.isSafeInteger(k) || k < 1 || k > total)
    throw new Error('--shard must be k/K, with 1 <= k <= K')
  const ordered = [...spots].sort((a, b) =>
    a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || a.decision - b.decision,
  )
  const rng = mulberry32(seedFromString(seed))
  for (let i = ordered.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const saved = ordered[i] as Spot
    ordered[i] = ordered[j] as Spot
    ordered[j] = saved
  }
  return ordered.slice(0, count).filter((_, index) => index % total === k - 1)
}

async function* jsonLines<T>(file: string): AsyncGenerator<{ value: T; line: number }> {
  const input = createReadStream(file, { encoding: 'utf8' })
  const reader = createInterface({ input, crlfDelay: Infinity })
  let line = 0
  try {
    for await (const text of reader) {
      line++
      if (text.trim()) yield { value: JSON.parse(text) as T, line }
    }
  } finally {
    reader.close()
    input.destroy()
  }
}

const fold = (choices: Choices) =>
  choices.find((choice) => choice.action === 'fold')?.probability ?? 0
const spotKey = (spot: Spot) => JSON.stringify([spot.file, spot.line, spot.hand, spot.decision])

/** Recorded histories force the logged actions, even if the variant samples another action. */
export function replaySpot(
  log: ReplayHand,
  spot: Spot,
  variant: 'prod' | 'big',
  runSeed: string,
): ReplayRow {
  const personality = [...focalRotation(), championPersonality()].find(
    (p) => p.id === log.personality,
  )
  if (!personality) throw new Error(`unknown personality ${log.personality}`)
  const target = log.aivatDecisions[spot.decision]
  if (!target?.control || !log.slumbotHole) throw new Error('missing target control/cards')
  const started = performance.now()
  const { policy } = v9gPolicy({
    offTree: 'resolve',
    preflopTables: true,
    ...(variant === 'big' ? { resolveIterationMultiplier: 10 } : {}),
  })
  const rng = mulberry32(seedFromString(`slumbot:${runSeed}:${log.hand}`))
  const moves = slumbotMoves(log.action)
  let captured: AivatDecision | undefined
  try {
    for (let index = 0; index <= spot.decision; index++) {
      const logged = log.aivatDecisions[index]
      if (!logged) throw new Error('missing earlier observation')
      const o = logged.observation
      if (o.actions == null) throw new Error('replay requires recorded public actions')
      let action = ''
      let street = 0
      for (const move of moves.slice(0, o.actions.length)) {
        while (street < move.street) {
          action += '/'
          street++
        }
        action +=
          move.action.kind === 'raiseTo'
            ? `b${move.action.to}`
            : move.action.kind === 'check'
              ? 'k'
              : move.action.kind === 'call'
                ? 'c'
                : 'f'
      }
      const room = slumbotRoom(
        { action, clientPos: log.clientPos, hole: log.hole.map(parseCard), board: o.board },
        { ours: o.actor.playerId, theirs: 'bot:slumbot' },
      )
      const result = actionFor(room.viewFor(o.actor.playerId), o.actor.playerId, personality, rng, {
        policy,
        roomId: o.roomId,
        publicActions: room.currentActions(),
        tilt: o.tilt,
        opponentSummaries: o.opponents,
        ...(o.opponentStats === undefined ? {} : { opponentStats: o.opponentStats }),
        aivat: (decision) => {
          captured = decision
        },
      })
      if (!result || !captured || !isDeepStrictEqual(captured.observation, o))
        throw new Error(`reconstructed observation differs at decision ${index}`)
      if (index === spot.decision && captured.control === null)
        throw new Error(`strategy unavailable: ${captured.reason}`)
    }
  } finally {
    releasePolicyHand(policy, 'slumbot', 1)
  }
  const ms = performance.now() - started
  const variantChoices = captured?.control?.choices
  if (!variantChoices) throw new Error('missing replay strategy')
  const loggedChoices = target.control.choices
  const actions = new Set([...loggedChoices, ...variantChoices].map((c) => c.action))
  const probability = (choices: Choices, action: string) =>
    choices.find((c) => c.action === action)?.probability ?? 0
  const o = target.observation
  return {
    ...spot,
    variant,
    hole: log.hole,
    slumbotHole: log.slumbotHole,
    board: o.board.map((card) => `${card.rank}${card.suit}`),
    pot: o.pot,
    toCall: o.amountToCall,
    equity: showdownShare(
      log.hole.map(parseCard),
      log.slumbotHole.map(parseCard),
      o.board,
      'flop-replay',
    ),
    loggedChoices,
    variantChoices,
    ms,
    foldAbsDifference: Math.abs(fold(variantChoices) - fold(loggedChoices)),
    maxChoiceAbsDifference: Math.max(
      ...[...actions].map((action) =>
        Math.abs(probability(variantChoices, action) - probability(loggedChoices, action)),
      ),
    ),
  }
}

/** Both the per-spot mean product and conditional weighted mean are explicit. */
export function summarise(rows: readonly ReplayRow[]) {
  const spots = new Map<string, ReplayRow>()
  const groups = new Map<string, Map<string, ReplayRow>>()
  for (const row of rows) {
    const key = spotKey(row)
    const previous = spots.get(key)
    if (
      previous &&
      (previous.equity !== row.equity ||
        previous.pot !== row.pot ||
        previous.toCall !== row.toCall ||
        !isDeepStrictEqual(previous.loggedChoices, row.loggedChoices))
    )
      throw new Error('inconsistent logged spot across variants')
    spots.set(key, row)
    let group = groups.get(row.variant)
    if (!group) {
      group = new Map()
      groups.set(row.variant, group)
    }
    if (group.has(key)) throw new Error('duplicate spot/variant')
    group.set(key, row)
  }
  if (spots.size === 0) throw new Error('no replay rows')
  for (const group of groups.values())
    if (group.size !== spots.size) throw new Error('variants must contain identical spot sets')
  const stats = (data: readonly ReplayRow[], logged: boolean) => {
    const probability = (row: ReplayRow) => fold(logged ? row.loggedChoices : row.variantChoices)
    const mean = (f: (row: ReplayRow) => number) => data.reduce((s, r) => s + f(r), 0) / data.length
    const callEV = (r: ReplayRow) =>
      (r.equity * (r.pot + r.toCall) - r.toCall) / SLUMBOT_STAKE.bigBlind
    const meanFoldProbability = mean(probability)
    const meanFoldWeightedCallEVbb = mean((r) => probability(r) * callEV(r))
    return {
      spots: data.length,
      meanFoldProbability,
      meanFoldWeightedCallEVbb,
      foldWeightedMeanCallEVbb:
        meanFoldProbability > 0 ? meanFoldWeightedCallEVbb / meanFoldProbability : null,
      meanAbsFoldDifferenceFromLogged: logged
        ? 0
        : mean((r) => Math.abs(probability(r) - fold(r.loggedChoices))),
      equityDeciles: Array.from({ length: 10 }, (_, decile) => {
        const inBin = data.filter((r) => Math.min(9, Math.floor(r.equity * 10)) === decile)
        return {
          decile,
          spots: inBin.length,
          meanFoldProbability: inBin.length
            ? inBin.reduce((sum, r) => sum + probability(r), 0) / inBin.length
            : null,
        }
      }),
    }
  }
  return {
    sampling: 'uniform without replacement; no equity stratification',
    callEV: 'check-down vs actual hand, not strategy EV; pot includes bet; values in bb',
    logged: stats([...spots.values()], true),
    prod: groups.has('prod') ? stats([...(groups.get('prod')?.values() ?? [])], false) : undefined,
    big: groups.has('big') ? stats([...(groups.get('big')?.values() ?? [])], false) : undefined,
  }
}

export async function main(args: string[]) {
  if (args[0] === '--summarise') {
    const rows: ReplayRow[] = []
    for (const file of args.slice(1))
      for await (const { value } of jsonLines<ReplayRow>(file)) rows.push(value)
    console.log(JSON.stringify(summarise(rows), null, 2))
    return
  }
  const options = new Map<string, string>()
  const files: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string
    if (!arg.startsWith('--')) {
      files.push(relative(process.cwd(), resolve(arg)))
      continue
    }
    if (
      !['--spots', '--seed', '--variant', '--shard', '--out'].includes(arg) ||
      options.has(arg) ||
      !args[i + 1]
    )
      throw new Error(`invalid option ${arg}`)
    options.set(arg, args[++i] as string)
  }
  const count = Number(options.get('--spots'))
  const seed = options.get('--seed')
  const variant = options.get('--variant')
  const out = options.get('--out')
  if (!seed || !out || !files.length || (variant !== 'prod' && variant !== 'big'))
    throw new Error(
      'usage: --spots N --seed S --variant prod|big --shard k/K --out file.jsonl <hands.jsonl ...>',
    )
  const destination = relative(process.cwd(), resolve(out))
  if (
    !destination ||
    destination === '..' ||
    destination.startsWith('..\\') ||
    destination.startsWith('../') ||
    isAbsolute(destination)
  )
    throw new Error('--out must be inside the worktree')
  const candidates: Spot[] = []
  for (const file of [...new Set(files)].sort()) {
    for await (const { value, line } of jsonLines<ReplayHand>(file))
      candidates.push(...flopSpots(value, file, line))
  }
  const selected = selectSpots(candidates, count, seed, options.get('--shard'))
  console.error(
    JSON.stringify({ eligible: candidates.length, selected: selected.length, sampling: 'uniform' }),
  )
  const hands = new Map<string, ReplayHand>()
  for (const file of new Set(selected.map((s) => s.file))) {
    const wanted = new Set(selected.filter((s) => s.file === file).map((s) => s.line))
    for await (const { value, line } of jsonLines<ReplayHand>(file)) {
      if (wanted.has(line)) hands.set(JSON.stringify([file, line]), value)
    }
  }
  // Read only the run seed from provenance; never change the caller's leaf environment.
  const seeds = new Map<string, string>()
  for (const file of new Set(selected.map((s) => s.file))) {
    const provenance = JSON.parse(readFileSync(`${file}.provenance.json`, 'utf8')) as {
      seeds: string[]
    }
    const runSeed = provenance.seeds?.[0]
    if (!runSeed) throw new Error(`missing provenance run seed for ${file}`)
    seeds.set(file, runSeed)
  }
  writeFileSync(out, '', { flag: 'wx' })
  for (const spot of selected) {
    const log = hands.get(JSON.stringify([spot.file, spot.line]))
    const runSeed = seeds.get(spot.file)
    if (!log || !runSeed) throw new Error('selected hand disappeared')
    const row = replaySpot(log, spot, variant, runSeed)
    appendFileSync(out, `${JSON.stringify(row)}\n`)
    console.error(
      JSON.stringify({ hand: spot.hand, ms: row.ms, foldAbsDifference: row.foldAbsDifference }),
    )
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}

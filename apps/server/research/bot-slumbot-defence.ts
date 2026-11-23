import { createReadStream } from 'node:fs'
import { basename, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import {
  type BotObservationV1,
  type Card,
  cardKey,
  handScore,
  makeDeck,
  mulberry32,
  parseCard,
  seedFromString,
} from '@river/engine'

// Usage: tsx bot-slumbot-defence.ts [--samples N] <hands.jsonl> [more ...]
// Reads logs only. No policy reconstruction, solving, network access, or file writes.
const BB = 100 // SLUMBOT_STAKE.bigBlind
const DECK = makeDeck()
type Street = 'flop' | 'turn' | 'river'
type Size = 'small' | 'medium' | 'pot' | 'overbet' | 'all-in'
interface Control {
  readonly kind: 'action' | 'chance'
  readonly choices: readonly { readonly action: string; readonly probability: number }[]
  readonly taken: string
}
export interface DefenceHand {
  readonly clientPos: 0 | 1
  readonly hole: readonly string[]
  readonly slumbotHole: readonly string[] | null
  readonly aivatDecisions: readonly {
    readonly observation: BotObservationV1
    readonly control: Control | null
  }[]
}

export function sizeBucket(fraction: number, allIn: boolean): Size {
  return allIn
    ? 'all-in'
    : fraction <= 0.4
      ? 'small'
      : fraction <= 0.8
        ? 'medium'
        : fraction <= 1.2
          ? 'pot'
          : 'overbet'
}

function checkedCards(cards: readonly Card[]): void {
  for (const card of cards) parseCard(`${card.rank}${card.suit}`)
  if (new Set(cards.map(cardKey)).size !== cards.length) throw new Error('duplicate cards')
}

/** Actual-hand equity; only the current board blocks future runouts. */
export function defenceEquity(
  ours: readonly Card[],
  theirs: readonly Card[],
  board: readonly Card[],
  samples = 990,
) {
  if (ours.length !== 2 || theirs.length !== 2 || ![3, 4, 5].includes(board.length))
    throw new Error('expected two holes and a postflop board')
  if (!Number.isSafeInteger(samples) || samples < 1) throw new Error('invalid samples')
  checkedCards([...ours, ...theirs, ...board])
  const known = new Set([...ours, ...theirs, ...board].map(cardKey))
  const deck = DECK.filter((card) => !known.has(cardKey(card)))
  const first = [...ours, ...board]
  const second = [...theirs, ...board]
  const score = (a?: Card, b?: Card) => {
    if (a) first[ours.length + board.length] = second[theirs.length + board.length] = a
    if (b) first[6] = second[6] = b
    const x = handScore(first)
    const y = handScore(second)
    return x > y ? 1 : x === y ? 0.5 : 0
  }
  let share = 0
  let runouts = 0
  const add = (a?: Card, b?: Card) => {
    share += score(a, b)
    runouts += 1
  }
  if (board.length === 5) add()
  else if (board.length === 4) {
    for (const card of deck) add(card)
  } else if (samples >= 990) {
    for (let a = 0; a < deck.length; a += 1)
      for (let b = a + 1; b < deck.length; b += 1) add(deck[a], deck[b])
  } else {
    // Seed by the matchup, independent of input path, ordering, and sampled action.
    const key = [ours, theirs, board].map((cards) => cards.map(cardKey).sort((a, b) => a - b))
    const rng = mulberry32(seedFromString(`slumbot-defence-v1:${JSON.stringify(key)}`))
    for (let i = 0; i < samples; i += 1) {
      const a = Math.floor(rng() * deck.length)
      let b = Math.floor(rng() * (deck.length - 1))
      if (b >= a) b += 1
      add(deck[a], deck[b])
    }
  }
  return { equity: share / runouts, runouts }
}

export function callEVBB(equity: number, pot: number, toCall: number): number {
  return (equity * (pot + toCall) - toCall) / BB
}

export function strategyProbabilities(control: Control, observation: BotObservationV1) {
  const result = { fold: 0, call: 0, raise: 0 }
  const seen = new Set<string>()
  for (const { action, probability } of control.choices) {
    if (!Number.isFinite(probability) || probability < 0 || probability > 1 || seen.has(action))
      throw new Error('invalid or duplicate strategy choice')
    seen.add(action)
    if (action === 'fold') result.fold += probability
    else if (
      action === 'call' ||
      (action === 'allIn' && observation.actor.stack <= observation.amountToCall)
    )
      result.call += probability
    else if (action === 'allIn' || /^raiseTo:[1-9][0-9]*$/.test(action)) result.raise += probability
    else throw new Error(`unsupported action facing a bet: ${action}`)
  }
  if (
    control.kind !== 'action' ||
    Math.abs(result.fold + result.call + result.raise - 1) > 1e-9 ||
    !control.choices.some((choice) => choice.action === control.taken && choice.probability > 0)
  )
    throw new Error('missing normalized action strategy')
  return result
}

/** Attribution's raise-increment / pot-after-call convention. */
export function incomingBet(observation: BotObservationV1) {
  const last = observation.actions?.at(-1)
  const opponent = observation.seats.find((seat) => seat.seat !== observation.actor.seat)
  if (
    !last ||
    !opponent ||
    last.seat !== opponent.seat ||
    last.street !== observation.street ||
    !['raiseTo', 'allIn'].includes(last.action.kind) ||
    !Number.isFinite(last.amountCommitted) ||
    !Number.isFinite(last.potBefore)
  )
    throw new Error('missing incoming bet history')
  const committed = last.amountCommitted as number
  const potBefore = last.potBefore as number
  const callBefore = committed - observation.amountToCall
  const denominator = potBefore + callBefore
  if (
    callBefore < 0 ||
    denominator <= 0 ||
    Math.abs(potBefore + committed - observation.pot) > 1e-9 ||
    opponent.betStreet - observation.actor.betStreet !== observation.amountToCall
  )
    throw new Error('incoming bet disagrees with observation pot/call')
  const fraction = observation.amountToCall / denominator
  return {
    fraction,
    size: sizeBucket(fraction, opponent.stack === 0),
    facingRaise: callBefore > 0,
  }
}

interface Bucket {
  street: Street
  position: 'BB' | 'BTN'
  size: Size
  facingRaise: boolean
  n: number
  fold: number
  call: number
  raise: number
  fraction: number
  mdf: number
  foldedEV: number
  positiveFoldMass: number
  bluffs: number
  deciles: { n: number; fold: number }[]
}

export class DefenceAnalysis {
  private readonly buckets = new Map<string, Bucket>()
  private hands = 0
  private decisions = 0
  private runouts = 0
  private readonly started = performance.now()

  constructor(private readonly samples = 990) {
    if (!Number.isSafeInteger(samples) || samples < 1) throw new Error('invalid samples')
  }

  add(hand: DefenceHand): void {
    if (![0, 1].includes(hand.clientPos) || !Array.isArray(hand.aivatDecisions))
      throw new Error('invalid clientPos or missing aivatDecisions')
    this.hands += 1
    // Reuse equity on repeated decisions at the same board within this hand.
    const equities = new Map<string, ReturnType<typeof defenceEquity>>()
    for (const { observation: o, control } of hand.aivatDecisions) {
      if (!Number.isFinite(o.amountToCall) || o.amountToCall < 0)
        throw new Error('invalid amountToCall')
      if (o.street === 'preflop' || o.amountToCall === 0) continue
      if (!['flop', 'turn', 'river'].includes(o.street)) throw new Error('invalid street')
      if (o.board.length !== { flop: 3, turn: 4, river: 5 }[o.street as Street])
        throw new Error('street/board mismatch')
      if (!Number.isFinite(o.pot) || o.pot <= 0 || o.actor.stack < o.amountToCall)
        throw new Error('invalid pot or unmatched call')
      if (!control || hand.slumbotHole?.length !== 2 || hand.hole?.length !== 2)
        throw new Error('missing full strategy or actual hole cards')
      const ours = hand.hole.map(parseCard)
      if (o.actor.hole.map(cardKey).sort().join() !== ours.map(cardKey).sort().join())
        throw new Error('observation hole differs from logged hand')
      const probabilities = strategyProbabilities(control, o)
      const bet = incomingBet(o)
      const equityKey = o.board.map(cardKey).join(',')
      let result = equities.get(equityKey)
      if (!result) {
        result = defenceEquity(ours, hand.slumbotHole.map(parseCard), o.board, this.samples)
        equities.set(equityKey, result)
        this.runouts += result.runouts
      }
      const { equity } = result
      const ev = callEVBB(equity, o.pot, o.amountToCall)
      const position = hand.clientPos === 0 ? 'BB' : 'BTN'
      const key = `${o.street}:${position}:${bet.size}:${bet.facingRaise}`
      let bucket = this.buckets.get(key)
      if (!bucket) {
        bucket = {
          street: o.street as Street,
          position,
          size: bet.size,
          facingRaise: bet.facingRaise,
          n: 0,
          fold: 0,
          call: 0,
          raise: 0,
          fraction: 0,
          mdf: 0,
          foldedEV: 0,
          positiveFoldMass: 0,
          bluffs: 0,
          deciles: Array.from({ length: 10 }, () => ({ n: 0, fold: 0 })),
        }
        this.buckets.set(key, bucket)
      }
      this.decisions += 1
      bucket.n += 1
      bucket.fold += probabilities.fold
      bucket.call += probabilities.call
      bucket.raise += probabilities.raise
      bucket.fraction += bet.fraction
      bucket.mdf += 1 / (1 + bet.fraction)
      bucket.foldedEV += probabilities.fold * ev
      bucket.positiveFoldMass += ev > 0 ? probabilities.fold : 0
      bucket.bluffs += 1 - equity < 0.35 ? 1 : 0
      const decile = bucket.deciles[Math.min(9, Math.floor(equity * 10))]
      if (!decile) throw new Error('invalid equity decile')
      decile.n += 1
      decile.fold += probabilities.fold
    }
  }

  report() {
    return {
      methodology: {
        scope:
          'All postflop bot decisions facing a positive call; inputs pooled; decision-weighted.',
        units: 'Probabilities/shares in [0,1]; EV in big blinds; Slumbot BB=100 chips.',
        pot: 'P=observation.pot, INCLUDING the incoming Slumbot bet, before our call. bot-service copies room view.pot; BettingHand.pot sums all betThisHand contributions.',
        callEV: 'e*(P+toCall)-toCall, divided by 100; fold has zero incremental EV.',
        caveat:
          'Retrospective check-down basis versus the actual opposing hand. Ignores future betting and equity realisation; does not establish a decision error or recoverable policy gain. MDF is a sizing heuristic.',
        sizes:
          'small <=0.4; medium (0.4,0.8]; pot (0.8,1.2]; overbet >1.2; all-in overrides when Slumbot stack=0. Fraction=raise increment/(pot before its action + its call), as attribution; for an initial bet this is bet/pot before bet.',
        strategy:
          'Sum logged control.choices by action, never sampled frequencies. allIn at or below toCall counts as call. Missing/invalid eligible records fail instead of being silently dropped.',
        equity:
          'handScore from @river/engine; ties=0.5; excludes both holes and CURRENT board only. Exact river=1, turn=44, flop=990 unordered runouts. Future logged board is not conditioned on.',
        flopSamples: Math.min(990, this.samples),
        sampling:
          'Below 990: uniform independent two-card draws with replacement across samples, distinct cards within each draw. mulberry32 seedFromString of version + sorted actual holes/current board. Turn/river always exact. Thresholds/deciles inherit MC error.',
        foldedEV:
          'EV given up by folding, check-down basis: sum(pFold*callEV)/sum(pFold), signed, null at zero fold mass. Also report sum(pFold*callEV)/n as per-decision contribution; negative values favour folding.',
        positiveFoldShare: 'sum(pFold * I(callEV>0))/sum(pFold); null at zero fold mass.',
        bluffShare:
          'Unweighted share of faced Slumbot bets with its actual-hand equity (1-e) <0.35; repeated bets count separately.',
        deciles:
          'Fixed equity intervals [0,.1), ... [.9,1]; final interval includes equity=1; empty means null.',
      },
      hands: this.hands,
      decisions: this.decisions,
      evaluatedRunouts: this.runouts,
      elapsedSeconds: (performance.now() - this.started) / 1000,
      buckets: [...this.buckets.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, b]) => ({
          street: b.street,
          position: b.position,
          size: b.size,
          facingRaise: b.facingRaise,
          n: b.n,
          meanFoldProbability: b.fold / b.n,
          meanCallProbability: b.call / b.n,
          meanRaiseProbability: b.raise / b.n,
          meanPotFraction: b.fraction / b.n,
          meanMDF: b.mdf / b.n,
          foldMass: b.fold,
          foldWeightedMeanCallEVBB: b.fold > 0 ? b.foldedEV / b.fold : null,
          foldedCallEVBBPerDecision: b.foldedEV / b.n,
          positiveCallEVFoldMassShare: b.fold > 0 ? b.positiveFoldMass / b.fold : null,
          slumbotBluffShare: b.bluffs / b.n,
          equityDeciles: b.deciles.map((d, i) => ({
            lower: i / 10,
            upper: (i + 1) / 10,
            n: d.n,
            meanFoldProbability: d.n > 0 ? d.fold / d.n : null,
          })),
        })),
    }
  }
}

export async function main(args: readonly string[]): Promise<void> {
  let samples = 990
  const files: string[] = []
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string
    if (arg === '--samples') {
      samples = Number(args[++i])
      if (!Number.isSafeInteger(samples) || samples < 1) throw new Error('invalid --samples')
    } else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`)
    else files.push(resolve(arg))
  }
  if (files.length === 0) throw new Error('usage: [--samples N] <hands.jsonl> [more ...]')
  if (new Set(files.map((file) => file.toLowerCase())).size !== files.length)
    throw new Error('duplicate input file')
  const analysis = new DefenceAnalysis(samples)
  for (const file of files) {
    const input = createReadStream(file, { encoding: 'utf8' })
    const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY })
    let lineNumber = 0
    try {
      for await (const line of lines) {
        lineNumber += 1
        if (line.trim() === '') continue
        analysis.add(JSON.parse(line) as DefenceHand)
      }
    } catch (error) {
      throw new Error(`${basename(file)}:${lineNumber}: ${String(error)}`)
    } finally {
      lines.close()
      input.destroy()
    }
  }
  process.stdout.write(`${JSON.stringify(analysis.report(), null, 2)}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${String(error)}\n`)
    process.exitCode = 1
  })
}

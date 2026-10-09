import { writeFileSync } from 'node:fs'
import { type BotPolicy, championPersonality, DEFAULT_STAKE } from '@river/engine'
import { opponentStatsPlugin } from './bot-opponent-reads.js'
import { pokerGuardPolicy } from './bot-poker-guard.js'
import { RIVER_CANDIDATE_TUNING, riverSolverPolicy } from './bot-river-policy.js'
import { runSessions } from './bot-session-benchmark.js'
import {
  campaignSize,
  developmentTables,
  heldOutTables,
  ordinaryTables,
} from './bot-session-campaign.js'
import { solvedTurnPolicy } from './bot-turn-policy.js'
import { turnNetworkFromEnvironment } from './bot-value-network.js'

// Usage: tsx bot-turn-diagnose.ts <table> <seed prefix> <sessions> <first session> <out.json> [v9a|v9b]
// Plays v8z and a turn-solving candidate (v9a by default) on the same deals against the champion, as bot-compare-table.ts does, and
// tags every hand with what the focal seat did at a two-player turn and whether the turn solver
// chose it, so bot-turn-diagnose-pool.ts can say where the solver's chips are won and lost.
const [tableName, prefix, sessionsText, firstText, out, candidateName = 'v9a'] =
  process.argv.slice(2)
const table = [...developmentTables(), ...heldOutTables(), ...ordinaryTables()].find(
  (entry) => entry.name === tableName,
)
if (table === undefined || !prefix || !out || !['v9a', 'v9b'].includes(candidateName)) {
  throw new Error('usage: <table> <seed prefix> <sessions> <first session> <out.json> [v9a|v9b]')
}
const sessions = Number(sessionsText)
const first = Number(firstText)

/** What the focal seat did in one hand. */
interface HandTag {
  /** Each decision at a two-player turn: F (facing a bet) or O (not), the move, `*` when solved. */
  turn: string[]
  /** The last street the focal seat acted on. */
  last: string
}

function move(
  decision: ReturnType<BotPolicy['decide']>['decision'],
  pot: number,
  toCall: number,
): string {
  if (decision.kind !== 'raiseTo') return decision.kind
  return `${toCall > 0 ? 'raise' : 'bet'}${(decision.to / Math.max(1, pot)).toFixed(1)}`
}

/** `policy`, recording a tag per hand; `solved` counts the turn solver's own decisions, if any. */
function tagged(policy: BotPolicy, solved: () => number) {
  const tags: HandTag[] = []
  let current: HandTag = { turn: [], last: 'none' }
  const wrapped: BotPolicy = {
    id: policy.id,
    version: policy.version,
    decide(context) {
      const before = solved()
      const result = policy.decide(context)
      const observation = context.observation
      const live = observation.seats.filter((seat) => seat.playerId !== null && !seat.folded)
      if (observation.street === 'turn' && live.length === 2) {
        current.turn.push(
          `${observation.amountToCall > 0 ? 'F' : 'O'}:${move(result.decision, observation.pot, observation.amountToCall)}${solved() > before ? '*' : ''}`,
        )
      }
      current.last = observation.street
      return result
    },
  }
  return {
    policy: wrapped,
    tags,
    start() {
      current = { turn: [], last: 'none' }
      tags.push(current)
    },
  }
}

function play(policy: BotPolicy, solved: () => number) {
  const run = tagged(policy, solved)
  const result = runSessions({
    seed: `${prefix}-${table?.name}`,
    sessions,
    firstSession: first,
    handsPerSession: campaignSize(table as NonNullable<typeof table>).handsPerSession,
    plugin: opponentStatsPlugin(),
    table: table as NonNullable<typeof table>,
    focalPersonalities: [championPersonality()],
    allInAdjustment: true,
    focalPolicy: run.policy,
    onFocalHand: () => run.start(),
  })
  return result.hands.map((hand, index) => ({
    session: hand.session,
    hand: hand.hand,
    chips: hand.focalChips,
    adjusted: hand.adjustedChips ?? hand.focalChips,
    ...(run.tags[index] as HandTag),
  }))
}

const started = Date.now()
const base = riverSolverPolicy(pokerGuardPolicy, 'river-solver', 1, RIVER_CANDIDATE_TUNING)
const baseline = play(base.policy, () => 0)
const turn = solvedTurnPolicy(turnNetworkFromEnvironment(), {}, candidateName === 'v9b')
const candidate = play(turn.policy, () => turn.stats.solved)
writeFileSync(
  out,
  JSON.stringify({
    table: table.name,
    prefix,
    candidate: candidateName,
    first,
    sessions,
    bigBlind: DEFAULT_STAKE.bigBlind,
    fallbacks: turn.stats.fallbacks,
    hands: baseline.map((before, index) => ({ v8z: before, candidate: candidate[index] })),
  }),
)
process.stdout.write(
  `${table.name} from ${first}: ${baseline.length} hands, ${Math.round((Date.now() - started) / 1000)} s\n`,
)

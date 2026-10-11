import { type BotPolicy, cardToString, championPersonality } from '@river/engine'
import { opponentStatsPlugin } from './bot-opponent-reads.js'
import { runSessions } from './bot-session-benchmark.js'
import {
  campaignSize,
  developmentTables,
  heldOutTables,
  ordinaryTables,
} from './bot-session-campaign.js'
import { solvedTurnPolicy } from './bot-turn-policy.js'
import { turnNetworkFromEnvironment } from './bot-value-network.js'

// Usage: tsx bot-turn-explain.ts <table> <seed prefix> <session> <hand> [v9a|v9b]
// Replays one hand of a diagnosis as the candidate played it, against the champion as
// bot-turn-diagnose.ts sets it up, and prints what the turn solve said at each of the OG's
// two-player turn decisions: the ranges, whether its own holding was in range, and its row.
const [tableName, prefix, sessionText, handText, candidateName = 'v9b'] = process.argv.slice(2)
const table = [...developmentTables(), ...heldOutTables(), ...ordinaryTables()].find(
  (entry) => entry.name === tableName,
)
if (table === undefined || !prefix) {
  throw new Error('usage: <table> <seed prefix> <session> <hand> [v9a|v9b]')
}
const target = { session: Number(sessionText), hand: Number(handText) }
const turn = solvedTurnPolicy(turnNetworkFromEnvironment(), {}, candidateName === 'v9b')
let at = { session: -1, hand: -1 }
const focal: BotPolicy = {
  id: turn.policy.id,
  version: turn.policy.version,
  decide(context) {
    const result = turn.policy.decide(context)
    const { observation } = context
    if (at.session === target.session && at.hand === target.hand) {
      const cards = (list: readonly Parameters<typeof cardToString>[0][]) =>
        list.map(cardToString).join(' ')
      process.stdout.write(
        `${observation.street}: OG ${cards(observation.actor.hole)}, board ${cards(observation.board)}, pot ${observation.pot}, to call ${observation.amountToCall} -> ${JSON.stringify(result.decision)}\n`,
      )
      if (observation.street === 'turn') {
        process.stdout.write(
          `  solve: ${JSON.stringify(turn.explain(observation, context.personality))}\n`,
        )
      }
    }
    return result
  },
}
runSessions({
  seed: `${prefix}-${table.name}`,
  sessions: 2,
  firstSession: target.session,
  handsPerSession: Math.min(target.hand + 1, campaignSize(table).handsPerSession),
  plugin: opponentStatsPlugin(),
  table,
  focalPersonalities: [championPersonality()],
  allInAdjustment: true,
  focalPolicy: focal,
  onFocalHand: (session, hand) => {
    at = { session, hand }
    if (session > target.session) process.exit(0)
  },
})

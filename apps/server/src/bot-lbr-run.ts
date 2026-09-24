import { readFileSync, writeFileSync } from 'node:fs'
import { type BotPolicy, personalityPool } from '@river/engine'
import { alwaysCallPolicy, alwaysFoldPolicy, localBestResponse } from './bot-lbr.js'
import { legacyGuardPolicy, pokerGuardPolicy, v5GuardPolicy } from './bot-poker-guard.js'
import type { Situation } from './bot-rollout.js'
import { runSessions } from './bot-session-benchmark.js'
import { focalRotation } from './bot-session-campaign.js'
import { clusteredEstimate } from './bot-session-evaluation.js'
import { learnedValuePolicy, type ValueModel } from './bot-value-model.js'

// Usage: tsx bot-lbr-run.ts <v4|v5|v6|model|call|fold> <seed> <sessions> <out.json>
// Plays one focal policy heads-up against a local best response to it. What
// the probe wins is a lower bound on how exploitable that policy is. Runs with
// the same seed deal the same cards, stacks and chairs to every focal policy,
// so their results pair hand for hand.
const [focalName, seed, sessionArg, out] = process.argv.slice(2)
const sessions = Number(sessionArg)
if (!focalName || !seed || !out || !Number.isSafeInteger(sessions) || sessions < 2) {
  throw new Error('usage: <v4|v5|v6|model|call|fold> <seed> <sessions> <out.json>')
}
const focals: Record<string, () => BotPolicy> = {
  v4: () => legacyGuardPolicy,
  v5: () => v5GuardPolicy,
  v6: () => pokerGuardPolicy,
  call: () => alwaysCallPolicy,
  fold: () => alwaysFoldPolicy,
  model: () => {
    const model = JSON.parse(
      readFileSync('apps/server/models/og-action-value-v1.experimental.json', 'utf8'),
    ) as ValueModel & { margins: Record<Situation, number> }
    return learnedValuePolicy(model, { base: v5GuardPolicy, margins: model.margins })
  },
}
const make = focals[focalName]
const opponent = personalityPool()[0]
if (make === undefined || opponent === undefined) throw new Error(`unknown focal ${focalName}`)
const focal = make()
const choices: Record<string, { count: number; foldShare: number }> = {}
const probe = localBestResponse(focal, {
  onChoice: (choice) => {
    const key = `${choice.street}:${choice.kind}`
    const tally = choices[key] ?? { count: 0, foldShare: 0 }
    tally.count += 1
    tally.foldShare += choice.foldShare ?? 0
    choices[key] = tally
  },
})
const started = Date.now()
const handsPerSession = 100
const run = runSessions({
  seed,
  sessions,
  handsPerSession,
  table: {
    name: 'heads-up-best-response',
    style: 'best-response',
    entrants: [{ personality: opponent }, { personality: opponent, policy: probe.policy }],
  },
  focalPolicy: focal,
  focalPersonalities: focalRotation(),
  onFocalDecision: probe.watch,
  allInAdjustment: true,
  onFocalHand: (session, hand) => {
    if (hand === 0 && session > 0) {
      const seconds = (Date.now() - started) / 1000
      process.stderr.write(
        `${focalName}: ${session}/${sessions} sessions, ${seconds.toFixed(0)}s\n`,
      )
    }
  },
})
const estimate = clusteredEstimate(
  run.hands.map((hand) => ({ session: hand.session, value: -hand.focalChips })),
  sessions,
)
writeFileSync(
  out,
  `${JSON.stringify({
    focal: focalName,
    seed,
    sessions,
    handsPerSession,
    estimate,
    choices,
    hands: run.hands.map((hand) => [
      hand.session,
      hand.focalChips,
      hand.position,
      hand.depth,
      hand.adjustedChips ?? hand.focalChips,
    ]),
  })}\n`,
)
const [low, high] = estimate.interval95
process.stdout.write(
  `${focalName}: probe wins ${estimate.bigBlindsPer100.toFixed(1)} (${low.toFixed(1)} to ${high.toFixed(1)}) bb/100 over ${run.hands.length} hands in ${((Date.now() - started) / 1000).toFixed(0)}s\n`,
)

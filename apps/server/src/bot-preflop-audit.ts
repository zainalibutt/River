import { type BotDecision, type BotPolicy, personalityPool } from '@river/engine'
import { runPairedBotBenchmark } from './bot-benchmark.js'
import { legacyGuardPolicy as pokerGuardPolicy } from './bot-poker-guard.js'
import { pokerStrongCandidatePolicy } from './bot-poker-strong.js'
import { botPlayerId } from './bot-service.js'

const cast = personalityPool()
const audits = [
  { name: 'heads-up', indices: [9, 4], hands: 1_600 },
  { name: 'mixed-eight', indices: [9, 0, 1, 4, 5, 6, 10, 11], hands: 1_200 },
  { name: 'tough-eight', indices: [9, 10, 11, 12, 4, 5, 6, 7], hands: 1_200 },
] as const

const results = audits.map((audit) => {
  const seats = audit.indices.map((index) => {
    const personality = cast[index]
    if (personality === undefined) throw new Error('preflop audit cast missing')
    return { personality }
  })
  const focalId = seats[0]?.personality.id
  if (focalId === undefined) throw new Error('preflop audit focal bot missing')
  const baselineActions: Record<BotDecision['kind'], number> = {
    fold: 0,
    check: 0,
    call: 0,
    raiseTo: 0,
    allIn: 0,
  }
  const candidateActions = { ...baselineActions }
  const observed = (policy: BotPolicy, counts: typeof baselineActions): BotPolicy => ({
    id: `${policy.id}-audit`,
    version: policy.version,
    decide(context) {
      const result = policy.decide(context)
      if (
        context.observation.street === 'preflop' &&
        context.observation.actor.playerId === botPlayerId(focalId)
      )
        counts[result.decision.kind] += 1
      return { ...result, policyId: this.id }
    },
  })
  const result = runPairedBotBenchmark({
    seed: `strong-preflop-${audit.name}`,
    hands: audit.hands,
    seats,
    baseline: observed(pokerGuardPolicy, baselineActions),
    candidate: observed(pokerStrongCandidatePolicy, candidateActions),
    focalEntrant: 0,
  })
  return {
    table: audit.name,
    hands: audit.hands,
    baselineActions,
    candidateActions,
    baselineBigBlindsPer100: result.baseline.seats[0]?.bbPer100Hands,
    candidateBigBlindsPer100: result.candidate.seats[0]?.bbPer100Hands,
    deltaBigBlindsPer100: result.delta.bbPer100Hands,
    confidence95Chips: result.delta.confidence95Chips,
    wins: result.delta.wins,
    losses: result.delta.losses,
    ties: result.delta.ties,
  }
})

process.stdout.write(`${JSON.stringify(results, null, 2)}\n`)

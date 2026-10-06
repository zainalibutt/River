import { type BotPolicy, deterministicRulePolicy, personalityPool } from '@river/engine'
import { runPairedBotBenchmark } from './bot-benchmark.js'
import { pokerGuardDecision } from './bot-poker-guard.js'

const pool = personalityPool()
const audits = [
  { name: 'heads-up', cast: [9, 4], hands: 800 },
  { name: 'mixed-eight', cast: [9, 0, 1, 4, 5, 6, 10, 11], hands: 800 },
  { name: 'tough-eight', cast: [9, 10, 11, 12, 4, 5, 6, 7], hands: 800 },
] as const

const results = audits.map((audit) => {
  let overrides = 0
  const observedCandidate: BotPolicy = {
    id: 'poker-guard-audit',
    version: 1,
    decide(context) {
      const baseline = deterministicRulePolicy.decide(context)
      const decision =
        context.profile.skill === 'og'
          ? pokerGuardDecision(context.observation, baseline.decision)
          : baseline.decision
      if (JSON.stringify(baseline.decision) !== JSON.stringify(decision)) overrides += 1
      return { ...baseline, policyId: this.id, policyVersion: this.version, decision }
    },
  }
  const seats = audit.cast.map((index) => {
    const personality = pool[index]
    if (personality === undefined) throw new Error('audit cast missing')
    return { personality }
  })
  const result = runPairedBotBenchmark({
    seed: `poker-guard-${audit.name}`,
    hands: audit.hands,
    seats,
    baseline: deterministicRulePolicy,
    candidate: observedCandidate,
    focalEntrant: 0,
  })
  return {
    table: audit.name,
    hands: audit.hands,
    overrides,
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

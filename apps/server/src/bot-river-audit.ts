import { type BotPolicy, personalityPool } from '@river/engine'
import { runPairedBotBenchmark } from './bot-benchmark.js'
import { rejectedRiverRangePolicy } from './bot-poker-river.js'
import { pokerStrongCandidatePolicy } from './bot-poker-strong.js'

const pool = personalityPool()
const heldOut = process.argv.includes('--held-out')
const cases = [
  { name: 'heads-up', cast: [9, 4] },
  { name: 'mixed-nine', cast: [9, 0, 1, 4, 5, 6, 10, 11, 2] },
  { name: 'tough-nine', cast: [9, 10, 11, 12, 4, 5, 6, 7, 8] },
] as const

const reports = cases.map(({ name, cast }) => {
  let overrides = 0
  const overrideDetails: {
    handIndex: number
    hole: string[]
    board: string[]
    pot: number
    toCall: number
    before: string
    after: string
  }[] = []
  let decisions = 0
  let riverFacing = 0
  let headsUpRiverFacing = 0
  let baselineRiverFolds = 0
  let baselineRiverCalls = 0
  let totalDecisionMilliseconds = 0
  let maximumDecisionMilliseconds = 0
  const observed: BotPolicy = {
    id: 'river-audit-wrapper',
    version: 1,
    decide(context) {
      const rolls: number[] = []
      const started = performance.now()
      const candidate = rejectedRiverRangePolicy.decide({
        ...context,
        rng: () => {
          const value = context.rng()
          rolls.push(value)
          return value
        },
      })
      const elapsed = performance.now() - started
      let rollIndex = 0
      const baseline = pokerStrongCandidatePolicy.decide({
        ...context,
        rng: () => {
          const value = rolls[rollIndex]
          rollIndex += 1
          if (value === undefined) throw new Error('candidate RNG diverged from baseline')
          return value
        },
      })
      if (rollIndex !== rolls.length) throw new Error('candidate consumed extra RNG')
      const observation = context.observation
      if (observation.street === 'river' && observation.amountToCall > 0) {
        riverFacing += 1
        if (
          observation.seats.filter((seat) => seat.playerId !== null && !seat.folded).length === 2
        ) {
          headsUpRiverFacing += 1
          if (baseline.decision.kind === 'fold') baselineRiverFolds += 1
          if (baseline.decision.kind === 'call') baselineRiverCalls += 1
        }
      }
      if (JSON.stringify(candidate.decision) !== JSON.stringify(baseline.decision)) {
        overrides += 1
        overrideDetails.push({
          handIndex: Number(context.observation.roomId.replace('benchmark-', '')),
          hole: context.observation.actor.hole.map((card) => `${card.rank}${card.suit}`),
          board: context.observation.board.map((card) => `${card.rank}${card.suit}`),
          pot: context.observation.pot,
          toCall: context.observation.amountToCall,
          before: baseline.decision.kind,
          after: candidate.decision.kind,
        })
      }
      decisions += 1
      totalDecisionMilliseconds += elapsed
      maximumDecisionMilliseconds = Math.max(maximumDecisionMilliseconds, elapsed)
      return { ...candidate, policyId: this.id, policyVersion: this.version }
    },
  }
  const seats = cast.map((index) => {
    const personality = pool[index]
    if (personality === undefined) throw new Error('river audit cast missing')
    return { personality }
  })
  const result = runPairedBotBenchmark({
    seed: `river-${heldOut ? 'heldout' : 'development'}-${name}`,
    hands: heldOut ? 800 : 300,
    seats,
    baseline: pokerStrongCandidatePolicy,
    candidate: observed,
    focalEntrant: 0,
  })
  return {
    table: name,
    hands: result.hands,
    overrides,
    overrideDetails: overrideDetails.map((detail) => ({
      ...detail,
      deltaChips: result.pairs[detail.handIndex]?.deltaChips,
    })),
    decisions,
    riverFacing,
    headsUpRiverFacing,
    baselineRiverFolds,
    baselineRiverCalls,
    averageDecisionMilliseconds: totalDecisionMilliseconds / decisions,
    maximumDecisionMilliseconds,
    deltaBigBlindsPer100: result.delta.bbPer100Hands,
    confidence95Chips: result.delta.confidence95Chips,
    wins: result.delta.wins,
    losses: result.delta.losses,
    ties: result.delta.ties,
  }
})

process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`)

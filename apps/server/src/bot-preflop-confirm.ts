import { DEFAULT_STAKE, personalityPool } from '@river/engine'
import { runPairedBotBenchmark } from './bot-benchmark.js'
import { legacyGuardPolicy as pokerGuardPolicy } from './bot-poker-guard.js'
import { pokerStrongCandidatePolicy } from './bot-poker-strong.js'

const pool = personalityPool()
const nineSeat = process.argv.includes('--nine-seat')
const cases = nineSeat
  ? [
      { name: 'mixed-nine', cast: [9, 0, 1, 4, 5, 6, 10, 11, 2] },
      { name: 'tough-nine', cast: [9, 10, 11, 12, 4, 5, 6, 7, 8] },
    ]
  : [
      { name: 'mixed-eight', cast: [9, 0, 1, 4, 5, 6, 10, 11] },
      { name: 'tough-eight', cast: [9, 10, 11, 12, 4, 5, 6, 7] },
    ]
const parts = nineSeat
  ? ['nine-seat-eval-a', 'nine-seat-eval-b']
  : process.argv.includes('--held-out')
    ? ['heldout-c', 'heldout-d']
    : ['confirmation-a', 'confirmation-b']
const pairedDeltas: number[] = []

const reports = cases.flatMap(({ name, cast }) =>
  parts.map((part) => {
    const seats = cast.map((index) => {
      const personality = pool[index]
      if (personality === undefined) throw new Error('confirmation cast missing')
      return { personality }
    })
    const result = runPairedBotBenchmark({
      seed: `strong-preflop-${name}-${part}`,
      hands: 2_500,
      seats,
      baseline: pokerGuardPolicy,
      candidate: pokerStrongCandidatePolicy,
      focalEntrant: 0,
    })
    pairedDeltas.push(...result.pairs.map((pair) => pair.deltaChips))
    return {
      table: name,
      seed: part,
      hands: result.hands,
      baselineBigBlindsPer100: result.baseline.seats[0]?.bbPer100Hands,
      candidateBigBlindsPer100: result.candidate.seats[0]?.bbPer100Hands,
      deltaBigBlindsPer100: result.delta.bbPer100Hands,
      confidence95Chips: result.delta.confidence95Chips,
      wins: result.delta.wins,
      losses: result.delta.losses,
      ties: result.delta.ties,
    }
  }),
)

const meanChips = pairedDeltas.reduce((sum, delta) => sum + delta, 0) / pairedDeltas.length
const sampleVariance =
  pairedDeltas.reduce((sum, delta) => sum + (delta - meanChips) ** 2, 0) / (pairedDeltas.length - 1)
const confidenceRadius = 1.96 * Math.sqrt(sampleVariance / pairedDeltas.length)
const aggregate = {
  hands: pairedDeltas.length,
  meanChips,
  deltaBigBlindsPer100: (meanChips / DEFAULT_STAKE.bigBlind) * 100,
  confidence95Chips: [meanChips - confidenceRadius, meanChips + confidenceRadius],
}

process.stdout.write(`${JSON.stringify({ reports, aggregate }, null, 2)}\n`)

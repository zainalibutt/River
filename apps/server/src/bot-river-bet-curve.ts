import {
  enumerateRiverBetEvidence,
  inferRiverStyleWeights,
  riverShareAfterBet,
  trainRiverBetRateModel,
} from './bot-river-bet-model.js'
import {
  generateRiverBettingScenarios,
  type RiverBettorStyle,
  sampleRiverPublicBetHistory,
} from './bot-river-scenarios.js'

const model = trainRiverBetRateModel('river-bet-fit-v1', 2_000)
const styles: readonly RiverBettorStyle[] = ['value', 'balanced', 'overbluff', 'polarized']
const historyLengths = [0, 4, 12, 24, 64] as const
const count = 200

const reports = styles.map((style) => {
  const seed = `river-learning-curve-${style}`
  const cases = generateRiverBettingScenarios({
    seed,
    count,
    style,
    historyOpportunities: 0,
  })
  const scores = cases.map(({ observation, oracle }, index) => {
    const evidence = enumerateRiverBetEvidence(observation, model)
    if (evidence === null) throw new Error('learning-curve spot unsupported')
    const price = observation.amountToCall / (observation.pot + observation.amountToCall)
    const callPayoff =
      oracle.callPotShare * (observation.pot + observation.amountToCall) - observation.amountToCall
    return historyLengths.map((length) => {
      const history = sampleRiverPublicBetHistory(style, `${seed}:history:${index}`, length)
      const prediction = riverShareAfterBet(evidence, inferRiverStyleWeights(model, history))
      return {
        payoff: prediction > price ? callPayoff : 0,
        squareError: (prediction - oracle.callPotShare) ** 2,
      }
    })
  })
  const cold = scores.map((row) => row[0]?.payoff ?? 0)
  return {
    style,
    cases: count,
    byPriorOpportunities: historyLengths.map((length, index) => {
      const payoff = scores.map((row) => row[index]?.payoff ?? 0)
      const deltas = payoff.map((value, caseIndex) => value - (cold[caseIndex] ?? 0))
      const mean = deltas.reduce((sum, value) => sum + value, 0) / count
      const variance = deltas.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (count - 1)
      const radius = 1.96 * Math.sqrt(variance / count)
      return {
        opportunities: length,
        meanPayoff: payoff.reduce((sum, value) => sum + value, 0) / count,
        meanSquareError:
          scores.reduce((sum, row) => sum + (row[index]?.squareError ?? 0), 0) / count,
        payoffMinusNoHistory: mean,
        deltaConfidence95: [mean - radius, mean + radius],
      }
    }),
  }
})

process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`)

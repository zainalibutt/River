import {
  enumerateRiverBetEvidence,
  inferRiverStyleWeights,
  type RiverStyleWeights,
  riverShareAfterBet,
  trainRiverBetRateModel,
} from './bot-river-bet-model.js'
import { generateRiverBettingScenarios } from './bot-river-scenarios.js'

const shiftStyle = process.argv.includes('--camouflaged')
  ? 'camouflaged'
  : process.argv.includes('--polarized')
    ? 'polarized'
    : process.argv.includes('--pair-disguise')
      ? 'pair-disguise'
      : 'pair-pressure'
const rows = generateRiverBettingScenarios({
  seed: `river-bet-shift-${shiftStyle}`,
  count: 600,
  style: shiftStyle,
})
const model = trainRiverBetRateModel('river-bet-fit-v1', 2_000)
const staticWeights: RiverStyleWeights = { value: 1 / 3, balanced: 1 / 3, overbluff: 1 / 3 }
const results = rows.map(({ observation, publicHistory, oracle }) => {
  const evidence = enumerateRiverBetEvidence(observation, model)
  if (evidence === null) throw new Error('shift river spot unsupported')
  const price = observation.amountToCall / (observation.pot + observation.amountToCall)
  const staticPrediction = riverShareAfterBet(evidence, staticWeights)
  const adaptivePrediction = riverShareAfterBet(
    evidence,
    inferRiverStyleWeights(model, publicHistory),
  )
  const callPayoff =
    oracle.callPotShare * (observation.pot + observation.amountToCall) - observation.amountToCall
  return {
    outcome: oracle.callPotShare,
    staticPrediction,
    adaptivePrediction,
    staticPayoff: staticPrediction > price ? callPayoff : 0,
    adaptivePayoff: adaptivePrediction > price ? callPayoff : 0,
    alwaysCallPayoff: callPayoff,
  }
})
const mean = (values: readonly number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length
const deltas = results.map((row) => row.adaptivePayoff - row.staticPayoff)
const deltaMean = mean(deltas)
const variance =
  deltas.reduce((sum, delta) => sum + (delta - deltaMean) ** 2, 0) / (deltas.length - 1)
const radius = 1.96 * Math.sqrt(variance / deltas.length)
process.stdout.write(
  `${JSON.stringify(
    {
      shiftStyle,
      cases: results.length,
      staticMse: mean(results.map((row) => (row.staticPrediction - row.outcome) ** 2)),
      adaptiveMse: mean(results.map((row) => (row.adaptivePrediction - row.outcome) ** 2)),
      staticMeanPayoff: mean(results.map((row) => row.staticPayoff)),
      adaptiveMeanPayoff: mean(results.map((row) => row.adaptivePayoff)),
      alwaysCallMeanPayoff: mean(results.map((row) => row.alwaysCallPayoff)),
      adaptiveMinusStaticPayoff: deltaMean,
      deltaConfidence95: [deltaMean - radius, deltaMean + radius],
    },
    null,
    2,
  )}\n`,
)

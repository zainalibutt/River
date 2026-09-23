import {
  enumerateRiverBetEvidence,
  inferRiverStyleWeights,
  riverShareAfterBet,
} from './bot-river-bet-model.js'
import type { RiverBettorStyle } from './bot-river-scenarios.js'
import {
  enumerateSizedRiverBetEvidence,
  inferRiverStyleWeightsFromSizeHistory,
  trainRiverBetSizeModel,
} from './bot-river-size-model.js'
import {
  generateSizedRiverScenarios,
  riverBetSizeFromObservation,
} from './bot-river-size-scenarios.js'

const model = trainRiverBetSizeModel('river-size-fit-v1', 2_000)
const styles: readonly RiverBettorStyle[] = process.argv.includes('--history-all')
  ? [
      'value',
      'balanced',
      'overbluff',
      'camouflaged',
      'polarized',
      'size-camouflaged',
      'reverse-sizing',
    ]
  : process.argv.includes('--reverse-sizing')
    ? ['reverse-sizing']
    : process.argv.includes('--size-camouflaged')
      ? ['size-camouflaged']
      : ['value', 'balanced', 'overbluff', 'camouflaged', 'polarized']
const count = 250

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

const reports = styles.map((style) => {
  const scenarios = generateSizedRiverScenarios({
    seed: `river-size-heldout-${style}`,
    count,
    style,
  })
  const rows = scenarios.map(({ observation, publicHistory, oracle }) => {
    const blind = enumerateRiverBetEvidence(observation, model.base)
    const aware = enumerateSizedRiverBetEvidence(observation, model)
    if (blind === null || aware === null) throw new Error('sized river spot unsupported')
    const size = riverBetSizeFromObservation(observation)
    if (size === null) throw new Error('size missing from public action')
    const weights = inferRiverStyleWeights(model.base, publicHistory)
    const historyWeights = inferRiverStyleWeightsFromSizeHistory(model, publicHistory)
    const blindPrediction = riverShareAfterBet(blind, weights)
    const awarePrediction = riverShareAfterBet(aware, weights)
    const historyPrediction = riverShareAfterBet(aware, historyWeights)
    const price = observation.amountToCall / (observation.pot + observation.amountToCall)
    const callPayoff =
      oracle.callPotShare * (observation.pot + observation.amountToCall) - observation.amountToCall
    return {
      size,
      blindSquareError: (blindPrediction - oracle.callPotShare) ** 2,
      awareSquareError: (awarePrediction - oracle.callPotShare) ** 2,
      historySquareError: (historyPrediction - oracle.callPotShare) ** 2,
      blindPayoff: blindPrediction > price ? callPayoff : 0,
      awarePayoff: awarePrediction > price ? callPayoff : 0,
      historyPayoff: historyPrediction > price ? callPayoff : 0,
    }
  })
  const deltas = rows.map((row) => row.awarePayoff - row.blindPayoff)
  const deltaMean = mean(deltas)
  const variance = deltas.reduce((sum, value) => sum + (value - deltaMean) ** 2, 0) / (count - 1)
  const radius = 1.96 * Math.sqrt(variance / count)
  const historyDeltas = rows.map((row) => row.historyPayoff - row.awarePayoff)
  const historyDeltaMean = mean(historyDeltas)
  const historyVariance =
    historyDeltas.reduce((sum, value) => sum + (value - historyDeltaMean) ** 2, 0) / (count - 1)
  const historyRadius = 1.96 * Math.sqrt(historyVariance / count)
  return {
    style,
    cases: count,
    sizes: {
      small: rows.filter((row) => row.size === 'small').length,
      medium: rows.filter((row) => row.size === 'medium').length,
      large: rows.filter((row) => row.size === 'large').length,
    },
    blindMse: mean(rows.map((row) => row.blindSquareError)),
    awareMse: mean(rows.map((row) => row.awareSquareError)),
    historyMse: mean(rows.map((row) => row.historySquareError)),
    blindMeanPayoff: mean(rows.map((row) => row.blindPayoff)),
    awareMeanPayoff: mean(rows.map((row) => row.awarePayoff)),
    historyMeanPayoff: mean(rows.map((row) => row.historyPayoff)),
    awareMinusBlindPayoff: deltaMean,
    deltaConfidence95: [deltaMean - radius, deltaMean + radius],
    historyMinusCurrentSizePayoff: historyDeltaMean,
    historyDeltaConfidence95: [historyDeltaMean - historyRadius, historyDeltaMean + historyRadius],
  }
})

process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`)

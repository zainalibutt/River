import {
  enumerateRiverBetEvidence,
  inferRiverStyleWeights,
  type RiverStyleWeights,
  riverShareAfterBet,
  trainRiverBetRateModel,
} from './bot-river-bet-model.js'
import { generateRiverBettingScenarios, type RiverBettorStyle } from './bot-river-scenarios.js'

const split = process.argv.includes('--held-out') ? 'held-out' : 'development'
const count = process.argv.includes('--held-out') ? 400 : 160
const model = trainRiverBetRateModel('river-bet-fit-v1', 2_000)
const staticWeights: RiverStyleWeights = { value: 1 / 3, balanced: 1 / 3, overbluff: 1 / 3 }
const styles: readonly RiverBettorStyle[] = ['value', 'balanced', 'overbluff']

interface Score {
  readonly outcome: number
  readonly staticPrediction: number
  readonly adaptivePrediction: number
  readonly oraclePrediction: number
  readonly staticPayoff: number
  readonly adaptivePayoff: number
  readonly oraclePayoff: number
  readonly staticCall: boolean
  readonly adaptiveCall: boolean
  readonly oracleCall: boolean
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function summarise(rows: readonly Score[]) {
  const delta = rows.map((row) => row.adaptivePayoff - row.staticPayoff)
  const mean = average(delta)
  const squared = delta.reduce((sum, value) => sum + (value - mean) ** 2, 0)
  const radius = 1.96 * Math.sqrt(squared / (delta.length - 1) / delta.length)
  return {
    cases: rows.length,
    staticMse: average(rows.map((row) => (row.staticPrediction - row.outcome) ** 2)),
    adaptiveMse: average(rows.map((row) => (row.adaptivePrediction - row.outcome) ** 2)),
    oracleMse: average(rows.map((row) => (row.oraclePrediction - row.outcome) ** 2)),
    staticMeanPayoff: average(rows.map((row) => row.staticPayoff)),
    adaptiveMeanPayoff: average(rows.map((row) => row.adaptivePayoff)),
    oracleMeanPayoff: average(rows.map((row) => row.oraclePayoff)),
    adaptiveMinusStaticPayoff: mean,
    deltaConfidence95: [mean - radius, mean + radius],
    staticCalls: rows.filter((row) => row.staticCall).length,
    adaptiveCalls: rows.filter((row) => row.adaptiveCall).length,
    oracleCalls: rows.filter((row) => row.oracleCall).length,
  }
}

const byStyle = styles.map((style) => {
  const cases = generateRiverBettingScenarios({
    seed: `river-bet-${split}-${style}`,
    count,
    style,
  })
  const scores = cases.map(({ observation, publicHistory, oracle }) => {
    const evidence = enumerateRiverBetEvidence(observation, model)
    if (evidence === null) throw new Error('generated river spot unsupported')
    const staticPrediction = riverShareAfterBet(evidence, staticWeights)
    const adaptivePrediction = riverShareAfterBet(
      evidence,
      inferRiverStyleWeights(model, publicHistory),
    )
    const oracleWeights: RiverStyleWeights = {
      value: Number(style === 'value'),
      balanced: Number(style === 'balanced'),
      overbluff: Number(style === 'overbluff'),
    }
    const oraclePrediction = riverShareAfterBet(evidence, oracleWeights)
    const price = observation.amountToCall / (observation.pot + observation.amountToCall)
    const payoff =
      oracle.callPotShare * (observation.pot + observation.amountToCall) - observation.amountToCall
    const staticCall = staticPrediction > price
    const adaptiveCall = adaptivePrediction > price
    const oracleCall = oraclePrediction > price
    return {
      outcome: oracle.callPotShare,
      staticPrediction,
      adaptivePrediction,
      oraclePrediction,
      staticPayoff: staticCall ? payoff : 0,
      adaptivePayoff: adaptiveCall ? payoff : 0,
      oraclePayoff: oracleCall ? payoff : 0,
      staticCall,
      adaptiveCall,
      oracleCall,
    }
  })
  return { style, ...summarise(scores), scores }
})

const aggregate = summarise(byStyle.flatMap(({ scores }) => scores))
process.stdout.write(
  `${JSON.stringify(
    {
      split,
      trainedBetRates: model.betRates,
      byStyle: byStyle.map(({ scores: _scores, ...result }) => result),
      aggregate,
    },
    null,
    2,
  )}\n`,
)

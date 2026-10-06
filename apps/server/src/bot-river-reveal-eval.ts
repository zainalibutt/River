import {
  enumerateRiverBetEvidence,
  inferRiverStyleWeights,
  inferRiverStyleWeightsWithReveals,
  riverShareAfterBet,
  trainRiverBetRateModel,
} from './bot-river-bet-model.js'
import {
  generateRiverBettingScenarios,
  type RiverBettorStyle,
  type RiverRevealSelection,
  sampleRiverPublicBetHistory,
} from './bot-river-scenarios.js'

const model = trainRiverBetRateModel('river-bet-fit-v1', 2_000)
const styles: readonly RiverBettorStyle[] = ['value', 'balanced', 'overbluff', 'camouflaged']
const revealCases: readonly {
  readonly name: string
  readonly rate: number
  readonly selection: RiverRevealSelection
}[] = [
  { name: 'none', rate: 0, selection: 'uniform' },
  { name: 'uniform-quarter', rate: 0.25, selection: 'uniform' },
  { name: 'made-biased-quarter', rate: 0.25, selection: 'made-biased' },
  { name: 'uniform-all', rate: 1, selection: 'uniform' },
]
const count = 300
const historyOpportunities = 24

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

const reports = styles.map((style) => {
  const seed = `river-reveal-heldout-${style}`
  const scenarios = generateRiverBettingScenarios({
    seed,
    count,
    style,
    historyOpportunities: 0,
  })
  const rows = scenarios.map(({ observation, oracle }, index) => {
    const evidence = enumerateRiverBetEvidence(observation, model)
    if (evidence === null) throw new Error('reveal scenario unsupported')
    const price = observation.amountToCall / (observation.pot + observation.amountToCall)
    const callPayoff =
      oracle.callPotShare * (observation.pot + observation.amountToCall) - observation.amountToCall
    const histories = revealCases.map(({ rate, selection }) =>
      sampleRiverPublicBetHistory(
        style,
        `${seed}:history:${index}`,
        historyOpportunities,
        rate,
        selection,
      ),
    )
    const firstHistory = histories[0]
    if (firstHistory === undefined) throw new Error('missing count-only history')
    const countOnly = riverShareAfterBet(evidence, inferRiverStyleWeights(model, firstHistory))
    const countOnlyPayoff = countOnly > price ? callPayoff : 0
    return revealCases.map(({ name, rate }, rateIndex) => {
      const history = histories[rateIndex]
      if (history === undefined) throw new Error('missing revealed history')
      const prediction = riverShareAfterBet(
        evidence,
        inferRiverStyleWeightsWithReveals(model, history),
      )
      return {
        name,
        rate,
        revealedBets: history.revealedBetCategories?.length ?? 0,
        squareError: (prediction - oracle.callPotShare) ** 2,
        payoff: prediction > price ? callPayoff : 0,
        countOnlyPayoff,
      }
    })
  })
  return {
    style,
    cases: count,
    byRevealCase: revealCases.map(({ name, rate }, index) => {
      const results = rows.map((row) => {
        const result = row[index]
        if (result === undefined) throw new Error('missing reveal result')
        return result
      })
      const deltas = results.map((result) => result.payoff - result.countOnlyPayoff)
      const deltaMean = mean(deltas)
      const variance =
        deltas.reduce((sum, value) => sum + (value - deltaMean) ** 2, 0) / (count - 1)
      const radius = 1.96 * Math.sqrt(variance / count)
      return {
        name,
        rate,
        meanRevealedBets: mean(results.map((result) => result.revealedBets)),
        meanSquareError: mean(results.map((result) => result.squareError)),
        meanPayoff: mean(results.map((result) => result.payoff)),
        payoffMinusCountOnly: deltaMean,
        deltaConfidence95: [deltaMean - radius, deltaMean + radius],
      }
    }),
  }
})

process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`)

import {
  type BotObservationV1,
  type Card,
  cardKey,
  compareRanks,
  evaluateBest,
  HandCategory,
  makeDeck,
  summarisePublicActions,
} from '@river/engine'
import {
  type RiverPublicBetHistory,
  sampleRiverBetTrainingExamples,
} from './bot-river-scenarios.js'

export const RIVER_BET_MODEL_STYLES = ['value', 'balanced', 'overbluff'] as const
export type RiverBetHypothesis = (typeof RIVER_BET_MODEL_STYLES)[number]
export type RiverBetBucket = 'highCard' | 'pair' | 'made'

export const RIVER_BET_MODEL_TUNING = {
  trainingOpportunitiesPerStyle: 2_000,
  smoothingPseudoBets: 1,
  smoothingPseudoChecks: 1,
} as const

export interface RiverBetRateModel {
  readonly version: 1
  readonly trainedOpportunitiesPerStyle: number
  readonly betRates: Readonly<Record<RiverBetHypothesis, number>>
  readonly likelihoodByBucket: Readonly<
    Record<RiverBetHypothesis, Readonly<Record<RiverBetBucket, number>>>
  >
}

export type RiverStyleWeights = Readonly<Record<RiverBetHypothesis, number>>

export interface RiverBetEvidence {
  readonly combinations: number
  readonly byStyle: Readonly<
    Record<RiverBetHypothesis, { readonly betMass: number; readonly showdownShareMass: number }>
  >
}

export function trainRiverBetRateModel(
  seed: string,
  opportunities: number = RIVER_BET_MODEL_TUNING.trainingOpportunitiesPerStyle,
): RiverBetRateModel {
  if (!Number.isSafeInteger(opportunities) || opportunities < 1 || opportunities > 20_000) {
    throw new Error('training opportunities must be between 1 and 20000')
  }
  const fit = (style: RiverBetHypothesis) => {
    const examples = sampleRiverBetTrainingExamples(style, `${seed}:${style}`, opportunities)
    const counts = {
      highCard: { bets: 0, opportunities: 0 },
      pair: { bets: 0, opportunities: 0 },
      made: { bets: 0, opportunities: 0 },
    }
    let totalBets = 0
    for (const example of examples) {
      const cell = counts[riverBetBucket(example.category)]
      cell.opportunities += 1
      if (example.bet) {
        cell.bets += 1
        totalBets += 1
      }
    }
    const smooth = (bets: number, total: number) =>
      (bets + RIVER_BET_MODEL_TUNING.smoothingPseudoBets) /
      (total +
        RIVER_BET_MODEL_TUNING.smoothingPseudoBets +
        RIVER_BET_MODEL_TUNING.smoothingPseudoChecks)
    return {
      betRate: smooth(totalBets, opportunities),
      buckets: {
        highCard: smooth(counts.highCard.bets, counts.highCard.opportunities),
        pair: smooth(counts.pair.bets, counts.pair.opportunities),
        made: smooth(counts.made.bets, counts.made.opportunities),
      },
    }
  }
  const value = fit('value')
  const balanced = fit('balanced')
  const overbluff = fit('overbluff')
  return {
    version: 1,
    trainedOpportunitiesPerStyle: opportunities,
    betRates: {
      value: value.betRate,
      balanced: balanced.betRate,
      overbluff: overbluff.betRate,
    },
    likelihoodByBucket: {
      value: value.buckets,
      balanced: balanced.buckets,
      overbluff: overbluff.buckets,
    },
  }
}

export function riverBetBucket(category: HandCategory): RiverBetBucket {
  if (category === HandCategory.HIGH_CARD) return 'highCard'
  return category === HandCategory.PAIR ? 'pair' : 'made'
}

export function inferRiverStyleWeights(
  model: RiverBetRateModel,
  history: RiverPublicBetHistory,
): RiverStyleWeights {
  if (
    !Number.isSafeInteger(history.opportunities) ||
    !Number.isSafeInteger(history.bets) ||
    history.opportunities < 0 ||
    history.bets < 0 ||
    history.bets > history.opportunities
  ) {
    throw new Error('river bet history must contain valid public counts')
  }
  const scores = RIVER_BET_MODEL_STYLES.map((style) => {
    const rate = model.betRates[style]
    if (!(rate > 0 && rate < 1)) throw new Error('river bet rate must be between zero and one')
    return (
      history.bets * Math.log(rate) + (history.opportunities - history.bets) * Math.log1p(-rate)
    )
  })
  return normaliseRiverScores(scores)
}

export function inferRiverStyleWeightsWithReveals(
  model: RiverBetRateModel,
  history: RiverPublicBetHistory,
): RiverStyleWeights {
  const base = inferRiverStyleWeights(model, history)
  const revealed = history.revealedBetCategories ?? []
  if (revealed.length > history.bets) throw new Error('revealed bets exceed public bets')
  if (revealed.length === 0) return base
  const scores = RIVER_BET_MODEL_STYLES.map((style) => {
    let score = Math.log(base[style])
    for (const category of revealed) {
      if (
        !Number.isSafeInteger(category) ||
        category < 0 ||
        category > HandCategory.STRAIGHT_FLUSH
      ) {
        throw new Error('invalid publicly revealed hand category')
      }
      const likelihood = model.likelihoodByBucket[style][riverBetBucket(category)]
      if (!(likelihood > 0 && likelihood <= 1)) {
        throw new Error('invalid learned river bet likelihood')
      }
      score += Math.log(likelihood) - Math.log(model.betRates[style])
    }
    return score
  })
  return normaliseRiverScores(scores)
}

function normaliseRiverScores(scores: readonly number[]): RiverStyleWeights {
  const maximum = Math.max(...scores)
  const unnormalised = scores.map((score) => Math.exp(score - maximum))
  const total = unnormalised.reduce((sum, value) => sum + value, 0)
  return {
    value: (unnormalised[0] as number) / total,
    balanced: (unnormalised[1] as number) / total,
    overbluff: (unnormalised[2] as number) / total,
  }
}

export function enumerateRiverBetEvidence(
  observation: BotObservationV1,
  model: RiverBetRateModel,
): RiverBetEvidence | null {
  const { actor, board, seats, legal } = observation
  const active = seats.filter((seat) => seat.playerId !== null && !seat.folded)
  const opponent = active.find((seat) => seat.seat !== actor.seat)
  const summary = observation.actions && summarisePublicActions(observation.actions, 'river')
  if (
    observation.street !== 'river' ||
    board.length !== 5 ||
    actor.hole.length !== 2 ||
    new Set([...actor.hole, ...board].map(cardKey)).size !== 7 ||
    active.length !== 2 ||
    active.some((seat) => seat.allIn) ||
    !legal.fold ||
    !legal.call.enabled ||
    legal.call.amount !== observation.amountToCall ||
    observation.amountToCall <= 0 ||
    actor.stack < observation.amountToCall ||
    !Number.isSafeInteger(observation.pot) ||
    observation.pot <= observation.amountToCall ||
    !Number.isSafeInteger(observation.amountToCall) ||
    !Number.isSafeInteger(observation.currentBet) ||
    observation.currentBet - actor.betStreet !== observation.amountToCall ||
    opponent === undefined ||
    opponent.betStreet !== observation.currentBet ||
    summary?.lastAggressorSeat !== opponent.seat ||
    summary.raisesThisStreet !== 1
  ) {
    return null
  }
  const blocked = new Set([...actor.hole, ...board].map(cardKey))
  const remaining = makeDeck().filter((card) => !blocked.has(cardKey(card)))
  const heroRank = evaluateBest([...actor.hole, ...board])
  const betMass = { value: 0, balanced: 0, overbluff: 0 }
  const showdownShareMass = { value: 0, balanced: 0, overbluff: 0 }
  let combinations = 0
  for (let first = 0; first < remaining.length - 1; first += 1) {
    for (let second = first + 1; second < remaining.length; second += 1) {
      const villainHole = [remaining[first] as Card, remaining[second] as Card]
      const villainRank = evaluateBest([...villainHole, ...board])
      const comparison = compareRanks(heroRank, villainRank)
      const share = comparison > 0 ? 1 : comparison === 0 ? 0.5 : 0
      const bucket = riverBetBucket(villainRank.category)
      for (const style of RIVER_BET_MODEL_STYLES) {
        const likelihood = model.likelihoodByBucket[style][bucket]
        if (!Number.isFinite(likelihood) || likelihood < 0 || likelihood > 1) {
          throw new Error('invalid learned river bet likelihood')
        }
        betMass[style] += likelihood
        showdownShareMass[style] += likelihood * share
      }
      combinations += 1
    }
  }
  return {
    combinations,
    byStyle: {
      value: { betMass: betMass.value, showdownShareMass: showdownShareMass.value },
      balanced: { betMass: betMass.balanced, showdownShareMass: showdownShareMass.balanced },
      overbluff: { betMass: betMass.overbluff, showdownShareMass: showdownShareMass.overbluff },
    },
  }
}

export function riverShareAfterBet(
  evidence: RiverBetEvidence,
  styleWeights: RiverStyleWeights,
): number {
  let betMass = 0
  let showdownShareMass = 0
  for (const style of RIVER_BET_MODEL_STYLES) {
    const weight = styleWeights[style]
    if (!Number.isFinite(weight) || weight < 0) throw new Error('invalid style weight')
    betMass += weight * evidence.byStyle[style].betMass
    showdownShareMass += weight * evidence.byStyle[style].showdownShareMass
  }
  if (!(betMass > 0)) throw new Error('bet-conditioned range has no compatible hands')
  return showdownShareMass / betMass
}

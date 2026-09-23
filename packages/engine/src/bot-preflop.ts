import type { Card } from './cards.js'
import { rankValue } from './cards.js'

export const BOT_PREFLOP_SCORE_TUNING = {
  pairBase: 0.42,
  pairRankSpan: 0.53,
  highCardWeight: 0.4,
  lowCardWeight: 0.18,
  suitedBonus: 0.07,
  connectorBonus: 0.06,
  oneGapBonus: 0.03,
  broadwayBonus: 0.09,
  premiumAceBonus: 0.045,
  maximumOpenShoveStackToPot: 3,
  maximumCandidateBluffRate: 0.08,
  minimumFacingAllInScore: 0.65,
} as const

export function preflopHandStrengthV2(hole: readonly Card[]): number {
  if (hole.length !== 2) throw new Error('preflop score needs exactly two hole cards')
  const high = Math.max(rankValue(hole[0]?.rank ?? '2'), rankValue(hole[1]?.rank ?? '2'))
  const low = Math.min(rankValue(hole[0]?.rank ?? '2'), rankValue(hole[1]?.rank ?? '2'))
  if (high === low) {
    return (
      BOT_PREFLOP_SCORE_TUNING.pairBase + ((high - 2) / 12) * BOT_PREFLOP_SCORE_TUNING.pairRankSpan
    )
  }
  const gap = high - low - 1
  const score =
    (Math.max(0, high - 7) / 7) * BOT_PREFLOP_SCORE_TUNING.highCardWeight +
    ((low - 2) / 12) * BOT_PREFLOP_SCORE_TUNING.lowCardWeight +
    (hole[0]?.suit === hole[1]?.suit ? BOT_PREFLOP_SCORE_TUNING.suitedBonus : 0) +
    (gap === 0
      ? BOT_PREFLOP_SCORE_TUNING.connectorBonus
      : gap === 1
        ? BOT_PREFLOP_SCORE_TUNING.oneGapBonus
        : 0) +
    (low >= 10 ? BOT_PREFLOP_SCORE_TUNING.broadwayBonus : 0) +
    (high === 14 && low >= 12 ? BOT_PREFLOP_SCORE_TUNING.premiumAceBonus : 0)
  return Math.min(1, score)
}

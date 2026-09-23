import { type BotDecision, type BotPolicy, personalityPool, rankValue } from '@river/engine'
import type { BenchmarkSeat } from './bot-benchmark.js'

export type NovelStyle = 'selective-bluffer' | 'pot-odds-chaser' | 'slow-player' | 'volatile-caller'

export const NOVEL_STYLES: readonly NovelStyle[] = [
  'selective-bluffer',
  'pot-odds-chaser',
  'slow-player',
  'volatile-caller',
]

function novelPolicy(style: NovelStyle): BotPolicy {
  return {
    id: `authored-novel-${style}`,
    version: 1,
    decide(context) {
      const { observation, rng } = context
      const { legal, amountToCall, pot, actor, street } = observation
      const roll = rng()
      const highCard = Math.max(...actor.hole.map((card) => rankValue(card.rank)))
      const pair = actor.hole.length === 2 && actor.hole[0]?.rank === actor.hole[1]?.rank
      const suited = actor.hole.length === 2 && actor.hole[0]?.suit === actor.hole[1]?.suit
      const price = amountToCall / Math.max(1, pot + amountToCall)
      const raise = (fraction: number): BotDecision => ({
        kind: 'raiseTo',
        to: Math.min(
          legal.raiseTo.max,
          Math.max(legal.raiseTo.min, observation.currentBet + Math.round(pot * fraction)),
        ),
      })
      let decision: BotDecision
      if (style === 'selective-bluffer') {
        const strong = pair || highCard >= 13
        const bluff = !strong && roll < (street === 'river' ? 0.15 : 0.08)
        decision =
          legal.raiseTo.enabled && (strong || bluff)
            ? raise(bluff ? 0.75 : 0.5)
            : amountToCall > 0
              ? strong || price < 0.12
                ? { kind: 'call' }
                : { kind: 'fold' }
              : { kind: 'check' }
      } else if (style === 'pot-odds-chaser') {
        const draw = suited || highCard >= 11
        decision =
          amountToCall > 0
            ? draw && price < 0.28
              ? { kind: 'call' }
              : { kind: 'fold' }
            : legal.raiseTo.enabled && pair && roll < 0.35
              ? raise(0.33)
              : { kind: 'check' }
      } else if (style === 'slow-player') {
        const strong = pair || highCard === 14
        decision =
          amountToCall > 0
            ? strong || price < 0.09
              ? { kind: 'call' }
              : { kind: 'fold' }
            : legal.raiseTo.enabled && street === 'river' && strong && roll < 0.5
              ? raise(0.66)
              : { kind: 'check' }
      } else {
        decision =
          legal.raiseTo.enabled && roll < (highCard >= 12 ? 0.38 : 0.14)
            ? raise(roll < 0.07 ? 1 : 0.4)
            : amountToCall > 0
              ? roll < (price < 0.2 ? 0.78 : 0.43)
                ? { kind: 'call' }
                : { kind: 'fold' }
              : { kind: 'check' }
      }
      return {
        policyId: this.id,
        policyVersion: this.version,
        observationVersion: observation.version,
        decision,
        fallbackReason: null,
      }
    },
  }
}

export function authoredNovelSeats(indices: readonly number[]): readonly BenchmarkSeat[] {
  if (indices.length !== NOVEL_STYLES.length || new Set(indices).size !== NOVEL_STYLES.length) {
    throw new Error('novel corpus needs four distinct cast identities')
  }
  const cast = personalityPool()
  return indices.map((index, seat) => {
    const personality = cast[index]
    const style = NOVEL_STYLES[seat]
    if (personality === undefined || style === undefined)
      throw new Error('novel corpus cast missing')
    return { personality, policy: novelPolicy(style) }
  })
}

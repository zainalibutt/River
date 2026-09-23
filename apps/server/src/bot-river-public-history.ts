import { evaluateBest, type HandCategory } from '@river/engine'
import {
  type BenchmarkCompletedHand,
  type BenchmarkDecision,
  type BenchmarkOptions,
  runBotBenchmark,
} from './bot-benchmark.js'
import type { RiverPublicBetHistory } from './bot-river-scenarios.js'
import { type RiverBetSize, riverBetSizeFromRatio } from './bot-river-size-scenarios.js'

interface PublicRiverOpportunity {
  readonly handIndex: number
  readonly playerId: string
  readonly action: 'check' | 'bet'
  readonly size: RiverBetSize | null
  revealedCategory: HandCategory | null
}

export class RiverPublicHistoryCollector {
  private readonly opportunities: PublicRiverOpportunity[] = []

  onAcceptedDecision({ handIndex, actorId, observation, action }: BenchmarkDecision): void {
    const active = observation.seats.filter((seat) => seat.playerId !== null && !seat.folded)
    if (
      observation.street !== 'river' ||
      active.length !== 2 ||
      active.some((seat) => seat.allIn) ||
      observation.currentBet !== 0 ||
      observation.amountToCall !== 0 ||
      !observation.legal.check ||
      observation.pot <= 0 ||
      this.opportunities.some((row) => row.handIndex === handIndex && row.playerId === actorId)
    ) {
      return
    }
    if (action.kind === 'check') {
      this.opportunities.push({
        handIndex,
        playerId: actorId,
        action: 'check',
        size: null,
        revealedCategory: null,
      })
      return
    }
    const committed =
      action.kind === 'raiseTo'
        ? action.to - observation.actor.betStreet
        : action.kind === 'allIn'
          ? observation.actor.stack
          : null
    if (committed === null) return
    const size = riverBetSizeFromRatio(committed / observation.pot)
    if (size === null) return
    this.opportunities.push({
      handIndex,
      playerId: actorId,
      action: 'bet',
      size,
      revealedCategory: null,
    })
  }

  onPublicHandComplete({ handIndex, view }: BenchmarkCompletedHand): void {
    if (!view.revealed || view.board.length !== 5) return
    for (const row of this.opportunities) {
      if (row.handIndex !== handIndex || row.action !== 'bet') continue
      const hole = view.seats.find((seat) => seat.playerId === row.playerId)?.hole
      if (hole?.length !== 2) continue
      row.revealedCategory = evaluateBest([...hole, ...view.board]).category
    }
  }

  historyBefore(playerId: string, handIndex: number): RiverPublicBetHistory {
    const rows = this.opportunities.filter(
      (row) => row.playerId === playerId && row.handIndex < handIndex,
    )
    const sizeCounts = { small: 0, medium: 0, large: 0 }
    const revealedBetCategories: HandCategory[] = []
    for (const row of rows) {
      if (row.size !== null) sizeCounts[row.size] += 1
      if (row.revealedCategory !== null) revealedBetCategories.push(row.revealedCategory)
    }
    return {
      opportunities: rows.length,
      bets: rows.filter((row) => row.action === 'bet').length,
      sizeCounts,
      revealedBetCategories,
    }
  }
}

export function collectBenchmarkRiverPublicHistory(
  options: BenchmarkOptions,
): RiverPublicHistoryCollector {
  const collector = new RiverPublicHistoryCollector()
  runBotBenchmark({
    ...options,
    onDecision(decision) {
      collector.onAcceptedDecision(decision)
      options.onDecision?.(decision)
    },
    onHandComplete(hand) {
      collector.onPublicHandComplete(hand)
      options.onHandComplete?.(hand)
    },
  })
  return collector
}

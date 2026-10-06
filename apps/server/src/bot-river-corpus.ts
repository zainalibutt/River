import {
  type BotObservationV1,
  type Card,
  compareRanks,
  evaluateBest,
  type TurnAction,
} from '@river/engine'
import { type BenchmarkOptions, runBotBenchmark } from './bot-benchmark.js'

export type RiverLabelStatus = 'revealed_call' | 'unrevealed_call' | 'not_called'

export interface RiverDecisionExample {
  readonly handIndex: number
  readonly actorId: string
  readonly opponentId: string
  readonly observation: BotObservationV1
  readonly action: TurnAction
  readonly labelStatus: RiverLabelStatus
  readonly callPotShare: number | null
}

type PreActionRow = Pick<
  RiverDecisionExample,
  'handIndex' | 'actorId' | 'opponentId' | 'observation' | 'action'
>

export function collectRiverDecisionCorpus(
  options: BenchmarkOptions,
): readonly RiverDecisionExample[] {
  const rows: PreActionRow[] = []
  const revealedHolesByHand = new Map<number, ReadonlyMap<string, readonly Card[]>>()
  const riverHandIds = new Set<number>()
  runBotBenchmark({
    ...options,
    onDecision(decision) {
      const { handIndex, actorId, observation, action } = decision
      if (observation.street === 'river' && observation.amountToCall > 0) {
        const active = observation.seats.filter((seat) => seat.playerId !== null && !seat.folded)
        if (active.length === 2 && !active.some((seat) => seat.allIn)) {
          const opponentId = active.find((seat) => seat.playerId !== actorId)?.playerId
          if (opponentId !== null && opponentId !== undefined) {
            rows.push({ handIndex, actorId, opponentId, observation, action })
            riverHandIds.add(handIndex)
          }
        }
      }
      options.onDecision?.(decision)
    },
    onHandComplete(hand) {
      if (riverHandIds.has(hand.handIndex) && hand.view.revealed) {
        const revealed = new Map<string, readonly Card[]>()
        for (const seat of hand.view.seats) {
          if (seat.playerId !== null && seat.hole !== null) {
            revealed.set(
              seat.playerId,
              seat.hole.map((card) => ({ ...card })),
            )
          }
        }
        revealedHolesByHand.set(hand.handIndex, revealed)
      }
      options.onHandComplete?.(hand)
    },
  })
  return rows.map((row) => {
    if (row.action.kind !== 'call') {
      return { ...row, labelStatus: 'not_called', callPotShare: null }
    }
    const opponentHole = revealedHolesByHand.get(row.handIndex)?.get(row.opponentId)
    if (opponentHole === undefined) {
      return { ...row, labelStatus: 'unrevealed_call', callPotShare: null }
    }
    if (opponentHole.length !== 2 || row.observation.board.length !== 5) {
      throw new Error('revealed river call has incomplete cards')
    }
    const board = row.observation.board
    const hero = evaluateBest([...row.observation.actor.hole, ...board])
    const opponent = evaluateBest([...opponentHole, ...board])
    const comparison = compareRanks(hero, opponent)
    return {
      ...row,
      labelStatus: 'revealed_call',
      callPotShare: comparison > 0 ? 1 : comparison === 0 ? 0.5 : 0,
    }
  })
}

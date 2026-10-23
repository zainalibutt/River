import type { BotObservationV1, BotPersonality, Card } from '@river/engine'
import { cardKey, makeDeck } from '@river/engine'
import type { PublicDecision } from './bot-public-replay.js'
import {
  type Player,
  prepare,
  type RiverGadget,
  type RiverNode,
  type RiverSpot,
} from './bot-river-solver.js'
import { comboIndex52 } from './bot-river-value-data.js'
import { carriedPromises, type PromiseRecord } from './bot-turn-river-leaves.js'

export interface RiverCarry {
  readonly ranges: RiverSpot['ranges']
  readonly gadget: RiverGadget
}

export type RiverCarrySource = (
  observation: BotObservationV1,
  personality: BotPersonality,
  history: readonly PublicDecision[],
  players: readonly [string, string],
) => RiverCarry | null

/** Exact chip targets, including all-ins; never translate an off-tree size. */
export function exactTurnAction(
  node: Extract<RiverNode, { kind: 'action' }>,
  decision: PublicDecision,
  spot: RiverSpot,
  effective = false,
): string | undefined {
  const action = decision.taken.action
  const label =
    action.kind === 'check'
      ? 'k'
      : action.kind === 'fold'
        ? 'f'
        : action.kind === 'call'
          ? 'c'
          : undefined
  if (label !== undefined) return node.actions.includes(label) ? label : undefined
  const total =
    action.kind === 'allIn'
      ? decision.observation.actor.stack + decision.observation.actor.betStreet
      : action.kind === 'raiseTo'
        ? action.to
        : Number.NaN
  const target = effective ? Math.min(total, spot.stack) : total
  // Uncalled excess is returned by the engine. A short all-in facing a larger
  // bet is a call in the effective-stack game, with no side pot heads-up.
  if (effective && target <= node.paid[node.player === 0 ? 1 : 0] && node.actions.includes('c'))
    return 'c'
  return node.actions.find(
    (offered) =>
      (offered === 'a'
        ? spot.stack
        : offered.startsWith('b')
          ? Number(offered.slice(1))
          : Number.NaN) === target,
  )
}

/**
 * Drop opponent holdings with zero compatible carried own mass (blocked/absent
 * included). Keep valid CFVs even when the opponent's own reach is zero: the
 * gadget must still protect those deviations. Its opponent weights are ignored;
 * use a positive placeholder for zero reach so prepare does not remove them.
 * The API already restores paid chips to the next-root origin: only multiply
 * its pot fractions by the new street pot, then index in prepared range order.
 */
export function carryFromRecord(
  record: PromiseRecord,
  history: string,
  card: number,
  player: Player,
  spot: RiverSpot,
): RiverCarry {
  const other = player === 0 ? 1 : 0
  const ours = carriedPromises(record, history, card, player)
  const theirs = carriedPromises(record, history, card, other)
  const blocked = new Set(spot.board.map(cardKey))
  const deck = makeDeck().filter((c) => !blocked.has(cardKey(c)))
  const ranges: [RiverSpot['ranges'][0], RiverSpot['ranges'][1]] = [[], []]
  for (const side of [0, 1] as const) {
    const entries = []
    for (let a = 0; a < deck.length; a += 1) {
      for (let b = a + 1; b < deck.length; b += 1) {
        const hole = [deck[a], deck[b]] as [Card, Card]
        const index = comboIndex52(cardKey(hole[0]), cardKey(hole[1]))
        const reach =
          side === player ? (ours.reach[index] as number) : (theirs.reach[index] as number)
        if (side === player ? reach <= 0 : ours.zeroMass[index] !== 0) continue
        entries.push({ hole, weight: reach > 0 ? reach : 1 })
      }
    }
    ranges[side] = entries
  }
  const hands = prepare(ranges[other], spot.board)
  const promises = Float64Array.from(
    hands.combos,
    (held) =>
      (ours.promises[comboIndex52(cardKey(held.hole[0]), cardKey(held.hole[1]))] as number) *
      spot.pot,
  )
  return { ranges, gadget: { player: other, promises } }
}

/** Backward-compatible name; the same conversion also serves flop-to-turn. */
export const riverCarryFromRecord = carryFromRecord

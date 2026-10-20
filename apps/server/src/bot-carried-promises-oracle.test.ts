import { type Card, cardKey, parseCard } from '@river/engine'
import { describe, expect, it } from 'vitest'
import { perTurnShowdown } from './bot-flop-turn-leaves.js'
import { riverCarryFromRecord } from './bot-river-carry.js'
import {
  type Player,
  type RiverNode,
  type RiverSpot,
  riverValues,
  type ShowdownValues,
  solveRiver,
} from './bot-river-solver.js'
import { COMBOS, comboIndex52 } from './bot-river-value-data.js'
import {
  carriedRiverPromises,
  createRiverPromiseRecord,
  perRiverShowdown,
} from './bot-turn-river-leaves.js'

const cards = (s: string) => s.split(' ').map(parseCard)
const held = (s: string, weight = 1) => ({ hole: cards(s) as [Card, Card], weight })
const terminal = (marker: number): RiverNode => ({ kind: 'showdown', paid: [marker, marker] })
const action = (
  player: Player,
  history: string,
  labels: string[],
  children: RiverNode[],
): RiverNode => ({
  kind: 'action',
  player,
  history,
  paid: [0, 0],
  actions: labels,
  children,
})
const spotOf = (s: number, prior = [0.5, 0.5]): RiverSpot => ({
  board: cards('Ah Kd 7s 4c 2d'),
  pot: 2 * s,
  stack: 10,
  ranges: [[held('Ac Qc')], [held('As Qd', prior[0]), held('6h 5h', prior[1])]],
  betSizes: [],
  allIn: false,
  maxRaises: 0,
})
const witnessTree = action(0, '', ['L', 'R'], [terminal(0), terminal(1)])
// All hands are disjoint. Custom terminal evaluation is the only adapter: CFR,
// averaging, range preparation, and the opt-out gadget are production code.
const witnessValues =
  (s: number, paid = 0, total = 2 * (s + paid)): ShowdownValues =>
  (node, traverser, _hands, _self, opponent, out) => {
    const right = node.paid[0] === 1
    const payoff = (type: number) => paid + (right === (type === 0) ? 2 * s : 0)
    if (traverser === 1) {
      out.forEach((_, type) => {
        out[type] = (opponent[0] as number) * payoff(type)
      })
    } else {
      out[0] = opponent.reduce((sum, reach, type) => sum + reach * (total - payoff(type)), 0)
    }
  }

// Independent full-game enumeration: four enter/outside information sets,
// one per (public chance, private type). No solver value/BR helpers.
function witnessOracle(left: readonly number[]) {
  const values = Array.from({ length: 16 }, (_, policy) => {
    let value = 0
    for (let chance = 0; chance < 2; chance += 1) {
      const s = [0.5, 1.5][chance] as number
      for (let type = 0; type < 2; type += 1) {
        const enter = (policy >> (2 * chance + type)) & 1
        const l = left[chance] as number
        value += (enter ? 2 * s * (type === 0 ? 1 - l : l) : s) / 4
      }
    }
    return value
  })
  return { policies: values.length, best: Math.max(...values) }
}

const iterations = 20_000
const tolerance = 0.015

describe('exact continual re-solving oracles through the production gadget', () => {
  it('inherited promises bound all 16 policies at 1; refreshed 0.9/0.1 promises permit 1.5', () => {
    const inherited: number[] = []
    const refreshed: number[] = []
    for (const s of [0.5, 1.5]) {
      const spot = spotOf(s)
      const safe = solveRiver(
        spot,
        iterations,
        undefined,
        witnessValues(s),
        {
          player: 1,
          promises: Float64Array.of(s, s),
        },
        witnessTree,
      )
      const guessed = solveRiver(
        spotOf(s, [0.9, 0.1]),
        iterations,
        undefined,
        witnessValues(s),
        undefined,
        witnessTree,
      )
      const promises = riverValues(guessed).values[1]
      expect(promises[0]).toBeCloseTo(0, 3)
      expect(promises[1]).toBeCloseTo(2 * s, 3)
      const unsafe = solveRiver(
        spot,
        iterations,
        undefined,
        witnessValues(s),
        { player: 1, promises },
        witnessTree,
      )
      inherited.push(safe.strategy.get('')?.[0] as number)
      refreshed.push(unsafe.strategy.get('')?.[0] as number)
    }
    expect(witnessOracle([0.5, 0.5])).toEqual({ policies: 16, best: 1 })
    expect(witnessOracle([1, 1])).toEqual({ policies: 16, best: 1.5 })
    expect(witnessOracle(inherited).best).toBeLessThanOrEqual(1 + tolerance)
    expect(witnessOracle(refreshed).best).toBeCloseTo(1.5, 2)
  })

  it.each(['turn', 'flop'] as const)(
    'chains %s blueprint into the next-street production gadget, killing refreshed promises',
    (street) => {
      // Round 1: opponent checks or bets 1; we fold/call a bet. Check and call
      // enter round 2. An extra bet 2 is included by the global BR oracle and
      // retains the blueprint. Fold pays s, independent of type. Round 2: we
      // check (L) or bet (R); opponent may fold (-1) or call the bet.
      // Public chance is drawn first: 2d/3d, each with probability 1/2.
      // It is enumerated externally because RiverNode has no chance node.
      // Other river cards in perRiverShowdown have s=1: the same round-1 mean.
      const turn: RiverSpot = {
        ...spotOf(1),
        board: cards(street === 'turn' ? 'Ah Kd 7s 4c' : 'Ah Kd 7s'),
      }
      const round1 = action(
        1,
        '',
        ['k', 'b1'],
        [terminal(0), action(0, 'b1', ['f', 'c'], [terminal(-1), terminal(1)])],
      )
      const record = createRiverPromiseRecord()
      const perCard = (street === 'turn' ? perRiverShowdown : perTurnShowdown)(
        turn,
        (river) => {
          const c = cardKey(river.board[turn.board.length] as Card)
          const s = c === cardKey(parseCard('2d')) ? 0.5 : c === cardKey(parseCard('3d')) ? 1.5 : 1
          const paid = (river.pot - turn.pot) / 2
          return [
            new Float64Array(COMBOS).fill((paid + 2 - s) / river.pot),
            new Float64Array(COMBOS).fill((paid + s) / river.pot),
          ]
        },
        record,
      )
      const round1Values: ShowdownValues = (...args) => {
        if (args[0].paid[0] !== -1) perCard(...args)
        // Exact two-outcome chance expectation: E[s]=1 at every round-1
        // terminal. Avoid 44-card accumulation roundoff perturbing this fully
        // indifferent blueprint; recording still samples real per-card CFVs.
        args[5].fill(args[4].reduce((a, b) => a + b, 0))
      }
      const blueprint = solveRiver(turn, 10, undefined, round1Values, undefined, round1)
      const call = blueprint.strategy.get('b1')?.[1] as number
      const left: number[][] = [[], []]
      const mutated: number[][] = [[], []]
      const round2 = action(
        0,
        '',
        ['k', 'b'],
        [terminal(0), action(1, 'b', ['f', 'c'], [terminal(-1), terminal(1)])],
      )
      for (const [chance, s] of [0.5, 1.5].entries()) {
        const card = parseCard(chance === 0 ? '2d' : '3d')
        for (const [line, paid] of [
          ['k', 0],
          ['b1c', 1],
        ] as const) {
          const river: RiverSpot = { ...turn, board: [...turn.board, card], pot: 2 + 2 * paid }
          const carry = riverCarryFromRecord(record, line, cardKey(card), 0, river)
          const raw = carriedRiverPromises(record, line, cardKey(card), 0)
          expect([...(record.leaves.get(line)?.weight ?? [])]).toEqual([55, 55])
          expect(
            raw.promises[comboIndex52(cardKey(parseCard('As')), cardKey(parseCard('Qd')))],
          ).toBeCloseTo((paid + s) / river.pot, 10)
          const values: ShowdownValues = (...args) => {
            if (args[0].paid[0] === -1) {
              if (args[1] === 1) args[5].fill((args[4][0] as number) * (paid - 1))
              else args[5][0] = args[4].reduce((a, b) => a + b, 0) * (river.pot - paid + 1)
            } else witnessValues(s, paid, river.pot)(...args)
          }
          const resolved = solveRiver(
            { ...river, ranges: carry.ranges },
            iterations,
            undefined,
            values,
            carry.gadget,
            round2,
          )
          const guessed = solveRiver(
            { ...river, ranges: [river.ranges[0], [held('As Qd', 0.9), held('6h 5h', 0.1)]] },
            iterations,
            undefined,
            values,
            undefined,
            round2,
          )
          // Mutation: replace inherited values with a fresh solve's values.
          const refreshed = riverValues(guessed).values[1]
          const broken = solveRiver(
            river,
            iterations,
            undefined,
            values,
            { player: 1, promises: refreshed },
            round2,
          )
          left[chance]?.push(resolved.strategy.get('')?.[0] as number)
          mutated[chance]?.push(broken.strategy.get('')?.[0] as number)
        }
      }
      // Independent enumeration of local pure policies, composed by perfect
      // recall: 3 round-1 actions x 2 round-2 responses per (chance,type).
      // The off-tree bet uses its unchanged blueprint continuation L=1/2.
      const globalBR = (mixes: number[][]) => {
        let total = 0
        for (let c = 0; c < 2; c += 1) {
          const s = [0.5, 1.5][c] as number
          for (let type = 0; type < 2; type += 1) {
            const policies: number[] = []
            for (let first = 0; first < 3; first += 1) {
              for (let response = 0; response < 2; response += 1) {
                const l = first === 2 ? 0.5 : (mixes[c]?.[first] as number)
                const checked = type === 0 ? 0 : 2 * s
                const called = type === 0 ? 2 * s : 0
                const continuation = l * checked + (1 - l) * (response === 0 ? -1 : called)
                policies.push(first === 0 ? continuation : (1 - call) * s + call * continuation)
              }
            }
            total += Math.max(...policies) / 4
          }
        }
        return total
      }
      expect(
        globalBR([
          [0.5, 0.5],
          [0.5, 0.5],
        ]),
      ).toBe(1)
      expect(globalBR(left)).toBeLessThanOrEqual(1 + tolerance)
      expect(globalBR(mutated)).toBeCloseTo(1.5, 2)
    },
    30_000,
  )
})

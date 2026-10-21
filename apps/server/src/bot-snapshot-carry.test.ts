import { type Card, cardKey, parseCard } from '@river/engine'
import { describe, expect, it } from 'vitest'
import { perTurnShowdown } from './bot-flop-turn-leaves.js'
import {
  type Player,
  type RiverNode,
  type RiverSolution,
  type RiverSpot,
  solveRiver,
} from './bot-river-solver.js'
import { COMBOS, comboIndex52 } from './bot-river-value-data.js'
import {
  carriedRiverPromises,
  createRiverPromiseRecord,
  perRiverShowdown,
  type RiverLeafEvaluator,
} from './bot-turn-river-leaves.js'

const cards = (s: string) => s.split(' ').map(parseCard)
const held = (s: string, weight = 1) => ({ hole: cards(s) as [Card, Card], weight })
const index = (hole: readonly [Card, Card]) => comboIndex52(cardKey(hole[0]), cardKey(hole[1]))
const compatible = (a: readonly Card[], b: readonly Card[]) =>
  a.every((x) => b.every((y) => cardKey(x) !== cardKey(y)))
const close = (actual: number, expected: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(expected)))

// Independent enumeration of realization probabilities from the returned tables.
// Include the gadget's root choice so this also checks followShare's snapshot.
function closedReaches(
  solution: RiverSolution & { readonly followShare?: Float64Array },
  gadgetPlayer: Player | undefined,
) {
  const leaves = new Map<
    string,
    { node: Extract<RiverNode, { kind: 'showdown' }>; reach: readonly number[][] }
  >()
  const walk = (node: RiverNode, history: string, reach: readonly number[][]) => {
    if (node.kind !== 'action') {
      if (node.kind === 'showdown') leaves.set(history, { node, reach })
      return
    }
    const table = solution.strategy.get(node.history)
    if (!table) throw new Error('missing strategy')
    node.children.forEach((child, a) => {
      const next = reach.map((r, p) =>
        p === node.player ? r.map((w, h) => w * (table[h * node.actions.length + a] as number)) : r,
      )
      walk(child, `${history}${node.actions[a]}`, next)
    })
  }
  walk(
    solution.tree,
    '',
    solution.spot.ranges.map((r, p) =>
      r.map((h, i) => (p === gadgetPlayer ? (solution.followShare?.[i] as number) : h.weight)),
    ),
  )
  return leaves
}

describe.each(['cfr+', 'dcfr'] as const)('%s snapshot-consistent carry', (scheme) => {
  describe.each(['river', 'turn'] as const)('per-%s records', (street) => {
    const recordWith = street === 'river' ? perRiverShowdown : perTurnShowdown
    const board = cards(street === 'river' ? 'Ah Kd 7s 4c' : 'Ah Kd 7s')
    const base: RiverSpot = {
      board,
      pot: 100,
      stack: 100,
      ranges: [[held('Ac Qc')], [held('6h 5h')]],
      betSizes: [0.3],
      allIn: false,
      maxRaises: 0,
    }
    it.each([undefined, 0, 1] as const)(
      'constant identity at every closed history/card/seat, gadget %s',
      (gadgetPlayer) => {
        const record = createRiverPromiseRecord()
        const evaluator = recordWith(
          base,
          () => [new Float64Array(COMBOS).fill(0.5), new Float64Array(COMBOS).fill(0.5)],
          record,
        )
        const solution = solveRiver(
          base,
          2,
          undefined,
          evaluator,
          gadgetPlayer === undefined
            ? undefined
            : { player: gadgetPlayer, promises: Float64Array.of(50) },
          undefined,
          { scheme },
        )
        const leaves = closedReaches(solution, gadgetPlayer)
        expect([...record.leaves.keys()].sort()).toEqual([...leaves.keys()].sort())
        for (const [history, { node, reach }] of leaves) {
          const pot = base.pot + node.paid[0] + node.paid[1]
          for (const card of record.leaves.get(history)?.cards.keys() ?? []) {
            for (const p of [0, 1] as const) {
              const other = p === 0 ? 1 : 0
              const carry = carriedRiverPromises(record, history, card, p)
              const mine = base.ranges[p][0]?.hole as [Card, Card]
              const theirs = base.ranges[other][0]?.hole as [Card, Card]
              const blocked = [...mine, ...theirs].some((c) => cardKey(c) === card)
              if (blocked) {
                expect(carry.zeroMass[index(theirs)]).toBe(1)
                continue
              }
              close(carry.reach[index(mine)] as number, reach[p]?.[0] as number)
              const mass = reach[p]?.[0] as number
              close(carry.cfvs[index(theirs)] as number, mass * (pot / 2 - node.paid[other]))
              if (mass > 0) {
                expect(carry.zeroMass[index(theirs)]).toBe(0)
                close((carry.promises[index(theirs)] as number) * pot, pot / 2)
              } else expect(carry.zeroMass[index(theirs)]).toBe(1)
            }
          }
        }
      },
      30_000,
    )

    it.each([undefined, 0, 1] as const)(
      'matches independent non-indifferent average-strategy enumeration, gadget %s',
      (gadgetPlayer) => {
        const spot: RiverSpot = {
          ...base,
          ranges: [
            [held('Ac Qc', 2), held('8h 8d', 0.7)],
            [held('6h 5h', 0.4), held('As Qd', 1.3)],
          ],
          maxRaises: 1,
        }
        const matrix = [
          [0.9, 0.2],
          [0.15, 0.7],
        ]
        const share = (p: Player, own: readonly [Card, Card], opp: readonly [Card, Card]) => {
          const i = spot.ranges[0].findIndex((h) => index(h.hole) === index(p === 0 ? own : opp))
          const j = spot.ranges[1].findIndex((h) => index(h.hole) === index(p === 1 ? own : opp))
          const v = matrix[i]?.[j] as number
          return p === 0 ? v : 1 - v
        }
        const values: RiverLeafEvaluator = (next) => {
          const result = [new Float64Array(COMBOS), new Float64Array(COMBOS)] as const
          for (const p of [0, 1] as const) {
            for (const h of next.ranges[p]) {
              let mass = 0
              let value = 0
              for (const o of next.ranges[p === 0 ? 1 : 0]) {
                if (!compatible(h.hole, o.hole)) continue
                mass += o.weight
                value += o.weight * share(p, h.hole, o.hole)
              }
              result[p][index(h.hole)] = mass > 0 ? value / mass : 0
            }
          }
          return result
        }
        const record = createRiverPromiseRecord()
        const solution = solveRiver(
          spot,
          7,
          undefined,
          recordWith(spot, values, record),
          gadgetPlayer === undefined
            ? undefined
            : { player: gadgetPlayer, promises: Float64Array.of(45, 65) },
          undefined,
          { scheme },
        )
        expect(solution.strategy.get('')?.some((v) => Math.abs(v - 0.5) > 0.01)).toBe(true)
        for (const [history, { node, reach }] of closedReaches(solution, gadgetPlayer)) {
          const pot = spot.pot + node.paid[0] + node.paid[1]
          for (const card of record.leaves.get(history)?.cards.keys() ?? []) {
            for (const p of [0, 1] as const) {
              const other = p === 0 ? 1 : 0
              const carry = carriedRiverPromises(record, history, card, p)
              for (const o of spot.ranges[other]) {
                if (o.hole.some((c) => cardKey(c) === card)) continue
                let mass = 0
                let chips = 0
                spot.ranges[p].forEach((h, i) => {
                  if (h.hole.some((c) => cardKey(c) === card) || !compatible(h.hole, o.hole)) return
                  const w = reach[p]?.[i] as number
                  mass += w
                  chips += w * share(other, o.hole, h.hole) * pot
                  close(carry.reach[index(h.hole)] as number, w)
                })
                close(carry.masses[index(o.hole)] as number, mass)
                close(carry.cfvs[index(o.hole)] as number, chips - mass * node.paid[other])
                if (mass > 0) close((carry.promises[index(o.hole)] as number) * pot, chips / mass)
                else expect(carry.zeroMass[index(o.hole)]).toBe(1)
              }
            }
          }
        }
      },
      30_000,
    )
  })
})

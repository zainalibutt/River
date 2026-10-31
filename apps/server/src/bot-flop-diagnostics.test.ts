import { type Card, cardKey, parseCard } from '@river/engine'
import { expect, it } from 'vitest'
import {
  flopDecisionReach,
  flopDiagnosticsFromEnvironment,
  flopIpJamOverRaise,
} from './bot-flop-diagnostics.js'
import { addRiverAction, type RiverNode, type RiverSpot, riverTree } from './bot-river-solver.js'
import { comboIndex52 } from './bot-river-value-data.js'

const spot: RiverSpot = {
  board: ['2h', '7d', 'Ts'].map(parseCard),
  pot: 400,
  stack: 19800,
  ranges: [
    [{ hole: ['As', 'Kh'].map(parseCard) as [Card, Card], weight: 0.37 }],
    [{ hole: ['Qs', 'Jh'].map(parseCard) as [Card, Card], weight: 0.21 }],
  ],
  betSizes: [0.66],
  allIn: true,
  maxRaises: 1,
}

function decisionAt(
  node: RiverNode,
  history: string,
): Extract<RiverNode, { kind: 'action' }> | undefined {
  if (node.kind !== 'action') return undefined
  if (node.history === history) return node
  for (const child of node.children) {
    const found = decisionAt(child, history)
    if (found) return found
  }
  return undefined
}

it('keeps all flop diagnostics off by default', () => {
  expect(flopDiagnosticsFromEnvironment({})).toEqual({
    gadgetOff: false,
    ipJamOverRaise: false,
    allInRunouts: 60,
    flopAllInRaisesOnly: false,
    iterationsMultiplier: 1,
  })
})

it.each([60, 61, 1176])('accepts the diagnostic switches with %s runouts', (runouts) => {
  expect(
    flopDiagnosticsFromEnvironment({
      RIVER_DIAG_GADGET: 'off',
      RIVER_DIAG_IP_JAM_OVER_RAISE: '1',
      RIVER_DIAG_ALLIN_RUNOUTS: String(runouts),
      RIVER_DIAG_FLOP_RAISES: 'allin',
      RIVER_DIAG_ITERATIONS_MULTIPLIER: '4',
    }),
  ).toEqual({
    gadgetOff: true,
    ipJamOverRaise: true,
    allInRunouts: runouts,
    flopAllInRaisesOnly: true,
    iterationsMultiplier: 4,
  })
})

it.each([
  ...['', 'on', '0', 'OFF', ' off'].map((raw) => ['RIVER_DIAG_GADGET', raw]),
  ...['', '0', 'true', 'off', '1 '].map((raw) => ['RIVER_DIAG_IP_JAM_OVER_RAISE', raw]),
  ...['', ' ', '59', '1177', '-60', '60.5', '6e1', '60x', 'NaN', 'Infinity', ' 60'].map((raw) => [
    'RIVER_DIAG_ALLIN_RUNOUTS',
    raw,
  ]),
  ...['', 'sized', 'ALLIN', ' allin'].map((raw) => ['RIVER_DIAG_FLOP_RAISES', raw]),
  ...['', '0', '11', '1.5', '4 ', 'x'].map((raw) => ['RIVER_DIAG_ITERATIONS_MULTIPLIER', raw]),
])('rejects %s=%s', (name, raw) => {
  expect(() => flopDiagnosticsFromEnvironment({ [name as string]: raw })).toThrow(name)
})

it('drops OOP non-all-in raises at an exact-size bet when raises are all-in only', () => {
  const narrow = { ...spot, allInRaisesOnly: true }
  const tree = addRiverAction(narrow, riverTree(narrow), 'k', 200)
  expect(decisionAt(tree, 'kb200')?.actions).toEqual(['f', 'c', 'a'])
  expect(decisionAt(addRiverAction(spot, riverTree(spot), 'k', 200), 'kb200')?.actions).toContain(
    'b728',
  )
})

it('adds IP jams over non-all-in OOP raises, including the exact-size bet branch', () => {
  const tree = addRiverAction(spot, riverTree(spot), 'k', 200)
  const before = decisionAt(tree, 'kb200b728')
  expect(before?.actions).toEqual(['f', 'c'])
  const widened = flopIpJamOverRaise(spot, tree)
  const after = decisionAt(widened, 'kb200b728')
  expect(after?.actions).toEqual(['f', 'c', 'a'])
  expect(after?.children.slice(0, 2)).toEqual(before?.children)
  expect(after?.children[2]).toMatchObject({
    player: 0,
    history: 'kb200b728a',
    paid: [728, 19800],
    actions: ['f', 'c'],
    children: [
      { kind: 'fold', folder: 0, paid: [728, 19800] },
      { kind: 'showdown', paid: [19800, 19800] },
    ],
  })
  expect(decisionAt(widened, 'kb200a')).toEqual(decisionAt(tree, 'kb200a'))
  expect(decisionAt(widened, 'b264')).toEqual(decisionAt(tree, 'b264'))
  expect(flopIpJamOverRaise(spot, widened)).toEqual(widened)
  expect(before?.actions).toEqual(['f', 'c'])
  expect(spot.maxRaises).toBe(1)
})

it('exports the frozen root check and raw decision reaches after gadget follow and exact bet', () => {
  const tree = addRiverAction(spot, riverTree(spot), 'k', 200)
  if (tree.kind !== 'action') throw new Error('missing root')
  const ip = decisionAt(tree, 'k')
  if (!ip) throw new Error('missing IP bet')
  const root = new Float64Array(tree.actions.length)
  root[tree.actions.indexOf('k')] = 0.25
  const bet = new Float64Array(ip.actions.length)
  bet[ip.actions.indexOf('b200')] = 0.4
  const solution = {
    spot,
    tree,
    strategy: new Map([
      ['', root],
      ['k', bet],
    ]),
  }
  const result = flopDecisionReach(solution, 'kb200', { player: 1, share: Float64Array.of(0.6) })
  const index = (p: 0 | 1) => {
    const hole = spot.ranges[p][0]?.hole
    if (!hole) throw new Error('missing combo')
    return comboIndex52(cardKey(hole[0]), cardKey(hole[1]))
  }
  expect(result.rootCheck).toHaveLength(1326)
  expect(result.reach).toHaveLength(1326)
  expect(result.ipBetReach).toHaveLength(1326)
  expect(result.rootCheck[index(0)]).toBe(0.25)
  expect(result.reach[index(0)]).toBe(0.37 * 0.25)
  // The solver uses follow as the gadget player's reach, replacing its prior weight.
  expect(result.ipBetReach[index(1)]).toBe(0.6 * 0.4)
  expect(result.reach.filter((value) => value !== 0)).toHaveLength(1)
  expect(flopDecisionReach(solution, 'kb200').ipBetReach[index(1)]).toBe(0.21 * 0.4)
})

import { cardKey } from '@river/engine'
import {
  addRiverAction,
  type Player,
  prepare,
  type RiverNode,
  type RiverSolution,
  type RiverSpot,
} from './bot-river-solver.js'
import { COMBOS, comboIndex52 } from './bot-river-value-data.js'

/** Offline overfold diagnostics; absent values preserve the production solve. */
export function flopDiagnosticsFromEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const gadget = env.RIVER_DIAG_GADGET
  if (gadget !== undefined && gadget !== 'off')
    throw new Error('RIVER_DIAG_GADGET must be off when set')
  const jam = env.RIVER_DIAG_IP_JAM_OVER_RAISE
  if (jam !== undefined && jam !== '1')
    throw new Error('RIVER_DIAG_IP_JAM_OVER_RAISE must be 1 when set')
  const raw = env.RIVER_DIAG_ALLIN_RUNOUTS
  const runouts = raw === undefined ? 60 : Number(raw)
  if (
    (raw !== undefined && !/^[0-9]+$/.test(raw)) ||
    !Number.isSafeInteger(runouts) ||
    runouts < 60 ||
    runouts > 1176
  )
    throw new Error('RIVER_DIAG_ALLIN_RUNOUTS must be an integer from 60 to 1176')
  return { gadgetOff: gadget === 'off', ipJamOverRaise: jam === '1', allInRunouts: runouts }
}

/** Add only IP's jam after check, IP bet, OOP non-all-in raise. */
export function flopIpJamOverRaise(spot: RiverSpot, tree: RiverNode): RiverNode {
  if (tree.kind !== 'action') return tree
  const ip = tree.children[tree.actions.indexOf('k')]
  if (ip?.kind !== 'action' || ip.player !== 1) return tree
  const histories: string[] = []
  for (const [b, bet] of ip.actions.entries()) {
    if (!bet.startsWith('b')) continue
    const oop = ip.children[b]
    if (oop?.kind !== 'action' || oop.player !== 0) continue
    for (const [r, raise] of oop.actions.entries()) {
      if (!raise.startsWith('b')) continue
      const response = oop.children[r]
      if (
        response?.kind === 'action' &&
        response.player === 1 &&
        response.paid[0] < spot.stack &&
        response.paid[0] > response.paid[1] &&
        !response.actions.includes('a')
      )
        histories.push(response.history)
    }
  }
  let widened: RiverNode = tree
  for (const history of histories) widened = addRiverAction(spot, widened, history, spot.stack)
  return widened
}

/** Raw per-combo reach through the final strategy, including gadget follow. */
export function flopDecisionReach(
  solution: RiverSolution,
  history: string,
  gadgetFollow?: { readonly player: Player; readonly share: Float64Array },
) {
  const hands = solution.spot.ranges.map((range) => prepare(range, solution.spot.board))
  const reach = hands.map((hand, p) =>
    Float64Array.from(gadgetFollow?.player === p ? gadgetFollow.share : hand.weights),
  )
  const expand = (values: Float64Array, player: Player) => {
    const out = Array<number>(COMBOS).fill(0)
    for (const [h, combo] of (hands[player]?.combos ?? []).entries())
      out[comboIndex52(cardKey(combo.hole[0]), cardKey(combo.hole[1]))] = values[h] as number
    return out
  }
  let node = solution.tree
  if (node.kind !== 'action' || node.player !== 0) throw new Error('missing OOP root')
  const rootTable = solution.strategy.get(node.history)
  const check = node.actions.indexOf('k')
  const rootWidth = node.actions.length
  if (!rootTable || check < 0) throw new Error('missing root check strategy')
  const rootCheck = expand(
    Float64Array.from(
      hands[0]?.weights ?? [],
      (_, h) => rootTable[h * rootWidth + check] as number,
    ),
    0,
  )
  while (node.kind === 'action' && node.history !== history) {
    const table = solution.strategy.get(node.history)
    const label = history.slice(node.history.length).match(/^(b[0-9]+|[akcf])/)?.[0]
    const action = node.actions.indexOf(label ?? '')
    if (!table || action < 0) throw new Error('missing decision prefix strategy')
    const weights = reach[node.player] as Float64Array
    for (let h = 0; h < weights.length; h++)
      weights[h] = (weights[h] as number) * (table[h * node.actions.length + action] as number)
    node = node.children[action] as RiverNode
  }
  if (node.kind !== 'action' || node.history !== history) throw new Error('missing decision node')
  return {
    rootCheck,
    reach: expand(reach[0] as Float64Array, 0),
    ipBetReach: expand(reach[1] as Float64Array, 1),
  }
}

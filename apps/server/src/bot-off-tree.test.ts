import {
  type BotObservationV1,
  type Card,
  cardKey,
  parseCard,
  personalityPool,
} from '@river/engine'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { followWithResolving, type OffTreeState, offTreeStats } from './bot-off-tree.js'
import { legacyGuardPolicy } from './bot-poker-guard.js'
import { type PublicDecision, publicDecisions } from './bot-public-replay.js'
import { carryFromRecord, exactTurnAction, type RiverCarry } from './bot-river-carry.js'
import { riverSolverPolicy } from './bot-river-policy.js'
import * as solver from './bot-river-solver.js'
import {
  addRiverAction,
  type RiverSolution,
  type RiverSpot,
  riverTree,
  solveRiver,
} from './bot-river-solver.js'
import { profileFor } from './bot-service.js'
import { TURN_STREET, turnSolverPolicy } from './bot-turn-policy.js'
import * as leaves from './bot-turn-river-leaves.js'
import type { RiverValueNetwork } from './bot-value-network.js'

vi.mock('./bot-public-replay.js', () => ({ publicDecisions: vi.fn() }))
afterEach(() => vi.restoreAllMocks())
const cards = (s: string) => s.split(' ').map(parseCard)
const spot: RiverSpot = {
  board: cards('Ah Kd 7s 2d'),
  pot: 100,
  stack: 300,
  ranges: [
    [
      { hole: cards('Kc Ks') as [Card, Card], weight: 1 },
      { hole: cards('Jc Jd') as [Card, Card], weight: 1 },
    ],
    [
      { hole: cards('Ac Qc') as [Card, Card], weight: 0.7 },
      { hole: cards('Qs Qh') as [Card, Card], weight: 0.3 },
    ],
  ],
  betSizes: [0.66],
  allIn: true,
  maxRaises: 0,
}
const inherited: RiverCarry = {
  ranges: spot.ranges,
  gadget: { player: 0, promises: Float64Array.of(80, 30) },
}
const network: RiverValueNetwork = {
  buckets: 1,
  layers: [
    {
      rows: 2,
      columns: 4,
      slope: null,
      weight: new Float32Array(8),
      bias: Float32Array.of(0.6, 0.4),
    },
  ],
}
const personality = personalityPool()[10]
if (!personality) throw new Error('missing personality')
function view(street: 'turn' | 'river', id = 'b', facing = 0): BotObservationV1 {
  return {
    version: 1,
    roomId: 'off-tree',
    handNumber: 1,
    street,
    board: street === 'turn' ? spot.board : [...spot.board, parseCard('3d')],
    dealerSeat: 1,
    actor: {
      playerId: id,
      seat: id === 'a' ? 0 : 1,
      hole: cards('Ac Qc'),
      stack: street === 'turn' ? 300 : 257,
      betHand: street === 'turn' ? 0 : 43,
      betStreet: 0,
    },
    pot: street === 'turn' ? 100 + facing : 186,
    currentBet: facing,
    amountToCall: facing,
    legal: {
      fold: true,
      check: facing === 0,
      call: { enabled: facing > 0, amount: facing },
      raiseTo: { enabled: true, min: 2 * facing, max: 300 },
      allIn: { enabled: true, amount: 300 },
    },
    seats: ['a', 'b'].map((playerId, seat) => ({
      seat,
      playerId,
      stack: street === 'turn' ? 300 - (seat === 0 ? facing : 0) : 257,
      betStreet: street === 'turn' && seat === 0 ? facing : 0,
      betHand: street === 'turn' && seat === 0 ? facing : street === 'river' ? 43 : 0,
      folded: false,
      allIn: false,
      away: false,
    })),
    opponents: [],
    actions: [],
    tilt: { factor: 0 },
  }
}
const move = (
  observation: BotObservationV1,
  action: PublicDecision['taken']['action'],
): PublicDecision => ({
  observation,
  taken: { street: observation.street, seat: observation.actor.seat, action },
})
const bet = move(view('turn', 'a'), { kind: 'raiseTo', to: 43 })
const context = (observation: BotObservationV1) => ({
  observation,
  personality,
  profile: profileFor(personality),
  tilt: observation.tilt,
  rng: () => 0.5,
})

describe('off-tree policy resolving', () => {
  it('keeps inherited bounds, exact chips and replaces the per-card record for the actual turn line', () => {
    vi.mocked(publicDecisions).mockReturnValue([bet])
    const calls = vi.spyOn(solver, 'solveRiver')
    const records = vi.spyOn(leaves, 'perRiverShowdown')
    const turn = turnSolverPolicy(
      legacyGuardPolicy,
      network,
      'turn',
      1,
      {
        offTree: 'resolve',
        carry: 'both',
        riverNetwork: network,
        iterations: 8,
        maxRaises: 0,
      },
      { ...TURN_STREET, safe: true, carry: () => inherited },
    )
    const explanation = turn.explain(view('turn', 'b', 43), personality)
    expect(explanation).toMatchObject({ history: 'b43', pot: 100, stack: 300 })
    expect(calls).toHaveBeenCalledTimes(2)
    expect(
      calls.mock.calls.every(
        (call) => call[0].ranges === inherited.ranges && call[4] === inherited.gadget,
      ),
    ).toBe(true)
    expect(turn.stats.offTree).toMatchObject({ events: 1, resolves: 1, failures: {} })
    const latest = records.mock.calls.at(-1)?.[2]
    expect(latest).not.toBe(records.mock.calls[0]?.[2])
    expect(latest?.leaves.get('b43c')?.paid).toEqual([43, 43])
    expect(latest?.leaves.get('b43c')?.pot).toBe(186)
    const closed = [bet, move(view('turn', 'b', 43), { kind: 'call' })]
    const carried = turn.carried(view('river'), personality, closed, ['a', 'b'])
    const expected = carryFromRecord(
      latest as leaves.PromiseRecord,
      'b43c',
      cardKey(parseCard('3d')),
      1,
      { ...spot, board: view('river').board, pot: 186, stack: 257 },
    )
    expect(carried).toEqual(expected)
    expect(carried?.ranges[1].length).toBeGreaterThan(0)
    expect(turn.stats.offTree.events).toBe(1) // cached carry replay never re-solves
  })

  it('uses exact river showdowns with the same inherited gadget', () => {
    const observation = {
      ...view('turn', 'b', 43),
      street: 'river',
      board: view('river').board,
    } as BotObservationV1
    vi.mocked(publicDecisions).mockReturnValue([
      { ...bet, taken: { ...bet.taken, street: 'river' } },
    ])
    const calls = vi.spyOn(solver, 'solveRiver')
    const river = riverSolverPolicy(
      legacyGuardPolicy,
      'river',
      1,
      {
        offTree: 'resolve',
        safe: true,
        carry: 'per-river',
        iterations: 8,
        betSizes: [0.66],
        maxRaises: 0,
      },
      undefined,
      undefined,
      () => inherited,
    )
    river.policy.decide(context(observation))
    expect(river.stats.offTree).toMatchObject({ events: 1, resolves: 1, failures: {} })
    expect(calls).toHaveBeenCalledTimes(2)
    expect(
      calls.mock.calls.every((call) => call[3] === undefined && call[4] === inherited.gadget),
    ).toBe(true)
  })

  it('flag-off preserves the old translated decision, tree and solve count', () => {
    vi.mocked(publicDecisions).mockReturnValue([bet])
    const make = () =>
      turnSolverPolicy(
        legacyGuardPolicy,
        network,
        'turn',
        1,
        { carry: 'both', riverNetwork: network, iterations: 8, maxRaises: 0 },
        { ...TURN_STREET, safe: true, carry: () => inherited },
      )
    const a = make()
    const b = make()
    expect(a.policy.decide(context(view('turn', 'b', 43)))).toEqual(
      b.policy.decide(context(view('turn', 'b', 43))),
    )
    expect(a.explain(view('turn', 'b', 43), personality)).toEqual(
      b.explain(view('turn', 'b', 43), personality),
    )
    expect(a.stats).toMatchObject({ solves: 1, offTree: { events: 0, resolves: 0 } })
    expect(a.explain(view('turn', 'b', 43), personality)).toMatchObject({ history: 'b66' })
    // Compare flag-off playback with the original single-tree solve directly,
    // rather than comparing two instances of the same policy wrapper alone.
    const original = solveRiver(
      spot,
      8,
      undefined,
      leaves.perRiverShowdown(spot, network),
      inherited.gadget,
    )
    const index = solver.comboIndex(
      solver.prepare(spot.ranges[1], spot.board),
      cards('Ac Qc') as [Card, Card],
    )
    if (index === undefined) throw new Error('missing own holding')
    const explanation = a.explain(view('turn', 'b', 43), personality)
    if (typeof explanation === 'string') throw new Error(explanation)
    expect(explanation.row).toEqual(
      Array.from(original.strategy.get('b66')?.slice(index * 2, index * 2 + 2) ?? []),
    )
  })
})

it('accounts for an odd raise after a bet, preserves original branches and accepts another opponent raise beyond the cap', () => {
  const tree = riverTree({ ...spot, maxRaises: 1 })
  const widened = addRiverAction({ ...spot, maxRaises: 1 }, tree, 'b66', 166)
  if (widened.kind !== 'action') throw new Error('root')
  const response = widened.children[widened.actions.indexOf('b66')]
  if (response?.kind !== 'action') throw new Error('response')
  // Call 66, pot after call 232, add round(.43 * 232) = 100: target 166.
  expect(response.actions).toContain('b166')
  expect(response.children[response.actions.indexOf('b166')]).toMatchObject({ paid: [66, 166] })
  expect(widened.actions).toEqual(tree.kind === 'action' ? tree.actions : [])
  expect(addRiverAction({ ...spot, maxRaises: 1 }, widened, 'b66b166', 270)).toBeDefined()
})

it('returns unmatched excess and treats a short all-in as an effective call', () => {
  const tree = riverTree(spot)
  if (tree.kind !== 'action') throw new Error('root')
  const oversized = move(
    { ...view('turn', 'a'), actor: { ...view('turn', 'a').actor, stack: 500 } },
    { kind: 'allIn' },
  )
  expect(exactTurnAction(tree, oversized, spot)).toBeUndefined()
  expect(exactTurnAction(tree, oversized, spot, true)).toBe('a')
  const response = tree.children[tree.actions.indexOf('a')]
  if (response?.kind !== 'action') throw new Error('response')
  const shortCall = move(view('turn', 'b', 300), { kind: 'allIn' })
  expect(exactTurnAction(response, shortCall, spot, true)).toBe('c')
  expect(response.children[response.actions.indexOf('c')]).toMatchObject({ paid: [300, 300] })
})

it('freezes played own strategy before an opponent deviation and counts a failed solve once', () => {
  type State = RiverSolution & { players: readonly [string, string]; offTree: OffTreeState<State> }
  const s = { ...spot, board: view('river').board }
  let fixed: ReadonlyMap<string, Float64Array> | undefined
  const state: OffTreeState<State> = {
    failures: new Map(),
    solve: (tree, locked) => {
      fixed = locked
      return {
        ...solveRiver(s, 16, undefined, undefined, undefined, tree, { fixedStrategies: locked }),
        players: ['a', 'b'],
        offTree: state,
      }
    },
  }
  const initial: State = { ...solveRiver(s, 8), players: ['a', 'b'], offTree: state }
  const history = [
    move(view('river', 'a'), { kind: 'check' }),
    move(view('river', 'b'), { kind: 'raiseTo', to: 43 }),
  ]
  const stats = offTreeStats()
  const result = followWithResolving(initial, history, 0, stats, () => {})
  expect(typeof result).not.toBe('string')
  if (typeof result === 'string') throw new Error(result)
  expect(fixed?.get('')).toBe(initial.strategy.get(''))
  expect(result.solved.strategy.get('')).toEqual(initial.strategy.get(''))
  const failed: State = {
    ...initial,
    offTree: {
      failures: new Map(),
      solve: () => {
        throw new Error('injected solver failure')
      },
    },
  }
  const failures = offTreeStats()
  for (let i = 0; i < 2; i++)
    expect(followWithResolving(failed, history, 0, failures, () => {})).toContain(
      'injected solver failure',
    )
  expect(failures).toMatchObject({
    events: 1,
    resolves: 0,
    failures: { 'injected solver failure': 1 },
  })
})

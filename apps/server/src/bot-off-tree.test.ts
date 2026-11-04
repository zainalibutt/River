import { readFileSync } from 'node:fs'
import {
  type BotObservationV1,
  type Card,
  cardKey,
  makeDeck,
  parseCard,
  personalityPool,
} from '@river/engine'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as flopLeaves from './bot-flop-turn-leaves.js'
import { followWithResolving, type OffTreeState, offTreeStats } from './bot-off-tree.js'
import { legacyGuardPolicy } from './bot-poker-guard.js'
import { type PublicDecision, publicDecisions } from './bot-public-replay.js'
import {
  actualChipTarget,
  carryFromRecord,
  exactTurnAction,
  type RiverCarry,
} from './bot-river-carry.js'
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
import { FLOP_STREET, TURN_STREET, turnSolverPolicy } from './bot-turn-policy.js'
import * as leaves from './bot-turn-river-leaves.js'
import type { RiverValueNetwork } from './bot-value-network.js'

vi.mock('./bot-public-replay.js', () => ({ publicDecisions: vi.fn() }))
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})
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
  it.each([false, true])(
    'wires flop warm start=%s with matching carried averages and played locks',
    (warm) => {
      vi.stubEnv('RIVER_DIAG_WARM_START', warm ? '1' : undefined)
      const records: leaves.PromiseRecord[] = []
      const seeds: leaves.PromiseRecord[] = []
      const actual = flopLeaves.perTurnShowdown
      vi.spyOn(flopLeaves, 'perTurnShowdown').mockImplementation((...args) => {
        if (args[2]) records.push(args[2])
        const wrap = (hook: leaves.PerCardShowdown): leaves.PerCardShowdown =>
          Object.assign((...values: Parameters<leaves.PerCardShowdown>) => hook(...values), {
            withRecord: (record?: leaves.PromiseRecord) => {
              if (record) {
                records.push(record)
                seeds.push(structuredClone(record))
              }
              return wrap(hook.withRecord(record))
            },
          })
        return wrap(actual(...args))
      })
      const flopView = (id: string, facing = 0): BotObservationV1 => ({
        ...view('turn', id, facing),
        street: 'flop',
        board: spot.board.slice(0, 3),
        seats: view('turn', id, facing).seats.map((seat) => ({
          ...seat,
          betStreet: seat.playerId === 'b' ? facing : 0,
        })),
      })
      const flopMove = (id: string, action: PublicDecision['taken']['action']): PublicDecision => ({
        observation: flopView(id),
        taken: { street: 'flop', seat: id === 'a' ? 0 : 1, action },
      })
      vi.mocked(publicDecisions).mockReturnValue([
        flopMove('a', { kind: 'check' }),
        flopMove('b', { kind: 'raiseTo', to: 50 }),
      ])
      const calls = vi.spyOn(solver, 'solveRiver')
      const flop = turnSolverPolicy(
        legacyGuardPolicy,
        network,
        'flop-warm',
        1,
        {
          offTree: 'resolve',
          carry: 'per-turn',
          turnStartNetwork: network,
          scheme: 'dcfr',
          iterations: 4,
          maxRaises: 0,
          preflop: {
            policy: { ...legacyGuardPolicy, releaseHand() {} },
            stats: {
              decisions: 0,
              preflopOffTree: 0,
              fallbacks: {},
              rangeFallbacks: 0,
              exactRanges: 0,
              packs: {},
              clampedBelow: 0,
              clampedAbove: 0,
            },
            ranges: () => [[...spot.ranges[0]], [...spot.ranges[1]]],
          },
        },
        FLOP_STREET,
      )
      expect(flop.explain(flopView('a', 50), personality)).toMatchObject({ history: 'kb50' })
      expect(flop.stats.offTree).toMatchObject({ events: 1, resolves: 1, failures: {} })
      expect(calls).toHaveBeenCalledTimes(2)
      const root = calls.mock.results[0]?.value as ReturnType<typeof solveRiver>
      const options = calls.mock.calls[1]?.[6]
      expect(options?.fixedStrategies?.get('')).toBe(root.strategy.get(''))
      if (warm) {
        expect(root.cfrState?.iterations).toBe(4)
        expect(options?.warmStart).toBe(root.cfrState)
        expect(seeds[0]).toEqual(records[0])
        expect(records[1]).not.toBe(records[0])
      } else {
        expect(root.cfrState).toBeUndefined()
        expect(options?.warmStart).toBeUndefined()
        expect(seeds[0]?.leaves.size).toBe(0)
      }
      const weight = (from: number, through: number) =>
        Array.from(
          { length: through - from + 1 },
          (_, i) => ((i + from) / (through + 1)) ** 2,
        ).reduce((sum, value) => sum + value, 0)
      expect(records[0]?.leaves.get('kk')?.weight[0]).toBeCloseTo(weight(1, 4), 12)
      expect(records[1]?.leaves.get('kk')?.weight[0]).toBeCloseTo(weight(1, warm ? 8 : 4), 12)
      expect(records[1]?.leaves.get('kb50c')?.weight[0]).toBeCloseTo(
        warm ? weight(5, 8) : weight(1, 4),
        12,
      )
      expect(calls.mock.results[1]?.value.strategy.get('')).toEqual(root.strategy.get(''))
    },
    120_000,
  )

  it('keeps inherited bounds, exact chips and replaces the per-card record for the actual turn line', () => {
    vi.mocked(publicDecisions).mockReturnValue([bet])
    const calls = vi.spyOn(solver, 'solveRiver')
    const records = vi.spyOn(leaves, 'createRiverPromiseRecord')
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
    const latest = records.mock.results.at(-1)?.value
    expect(latest).not.toBe(records.mock.results[0]?.value)
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

it.each(['allIn', 'raiseTo'] as const)(
  'widens an oversized %s beyond the raise cap using effective street chips',
  (kind) => {
    type State = RiverSolution & {
      players: readonly [string, string]
      offTree: OffTreeState<State>
    }
    const s = { ...spot, board: view('river').board, maxRaises: 1 }
    const state: OffTreeState<State> = {
      failures: new Map(),
      solve: (tree, fixedStrategies) => ({
        ...solveRiver(s, 8, undefined, undefined, undefined, tree, { fixedStrategies }),
        players: ['a', 'b'],
        offTree: state,
      }),
    }
    const initial: State = { ...solveRiver(s, 8), players: ['a', 'b'], offTree: state }
    const observation = {
      ...view('river', 'a'),
      actor: { ...view('river', 'a').actor, stack: 434, betStreet: 66, betHand: 209 },
    }
    const deviation = move(observation, kind === 'allIn' ? { kind } : { kind, to: 500 })
    expect(actualChipTarget(deviation, s)).toBe(500)
    expect(actualChipTarget(deviation, s, true)).toBe(300)
    const history = [
      move(view('river', 'a'), { kind: 'raiseTo', to: 66 }),
      move(view('river', 'b', 66), { kind: 'raiseTo', to: 219 }),
      deviation,
    ]
    const stats = offTreeStats()
    let replacements = 0
    const result = followWithResolving(initial, history, 1, stats, () => {
      replacements++
    })
    if (typeof result === 'string') throw new Error(result)
    expect(result.node).toMatchObject({
      history: 'b66b219a',
      paid: [300, 219],
      actions: ['f', 'c'],
    })
    expect(result.solved.strategy.get('b66')).toEqual(initial.strategy.get('b66'))
    expect(stats).toMatchObject({ events: 1, resolves: 1, failures: {} })
    expect(replacements).toBe(1)
    expect(
      followWithResolving(result.solved, history, 1, stats, () => {
        replacements++
      }),
    ).toEqual(result)
    expect(stats.events).toBe(1)
    expect(replacements).toBe(1)
  },
)

const capturedCases = JSON.parse(
  readFileSync(new URL('./bot-off-tree-cases.json', import.meta.url), 'utf8'),
) as readonly {
  roomId: string
  board: RiverSpot['board']
  pot: number
  stack: number
  history: string
  paid: readonly [number, number]
  actions: readonly string[]
  decision: PublicDecision
}[]

it.each(capturedCases)('replays the captured ref1-s5 failure at $roomId', async (fixture) => {
  // Reconstruct the actual legal public transcript, including earlier-street
  // chips, rather than inventing street targets from a simplified observation.
  const replay =
    await vi.importActual<typeof import('./bot-public-replay.js')>('./bot-public-replay.js')
  const decisions = replay.publicDecisions(fixture.decision.observation)
  if (decisions === null) throw new Error('captured transcript did not replay')
  const prefix = decisions.filter((d) => d.taken.street === 'flop')
  const first = prefix[0]?.observation.actor.playerId
  const second = fixture.decision.observation.seats.find((s) => s.playerId !== first)?.playerId
  if (!first || !second) throw new Error('captured players missing')
  const players = [first, second] as const
  const opponent = players.indexOf(fixture.decision.observation.actor.playerId)
  const self = opponent === 0 ? 1 : 0
  const root = prefix[0]?.observation
  if (root === undefined) throw new Error('missing street root')
  expect(Math.min(...root.seats.map((s) => s.stack + s.betStreet))).toBe(fixture.stack)
  expect(root.pot - root.seats.reduce((sum, s) => sum + s.betStreet, 0)).toBe(fixture.pot)
  const blocked = new Set(fixture.board.map(cardKey))
  const deck = makeDeck().filter((c) => !blocked.has(cardKey(c)))
  const holding = (start: number) => ({
    hole: deck.slice(start, start + 2) as [Card, Card],
    weight: 1,
  })
  const s: RiverSpot = {
    ...spot,
    board: fixture.board,
    pot: fixture.pot,
    stack: fixture.stack,
    maxRaises: 1,
    ranges: [
      [holding(0), holding(2)],
      [holding(4), holding(6)],
    ],
  }
  type State = RiverSolution & { players: typeof players; offTree: OffTreeState<State> }
  const state: OffTreeState<State> = {
    failures: new Map(),
    solve: (tree, fixedStrategies) => ({
      ...solveRiver(s, 8, undefined, undefined, undefined, tree, { fixedStrategies }),
      players,
      offTree: state,
    }),
  }
  const initial: State = { ...solveRiver(s, 8), players, offTree: state }
  const stats = offTreeStats()
  // LBR first probes its pot raise, so that exact branch is already present.
  const observation = fixture.decision.observation
  const potTarget = observation.currentBet + observation.pot + observation.amountToCall
  const probe: PublicDecision = {
    observation: fixture.decision.observation,
    taken: {
      ...fixture.decision.taken,
      action: { kind: 'raiseTo', to: potTarget },
      amountCommitted: potTarget - observation.actor.betStreet,
      streetBetAfter: potTarget,
    },
  }
  const probed = followWithResolving(initial, [...prefix, probe], self, stats, () => {})
  if (typeof probed === 'string') throw new Error(probed)
  const before = followWithResolving(probed.solved, prefix, self, stats, () => {})
  if (typeof before === 'string') throw new Error(before)
  expect(before.node).toMatchObject({
    history: fixture.history,
    paid: fixture.paid,
    actions: fixture.actions,
  })
  const raw = observation.actor.stack + observation.actor.betStreet
  expect(raw).toBeGreaterThan(fixture.stack)
  expect(actualChipTarget(fixture.decision, s)).toBe(raw)
  expect(() => addRiverAction(s, before.solved.tree, fixture.history, raw)).toThrow(
    'invalid actual chip target',
  )
  const result = followWithResolving(
    before.solved,
    [...prefix, fixture.decision],
    self,
    stats,
    () => {},
  )
  if (typeof result === 'string') throw new Error(result)
  const paid = [...fixture.paid]
  paid[opponent] = fixture.stack
  expect(result.node).toMatchObject({ history: `${fixture.history}a`, paid, actions: ['f', 'c'] })
  if (result.node.kind !== 'action') throw new Error('missing response')
  expect(result.node.children[result.node.actions.indexOf('c')]).toEqual({
    kind: 'showdown',
    paid: [fixture.stack, fixture.stack],
  })
  const ownRaise = fixture.history.replace(/b\d+$/, '')
  expect(result.solved.strategy.get(ownRaise)).toEqual(before.solved.strategy.get(ownRaise))
  expect(stats).toMatchObject({ events: 3, resolves: 3, failures: {} })
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

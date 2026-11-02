import {
  type BotObservationV1,
  type BotPolicyContextV1,
  championPersonality,
  DEFAULT_STAKE,
  mulberry32,
  type TurnAction,
} from '@river/engine'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as leaves from './bot-flop-turn-leaves.js'
import { pokerGuardPolicy } from './bot-poker-guard.js'
import { decisionNodes } from './bot-preflop-solve-tree.js'
import {
  defaultPreflopPackVersion,
  exactPreflopRanges,
  hasPreflopPack,
  loadPreflopPack,
  preflopClass,
  preflopLiveAction,
  pseudoHarmonicLower,
  samplePreflopAction,
  selectPreflopDepth,
  tablePreflopPolicy,
  tracePreflop,
} from './bot-preflop-tables.js'
import { publicDecisions } from './bot-public-replay.js'
import * as river from './bot-river-policy.js'
import { observationFor, profileFor } from './bot-service.js'
import { solvedFlopPolicy } from './bot-turn-policy.js'
import { defaultRoomConfig, Room } from './room.js'

/** The v3 pack is private; a fresh checkout skips the tests that play it. */
const v3 = hasPreflopPack('v3')

afterEach(() => vi.restoreAllMocks())
const person = championPersonality()
function room(depth = 100, bb = 500, otherDepth = depth) {
  const game = new Room(
    'preflop-test',
    defaultRoomConfig({
      seed: 'preflop-test',
      inviteCode: 'RIVER2',
      maxSeats: 2,
      seedCollectionMs: 0,
      stake: {
        ...DEFAULT_STAKE,
        smallBlind: bb / 2,
        bigBlind: bb,
        minBuyIn: Math.min(depth, otherDepth) * bb,
        maxBuyIn: Math.max(depth, otherDepth) * bb,
        defaultBuyIn: depth * bb,
      },
    }),
  )
  for (const [playerId, seat] of [
    ['a', 0],
    ['b', 1],
  ] as const) {
    expect(game.submit({ kind: 'join', playerId, name: playerId }).ok).toBe(true)
    expect(
      game.submit({ kind: 'sit', playerId, seat, buyIn: (seat === 0 ? depth : otherDepth) * bb })
        .ok,
    ).toBe(true)
  }
  expect(game.submit({ kind: 'startHand' }).ok).toBe(true)
  return game
}
function observation(game: Room): BotObservationV1 {
  const id = game.viewFor('').currentActor?.playerId
  if (!id) throw new Error('missing actor')
  const obs = observationFor(game.viewFor(id), id, undefined, game.id, game.currentActions())
  if (!obs) throw new Error('missing observation')
  return obs
}
function act(game: Room, action: TurnAction) {
  const playerId = observation(game).actor.playerId
  expect(game.submit({ kind: 'act', playerId, action }).ok).toBe(true)
}
function context(obs: BotObservationV1, rng = mulberry32(1)): BotPolicyContextV1 {
  return { observation: obs, personality: person, profile: profileFor(person), tilt: obs.tilt, rng }
}
function traced(obs: BotObservationV1) {
  const history = publicDecisions(obs)
  expect(history).not.toBeNull()
  const trace = tracePreflop(obs, history ?? [])
  if (typeof trace === 'string') throw new Error(trace)
  return trace
}

describe.skipIf(!v3)('v9gp public table path', () => {
  it('defaults to v3, keeps v2 loadable, and maps every supported open exactly', () => {
    expect(decisionNodes(loadPreflopPack(200).metadata.tree)[0]?.actions.map((a) => a.to)).toEqual([
      0.5, 1, 2, 2.5, 3, 200,
    ])
    expect(loadPreflopPack(200)).not.toBe(loadPreflopPack(200, 'v2'))
    for (const size of [2, 2.5, 3]) {
      const game = room()
      act(game, { kind: 'raiseTo', to: size * 500 })
      const obs = observation(game)
      const trace = traced(obs)
      expect(trace.node.kind === 'decision' && trace.node.id).toBe(`button/raise-${size}`)
      expect(trace.offTree).toEqual([])
      const legacy = tracePreflop(obs, publicDecisions(obs) ?? [], [loadPreflopPack(100, 'v2')])
      expect(typeof legacy).not.toBe('string')
      if (typeof legacy !== 'string') expect(legacy.offTree).toEqual(size === 2.5 ? [] : [0])
    }
  })
  it('maps physical cards to the suit-invariant table class', () => {
    const card = (rank: 'A' | 'K' | '7' | '2', suit: 'h' | 'd') => ({ rank, suit })
    expect(preflopClass([card('K', 'h'), card('A', 'h')])).toBe('AKs')
    expect(preflopClass([card('A', 'h'), card('K', 'd')])).toBe('AKo')
    expect(preflopClass([card('2', 'd'), card('7', 'h')])).toBe('72o')
    expect(preflopClass([card('A', 'h'), card('A', 'd')])).toBe('AA')
  })
  it.each([100, 200])(
    'looks up EVERY exported history at %i bb and uses its actual hole row',
    (depth) => {
      const pack = loadPreflopPack(depth)
      expect(
        decisionNodes(pack.metadata.tree)
          .map((n) => n.id)
          .sort(),
      ).toEqual(pack.nodes.map((n) => n.id).sort())
      for (const target of decisionNodes(pack.metadata.tree)) {
        const game = room(depth)
        for (const label of target.id.split('/').slice(1)) {
          act(
            game,
            label === 'limp' || label === 'call'
              ? { kind: 'call' }
              : label === 'jam'
                ? { kind: 'allIn' }
                : { kind: 'raiseTo', to: Math.round(Number(label.slice(6)) * 500) },
          )
        }
        const obs = observation(game)
        const trace = traced(obs)
        expect(trace.node).toEqual(target)
        expect(trace.offTree).toEqual([])
        const row = pack.nodes
          .find((n) => n.id === target.id)
          ?.classes.find((h) => h.hand === preflopClass(obs.actor.hole))?.frequencies
        if (!row) throw new Error('missing oracle row')
        let cumulative = 0
        for (const [k, p] of row.entries()) {
          if (p > 0) {
            const tables = tablePreflopPolicy(pokerGuardPolicy)
            expect(tables.policy.decide(context(obs, () => cumulative + p / 2)).decision).toEqual(
              preflopLiveAction(target.actions[k] as (typeof target.actions)[number], obs, 500),
            )
          }
          cumulative += p
        }
      }
    },
  )

  it('samples every node and all 169 rows within six binomial standard errors', () => {
    const rng = mulberry32(929)
    const draws = 4000
    for (const depth of [100, 200])
      for (const node of loadPreflopPack(depth).nodes)
        for (const row of node.classes) {
          const counts = row.frequencies.map(() => 0)
          for (let n = 0; n < draws; n++) {
            const k = samplePreflopAction(row.frequencies, rng)
            counts[k] = (counts[k] as number) + 1
          }
          row.frequencies.forEach((p, k) => {
            expect(Math.abs((counts[k] as number) / draws - p)).toBeLessThan(
              6 * Math.sqrt((p * (1 - p)) / draws) + 2 / draws,
            )
          })
        }
  }, 90_000)

  it('selects nearest depths, clamps, and permits additional depths', () => {
    expect([20, 100, 149, 150, 151, 200, 300].map((d) => selectPreflopDepth(d))).toEqual([
      { depth: 100, clamp: 'below' },
      { depth: 100, clamp: null },
      { depth: 100, clamp: null },
      { depth: 100, clamp: null },
      { depth: 200, clamp: null },
      { depth: 200, clamp: null },
      { depth: 200, clamp: 'above' },
    ])
    expect(selectPreflopDepth(45, [40, 100, 200]).depth).toBe(40)
    const source = tablePreflopPolicy(pokerGuardPolicy)
    source.policy.decide(context(observation(room(20))))
    source.policy.decide(context({ ...observation(room(300)), handNumber: 2 }))
    expect(source.stats).toMatchObject({
      clampedBelow: 1,
      clampedAbove: 1,
      packs: { 100: 1, 200: 1 },
    })
  })

  it('scales totals at 250/500 and keeps short-stack actions legal, including aliases and underraises', () => {
    for (const depth of [1, 1.5, 2, 8, 100, 200]) {
      const game = room(depth)
      const obs = observation(game)
      const trace = traced(obs)
      if (trace.node.kind !== 'decision') throw new Error('no decision')
      for (const action of trace.node.actions) {
        const live = preflopLiveAction(action, obs, 500)
        if (action.label === 'raise-2.5' && depth >= 100)
          expect(live).toEqual({ kind: 'raiseTo', to: 1250 })
        const copy = room(depth)
        act(copy, live)
      }
    }
    const game = room()
    act(game, { kind: 'raiseTo', to: 1500 })
    act(game, { kind: 'raiseTo', to: 15000 })
    const obs = observation(game)
    expect(preflopLiveAction({ label: 'raise-22', kind: 'raise', to: 22 }, obs, 500)).toEqual({
      kind: 'raiseTo',
      to: 28500,
    })
    act(game, preflopLiveAction({ label: 'raise-22', kind: 'raise', to: 22 }, obs, 500))
    const root = observation(room())
    const shortOpponent = {
      ...root,
      seats: root.seats.map((s) => (s.playerId === root.actor.playerId ? s : { ...s, stack: 400 })),
    }
    expect(preflopLiveAction({ label: 'jam', kind: 'jam', to: 100 }, shortOpponent, 500)).toEqual({
      kind: 'raiseTo',
      to: 1000,
    })
  })

  it('uses pseudo-harmonic bracketing, stable replay, and counts off-tree actions once', () => {
    expect(pseudoHarmonicLower(0, 0.2, 0.25)).toBeCloseTo(1 / 6, 14)
    expect(pseudoHarmonicLower(0.75, 0.75, 99)).toBe(1)
    expect(pseudoHarmonicLower(0.75, 99, 99)).toBe(0)
    const source = tablePreflopPolicy(pokerGuardPolicy)
    for (const size of [2.75, 30]) {
      const game = room()
      if (size === 30) {
        act(game, { kind: 'raiseTo', to: 1250 })
        act(game, { kind: 'raiseTo', to: 4500 })
      }
      act(game, { kind: 'raiseTo', to: size * 500 })
      const obs = { ...observation(game), handNumber: size }
      const trace = traced(obs)
      expect(trace.offTree).toEqual([size === 2.75 ? 0 : 2])
      expect(traced(obs).node).toEqual(trace.node)
      expect(trace.node.kind === 'decision' && trace.node.id).toMatch(
        size === 2.75 ? /^button\/raise-(2.5|3)$/ : /^button\/raise-2.5\/raise-9\/(raise-24|jam)$/,
      )
      source.policy.decide(context(obs))
      source.policy.decide(context(obs))
    }
    expect(source.stats.preflopOffTree).toBe(2)
    // Empirical translation frequencies across independently seeded public hand identities.
    const game = room()
    act(game, { kind: 'raiseTo', to: 1375 })
    const obs = observation(game)
    let lower = 0
    for (let handNumber = 1; handNumber <= 2000; handNumber++) {
      const trace = traced({ ...obs, handNumber })
      if (trace.node.kind === 'decision' && trace.node.id.endsWith('raise-2.5')) lower++
    }
    const p = pseudoHarmonicLower(0.75, 0.875, 1)
    expect(lower / 2000).toBeCloseTo(p, 1)
  })

  it('treats an oversized all-in as the same effective table jam', () => {
    const game = room(200, 500, 100)
    act(game, { kind: 'allIn' })
    const obs = observation(game)
    const trace = traced(obs)
    expect(trace.selection.depth).toBe(100)
    expect(trace.node.kind === 'decision' && trace.node.id).toBe('button/jam')
    expect(trace.offTree).toEqual([])
    const source = tablePreflopPolicy(pokerGuardPolicy)
    source.policy.decide(context(obs))
    expect(source.stats.preflopOffTree).toBe(0)
  })

  it('falls back to v6 on an unseen sequence or missing history', () => {
    const game = room()
    for (const to of [1250, 4500, 11000, 22000, 40000]) act(game, { kind: 'raiseTo', to })
    const obs = observation(game)
    const source = tablePreflopPolicy(pokerGuardPolicy)
    expect(source.policy.decide(context(obs)).decision).toEqual(
      pokerGuardPolicy.decide(context(obs)).decision,
    )
    expect(source.stats.fallbacks['unseen sequence']).toBe(1)
    const { actions: _actions, ...missing } = obs
    source.policy.decide(context(missing))
    expect(source.stats.fallbacks['missing history']).toBe(1)
  })

  it('keeps exact flop beliefs when an off-tree non-all-in translated to jam/call', () => {
    const game = room()
    act(game, { kind: 'raiseTo', to: 30000 })
    const before = observation(game)
    let handNumber = 1
    while (handNumber < 100) {
      const trace = traced({ ...before, handNumber })
      if (trace.node.kind === 'decision' && trace.node.id === 'button/jam') break
      handNumber++
    }
    expect(handNumber).toBeLessThan(100)
    act(game, { kind: 'call' })
    const obs = { ...observation(game), handNumber }
    const trace = traced(obs)
    expect(trace.node.kind).toBe('all-in')
    const source = tablePreflopPolicy(pokerGuardPolicy)
    expect(source.ranges(obs, publicDecisions(obs) ?? [], ['b', 'a'])).toEqual(
      exactPreflopRanges(trace, obs.board, ['b', 'a']),
    )
    expect(source.stats).toMatchObject({ preflopOffTree: 1, exactRanges: 1, rangeFallbacks: 0 })
  })

  it.each([100, 200])(
    'carries exact products for every combo in a four-bet/call line at %i bb',
    (depth) => {
      const game = room(depth)
      for (const to of [1250, 4500, 10350]) act(game, { kind: 'raiseTo', to })
      act(game, { kind: 'call' })
      const obs = observation(game)
      const trace = traced(obs)
      expect(trace.node.kind).toBe('flop')
      const ranges = exactPreflopRanges(trace, obs.board, ['b', 'a'])
      const pack = loadPreflopPack(depth)
      for (const [player, range] of ranges.entries())
        for (const holding of range) {
          const name = preflopClass(holding.hole)
          const p = (id: string, label: string) => {
            const node = decisionNodes(pack.metadata.tree).find((n) => n.id === id)
            const k = node?.actions.findIndex((a) => a.label === label) as number
            return pack.nodes.find((n) => n.id === id)?.classes.find((r) => r.hand === name)
              ?.frequencies[k] as number
          }
          const expected =
            player === 0
              ? p('button/raise-2.5', 'raise-9') * p('button/raise-2.5/raise-9/raise-20.7', 'call')
              : p('button', 'raise-2.5') * p('button/raise-2.5/raise-9', 'raise-20.7')
          expect(holding.weight).toBe(expected)
          expect(
            holding.hole.some((c) => obs.board.some((b) => b.rank === c.rank && b.suit === c.suit)),
          ).toBe(false)
        }
      expect(ranges[0]).toHaveLength(1176)
      expect(
        tablePreflopPolicy(pokerGuardPolicy).ranges(obs, publicDecisions(obs) ?? [], ['b', 'a']),
      ).toEqual(ranges)
      // Our actual hole cards remain in the counterfactual own range, as before.
      expect(ranges[1].some((h) => preflopClass(h.hole) === preflopClass(obs.actor.hole))).toBe(
        true,
      )
    },
  )

  it('feeds the exact ranges into the flop solve without trackRanges or a support floor', () => {
    const game = room()
    act(game, { kind: 'raiseTo', to: 1250 })
    act(game, { kind: 'call' })
    const obs = observation(game)
    const source = tablePreflopPolicy(pokerGuardPolicy)
    const tracker = vi.spyOn(river, 'trackRanges')
    const stop = new Error('stop before expensive solve')
    const leaf = vi.spyOn(leaves, 'perTurnShowdown').mockImplementation(() => {
      throw stop
    })
    const network = { buckets: 1, layers: [] }
    const chain = solvedFlopPolicy(network, network, {
      preflop: source,
      carry: 'both',
      turnStartNetwork: network,
      riverNetwork: network,
    })
    expect(() => chain.policy.decide(context(obs))).toThrow(stop)
    expect(tracker).not.toHaveBeenCalled()
    expect(source.stats.exactRanges).toBe(1)
    const expected = source.ranges(obs, publicDecisions(obs) ?? [], ['b', 'a'])?.map(river.combosOf)
    expect(leaf.mock.calls[0]?.[0].ranges).toEqual(expected)
  })
})

describe('the preflop pack switch', () => {
  it('plays v3 by default and the pack an experiment names', () => {
    expect(defaultPreflopPackVersion('')).toBe('v3')
    expect(defaultPreflopPackVersion('v4')).toBe('v4')
    expect(() => defaultPreflopPackVersion('v9')).toThrow()
    expect(loadPreflopPack(100, 'v4').metadata).toBeDefined()
  })
})

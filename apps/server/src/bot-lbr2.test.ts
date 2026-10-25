import {
  type BotObservationV1,
  type BotPolicy,
  type BotPolicyContextV1,
  DEFAULT_STAKE,
  mulberry32,
  parseCard,
  personalityPool,
} from '@river/engine'
import { describe, expect, it } from 'vitest'
import { alwaysCallPolicy, alwaysFoldPolicy, LBR_TUNING, localBestResponse } from './bot-lbr.js'
import { type LbrQueryPolicy, policyMoveShares } from './bot-lbr-query.js'
import { decisionClass, LBR_RANGE_TUNING } from './bot-lbr-range.js'
import {
  localBestResponse2,
  SHARK2_TUNING,
  type Shark2Choice,
  shark2Actions,
  shark2Arguments,
  shark2Equity,
  shark2Holdings,
} from './bot-lbr2.js'
import { opponentStatsPlugin } from './bot-opponent-reads.js'
import { riverSolverPolicy } from './bot-river-policy.js'
import { observationFor, profileFor } from './bot-service.js'
import { runSessions, type SessionHandFrame } from './bot-session-benchmark.js'
import { slumbotRoom } from './bot-slumbot.js'
import { solvedFlopPolicy } from './bot-turn-policy.js'
import type { RiverValueNetwork } from './bot-value-network.js'

const cast = personalityPool()
const focalPerson = cast[10]
const opponent = cast[0]
if (!focalPerson || !opponent) throw new Error('missing personalities')

/** Same pair-raiser fixture as bot-lbr.test.ts. */
const pairRaiser: BotPolicy = {
  id: 'pair-raiser',
  version: 1,
  decide(context) {
    const { observation } = context
    const [first, second] = observation.actor.hole
    const pair = first !== undefined && first.rank === second?.rank
    return {
      policyId: this.id,
      policyVersion: this.version,
      observationVersion: observation.version,
      decision: pair
        ? { kind: 'raiseTo', to: observation.legal.raiseTo.min }
        : observation.legal.check
          ? { kind: 'check' }
          : { kind: 'call' },
      fallbackReason: null,
    }
  },
}

function run(
  focal: BotPolicy,
  second: boolean,
  count: number,
  onChoice?: (choice: Shark2Choice) => void,
) {
  const shark = second
    ? localBestResponse2(focal, {
        createQueryPolicy: () => ({ ...focal }),
        ...(onChoice === undefined ? {} : { onChoice }),
      })
    : undefined
  const probe = shark ?? localBestResponse(focal)
  const hands = runSessions({
    seed: 'lbr-test',
    sessions: 2,
    handsPerSession: count / 2,
    table: {
      name: 'heads-up-best-response',
      style: 'best-response',
      entrants: [
        { personality: focalPerson as NonNullable<typeof focalPerson> },
        { personality: opponent as NonNullable<typeof opponent>, policy: probe.policy },
      ],
    },
    focalPolicy: focal,
    onFocalDecision: probe.watch,
    ...(shark === undefined ? {} : { onHandOpened: shark.watchHand }),
    allInAdjustment: true,
  }).hands
  return {
    raw: hands.reduce((sum, hand) => sum - hand.focalChips, 0),
    adjusted: hands.reduce((sum, hand) => sum - (hand.adjustedChips ?? hand.focalChips), 0),
    hands,
  }
}

function view(street: BotObservationV1['street'] = 'flop'): BotObservationV1 {
  return {
    version: 1,
    roomId: 'sizes',
    handNumber: 1,
    street,
    actor: {
      playerId: 'a',
      seat: 0,
      hole: ['Ah', 'Ad'].map(parseCard),
      stack: 10000,
      betHand: 100,
      betStreet: 0,
    },
    board: (street === 'preflop' ? [] : ['Ks', 'Qd', '7h']).map(parseCard),
    pot: 600,
    currentBet: 0,
    amountToCall: 0,
    legal: {
      fold: true,
      check: true,
      call: { enabled: false, amount: 0 },
      raiseTo: { enabled: true, min: 100, max: 10000 },
      allIn: { enabled: true, amount: 10000 },
    },
    seats: [],
    opponents: [],
    actions: [],
    tilt: { factor: 0 },
  }
}

describe('shark2', () => {
  it.each([alwaysFoldPolicy, alwaysCallPolicy, pairRaiser])(
    'wins at least as much against $id on the existing fixed deals',
    (focal) => {
      const count = focal === alwaysFoldPolicy ? 20 : 100
      const old = run(focal, false, count)
      const choices: Shark2Choice[] = []
      const next = run(focal, true, count, (choice) => choices.push(choice))
      console.info(
        `${focal.id}: old ${old.raw}, shark2 ${next.raw} chips; adjusted ${old.adjusted} / ${next.adjusted}`,
      )
      expect(next.raw).toBeGreaterThanOrEqual(old.raw)
      expect(next.adjusted).toBeGreaterThanOrEqual(old.adjusted)
      if (focal === alwaysFoldPolicy) {
        expect(next.raw).toBe(0.75 * DEFAULT_STAKE.bigBlind * count)
        expect(
          choices.some((choice) => choice.street === 'preflop' && choice.kind === 'raiseTo'),
        ).toBe(true)
      }
    },
    240_000,
  )

  it('offers legal opens, 3-bets, 4-bets, small bets, overbets and raises without duplicate jams', () => {
    const bb = DEFAULT_STAKE.bigBlind
    const pre = {
      ...view('preflop'),
      currentBet: bb,
      amountToCall: bb / 2,
      legal: { ...view().legal, raiseTo: { enabled: true, min: 2 * bb, max: 100000 } },
    }
    expect(shark2Actions(pre)).toEqual([
      { kind: 'raiseTo', to: 2 * bb },
      { kind: 'raiseTo', to: 2.5 * bb },
      { kind: 'raiseTo', to: 3 * bb },
      { kind: 'allIn' },
    ])
    expect(shark2Actions({ ...pre, currentBet: 3 * bb })).toEqual([
      { kind: 'raiseTo', to: 7.5 * bb },
      { kind: 'raiseTo', to: 9 * bb },
      { kind: 'raiseTo', to: 12 * bb },
      { kind: 'allIn' },
    ])
    expect(
      shark2Actions({ ...pre, currentBet: 9 * bb }).some(
        (action) => action.kind === 'raiseTo' && action.to === 27 * bb,
      ),
    ).toBe(true)
    expect(shark2Actions(view())).toEqual([
      { kind: 'raiseTo', to: 198 },
      { kind: 'raiseTo', to: 396 },
      { kind: 'raiseTo', to: 600 },
      { kind: 'raiseTo', to: 900 },
      { kind: 'allIn' },
    ])
    expect(shark2Actions({ ...view(), currentBet: 200, amountToCall: 200 })).toContainEqual({
      kind: 'raiseTo',
      to: 1400,
    })
    const short = {
      ...view(),
      actor: { ...view().actor, stack: 200 },
      legal: { ...view().legal, raiseTo: { enabled: true, min: 100, max: 200 } },
    }
    expect(shark2Actions(short)).toEqual([{ kind: 'raiseTo', to: 198 }, { kind: 'allIn' }])
    expect(
      shark2Actions({
        ...short,
        legal: {
          ...short.legal,
          raiseTo: { ...short.legal.raiseTo, enabled: false },
          allIn: { enabled: false, amount: 0 },
        },
      }),
    ).toEqual([])
  })

  it.each([0.33, 1.5])(
    'actually selects the %s-pot bet with local response valuation',
    (fraction) => {
      const focal: BotPolicy = {
        ...alwaysCallPolicy,
        id: `fold-at-${fraction}`,
        decide(context) {
          const observation = context.observation
          const entry = observation.actions?.at(-1)
          const bet = entry?.amountCommitted ?? 0
          const potBefore =
            (entry?.potBefore ?? observation.pot) +
            Math.max(0, observation.currentBet - observation.amountToCall)
          const answer =
            observation.street !== 'preflop' &&
            observation.amountToCall > 0 &&
            bet >= fraction * potBefore
              ? { ...alwaysFoldPolicy.decide(context) }
              : alwaysCallPolicy.decide(context)
          return { ...answer, policyId: this.id, policyVersion: this.version }
        },
      }
      const choices: { choice: Shark2Choice; pot: number }[] = []
      let pot = 0
      const probe = localBestResponse2(focal, {
        createQueryPolicy: () => ({ ...focal }),
        onChoice: (choice) => choices.push({ choice, pot }),
        tuning: { maximumHoldings: 600 },
      })
      runSessions({
        seed: 'shark2-sizing',
        sessions: 2,
        handsPerSession: 4,
        focalPolicy: focal,
        table: {
          name: 'sizes',
          style: 'plain',
          entrants: [
            { personality: focalPerson as NonNullable<typeof focalPerson> },
            {
              personality: opponent as NonNullable<typeof opponent>,
              policy: {
                ...probe.policy,
                decide(context) {
                  if (
                    context.observation.street === 'preflop' &&
                    context.observation.currentBet <= DEFAULT_STAKE.bigBlind
                  ) {
                    return {
                      ...alwaysCallPolicy.decide(context),
                      policyId: this.id,
                      policyVersion: this.version,
                      decision: { kind: 'raiseTo', to: 3 * DEFAULT_STAKE.bigBlind },
                    }
                  }
                  if (
                    context.observation.street === 'preflop' ||
                    context.observation.amountToCall > 0
                  )
                    return {
                      ...alwaysCallPolicy.decide(context),
                      policyId: this.id,
                      policyVersion: this.version,
                    }
                  pot = context.observation.pot
                  return probe.policy.decide(context)
                },
              },
            },
          ],
        },
        onHandOpened: probe.watchHand,
        onFocalDecision: probe.watch,
      })
      expect(
        choices.some(
          ({ choice, pot }) =>
            choice.decision.kind === 'raiseTo' &&
            choice.decision.to === Math.max(DEFAULT_STAKE.bigBlind, Math.round(fraction * pot)),
        ),
      ).toBe(true)
    },
    60_000,
  )

  it('enumerates live combos by default, samples reproducibly and computes exact river equity', () => {
    const observation = view()
    expect(shark2Holdings(observation.actor.hole, 'x')).toHaveLength(1225)
    expect(shark2Holdings([...observation.actor.hole, ...observation.board], 'x')).toHaveLength(
      1081,
    )
    expect(shark2Holdings(observation.actor.hole, 'x', 600)).toEqual(
      shark2Holdings(observation.actor.hole, 'x', 600),
    )
    expect(shark2Holdings(observation.actor.hole, 'x', 600)).toHaveLength(600)
    const river = {
      ...observation,
      street: 'river' as const,
      board: ['Ks', 'Qd', '7h', '2c', '3c'].map(parseCard),
    }
    expect(shark2Equity(river, [parseCard('Kh'), parseCard('Kd')], SHARK2_TUNING)).toBe(0)
    expect(shark2Equity(river, [parseCard('9h'), parseCard('9d')], SHARK2_TUNING)).toBe(1)
    expect(shark2Equity(river, [parseCard('Ac'), parseCard('As')], SHARK2_TUNING)).toBe(0.5)
  })

  it('keeps legacy defaults and positional CLI arguments, requiring an explicit opt-in', () => {
    expect(LBR_TUNING).toEqual({ equitySamples: 6 })
    expect(LBR_RANGE_TUNING).toEqual({
      samplesPerHolding: 4,
      maximumHoldings: 220,
      smoothing: 0.02,
    })
    const args = ['call', 'seed', '2', 'out.json', '10', 'champion']
    expect(shark2Arguments(args)).toEqual({ enabled: false, positional: args, tuning: {} })
    expect(
      shark2Arguments(['--shark2', ...args, '--shark2-holdings=600', '--shark2-draws=24']),
    ).toEqual({
      enabled: true,
      positional: args,
      tuning: { maximumHoldings: 600, samplesPerHolding: 24 },
    })
    expect(() => shark2Arguments(['--shark2-draws=24'])).toThrow('require --shark2')
    expect(() => shark2Arguments(['--shark2', '--shark2-turn-runouts=0'])).toThrow(
      'invalid shark2 flag',
    )
    expect(localBestResponse(alwaysCallPolicy).policy.id).toBe('local-best-response')
    // Captured from the untouched default probe on these fixed 40 deals.
    expect(run(alwaysCallPolicy, false, 40).raw).toBe(523500)
  })

  it('rejects a factory returning the live focal policy', () => {
    const probe = localBestResponse2(alwaysCallPolicy, {
      createQueryPolicy: () => alwaysCallPolicy,
    })
    let frame: SessionHandFrame | undefined
    let captured: BotPolicyContextV1 | undefined
    runSessions({
      seed: 'identity',
      sessions: 2,
      handsPerSession: 1,
      focalPolicy: alwaysCallPolicy,
      table: {
        name: 'identity',
        style: 'plain',
        entrants: [
          { personality: focalPerson as NonNullable<typeof focalPerson> },
          {
            personality: opponent as NonNullable<typeof opponent>,
            policy: {
              ...alwaysCallPolicy,
              decide(context) {
                captured = context
                return alwaysCallPolicy.decide(context)
              },
            },
          },
        ],
      },
      onHandOpened: (opened) => {
        frame = opened
      },
    })
    if (!frame || !captured) throw new Error('missing query frame')
    probe.watchHand(frame)
    expect(() => probe.policy.decide(captured as BotPolicyContextV1)).toThrow(
      'independent query policy',
    )
  })
})

const network: RiverValueNetwork = {
  buckets: 1,
  layers: [
    {
      rows: 2,
      columns: 4,
      slope: null,
      weight: new Float32Array(8),
      bias: Float32Array.of(0.5, 0.5),
    },
  ],
}

it('reports native river probabilities matching the policy RNG intervals for each holding', () => {
  const room = slumbotRoom(
    {
      action: 'ck/kk/kk/b100',
      clientPos: 1,
      hole: ['Ah', 'Ad'].map(parseCard),
      board: ['Ks', 'Qd', '7h', '2c', '3c'].map(parseCard),
    },
    { ours: 'a', theirs: 'b' },
  )
  const observation = observationFor(
    room.viewFor('a'),
    'a',
    undefined,
    room.id,
    room.currentActions(),
  )
  if (!observation) throw new Error('missing river observation')
  const solver = riverSolverPolicy(alwaysCallPolicy, 'exact-river-query', 1, { iterations: 4 })
  const context = {
    observation,
    personality: focalPerson as NonNullable<typeof focalPerson>,
    profile: profileFor(focalPerson as NonNullable<typeof focalPerson>),
    tilt: observation.tilt,
    rng: mulberry32(1),
  }
  const classes = ['fold', 'passive', 'aggressive'] as const
  const hooks = classes.map((taken) => policyMoveShares(solver.policy, context, taken))
  for (const hook of hooks) expect(hook).not.toBeNull()
  for (const holding of shark2Holdings(
    [...observation.actor.hole, ...observation.board],
    'exact-river',
    3,
  )) {
    const shares = hooks.map((hook) => hook?.(holding.hole) ?? Number.NaN)
    expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 10)
    const counts = classes.map(() => 0)
    for (let at = 0; at < 1000; at++) {
      const swapped = { ...observation, actor: { ...observation.actor, hole: holding.hole } }
      const answer = solver.policy.decide({
        ...context,
        observation: swapped,
        rng: () => (at + 0.5) / 1000,
      })
      const index = classes.indexOf(decisionClass(answer.decision, swapped))
      counts[index] = (counts[index] ?? 0) + 1
    }
    shares.forEach((share, at) => {
      expect(Math.abs(share - (counts[at] as number) / 1000)).toBeLessThan(0.002)
    })
  }
})

it('isolates hypothetical queries from live carried solves, decisions and opponent memory', () => {
  const makeChain = () =>
    solvedFlopPolicy(network, network, {
      carry: 'both',
      iterations: 2,
      scheme: 'dcfr',
      turnStartNetwork: network,
      riverNetwork: network,
    })
  const play = (inject: boolean) => {
    const chain = makeChain()
    const decisions: unknown[] = []
    const memories: unknown[] = []
    const queryChains: ReturnType<typeof makeChain>[] = []
    const probe = localBestResponse2(chain.policy, {
      createQueryPolicy: () => {
        const query = makeChain()
        queryChains.push(query)
        return query.policy
      },
      tuning: {
        maximumHoldings: 8,
        samplesPerHolding: 8,
        preflopRunouts: 12,
        flopRunouts: 12,
        turnRunouts: 12,
      },
    })
    let frame: SessionHandFrame | undefined
    let checks = 0
    const audits: { before: unknown; after: unknown }[] = []
    const hands = runSessions({
      seed: 'v9g-memory-regression',
      sessions: 2,
      handsPerSession: 3,
      focalPolicy: {
        ...chain.policy,
        decide(context) {
          const result = chain.policy.decide(context)
          decisions.push(result)
          memories.push(
            structuredClone({
              opponents: context.observation.opponents,
              stats: context.observation.opponentStats,
            }),
          )
          return result
        },
      },
      plugin: opponentStatsPlugin(),
      table: {
        name: 'isolation',
        style: 'plain',
        entrants: [
          { personality: focalPerson as NonNullable<typeof focalPerson> },
          {
            personality: opponent as NonNullable<typeof opponent>,
            policy: {
              ...alwaysCallPolicy,
              decide(context) {
                if (inject && context.observation.street === 'turn' && checks === 0) {
                  const before = structuredClone({
                    caches: chain.caches(),
                    stats: [chain.stats, chain.turn, chain.river],
                    observation: context.observation,
                    frame: frame?.focalOptions,
                  })
                  probe.policy.decide(context) // Deliberately discard it so both runs play the same hand.
                  audits.push({
                    before,
                    after: structuredClone({
                      caches: chain.caches(),
                      stats: [chain.stats, chain.turn, chain.river],
                      observation: context.observation,
                      frame: frame?.focalOptions,
                    }),
                  })
                  checks++
                }
                return alwaysCallPolicy.decide(context)
              },
            },
          },
        ],
      },
      onHandOpened: (opened) => {
        frame = opened
        probe.watchHand(opened)
      },
      onFocalDecision: probe.watch,
    }).hands
    for (const audit of audits) expect(audit.after).toEqual(audit.before)
    for (const query of queryChains) {
      expect(query.caches().flop?.entries).toBe(0)
      expect(query.caches().turn?.entries).toBe(0)
    }
    return {
      hands,
      decisions,
      memories,
      checks,
      queryStats: probe.stats,
      carries: chain.turn.carryUsed + chain.river.carryUsed,
    }
  }
  const clean = play(false)
  const noisy = play(true)
  expect(noisy.hands).toEqual(clean.hands)
  expect(noisy.decisions).toEqual(clean.decisions)
  expect(noisy.memories).toEqual(clean.memories)
  expect(noisy.checks).toBeGreaterThan(0)
  expect(noisy.queryStats.exactQueries).toBeGreaterThan(0)
  expect(noisy.carries).toBeGreaterThan(0)
}, 120_000)

it('uses a probability hook directly rather than estimating it from random draws', () => {
  let decisions = 0
  const focal = alwaysFoldPolicy
  const query: LbrQueryPolicy = {
    ...focal,
    decide(context) {
      decisions++
      return focal.decide(context)
    },
    moveShares: () => () => 1,
  }
  const probe = localBestResponse2(focal, {
    createQueryPolicy: () => ({ ...query }),
    tuning: { maximumHoldings: 20 },
  })
  runSessions({
    seed: 'hook',
    sessions: 2,
    handsPerSession: 2,
    focalPolicy: focal,
    table: {
      name: 'hook',
      style: 'plain',
      entrants: [
        { personality: focalPerson as NonNullable<typeof focalPerson> },
        { personality: opponent as NonNullable<typeof opponent>, policy: probe.policy },
      ],
    },
    onHandOpened: probe.watchHand,
    onFocalDecision: probe.watch,
  })
  expect(probe.stats.exactQueries).toBeGreaterThan(0)
  expect(probe.stats.sampledDecisions).toBe(0)
  expect(decisions).toBe(0)
  const observation = view()
  expect(
    query.moveShares?.(
      {
        observation,
        personality: focalPerson as NonNullable<typeof focalPerson>,
        profile: profileFor(focalPerson as NonNullable<typeof focalPerson>),
        tilt: observation.tilt,
        rng: mulberry32(1),
      },
      'fold',
    )?.([parseCard('2s'), parseCard('3s')]),
  ).toBe(1)
})

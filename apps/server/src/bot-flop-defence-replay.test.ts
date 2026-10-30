import { type BotPolicyContextV1, parseCard } from '@river/engine'
import { afterEach, expect, it, vi } from 'vitest'
import { type AivatDecision, captureCumulativeStrategy } from './bot-aivat.js'
import {
  flopSpots,
  type ReplayHand,
  type ReplayRow,
  replaySpot,
  type Spot,
  selectSpots,
  summarise,
} from './bot-flop-defence-replay.js'
import { observationFor } from './bot-service.js'
import { slumbotRoom } from './bot-slumbot.js'
import * as v9g from './bot-v9g-policy.js'

afterEach(() => vi.restoreAllMocks())

function fixture(action = 'b200c/kb200', clientPos: 0 | 1 = 0): ReplayHand {
  const room = slumbotRoom(
    {
      action,
      clientPos,
      hole: ['As', 'Kh'].map(parseCard),
      board: ['2h', '7d', 'Ts'].map(parseCard),
    },
    { ours: 'bot:jules', theirs: 'bot:slumbot' },
  )
  const observation = observationFor(
    room.viewFor('bot:jules'),
    'bot:jules',
    undefined,
    room.id,
    room.currentActions(),
  )
  if (!observation) throw new Error('fixture has no observation')
  const decision: AivatDecision = {
    observation,
    heuristic: 'pot-share-uniform-32-v1',
    control: {
      kind: 'action',
      taken: 'fold',
      choices: [{ action: 'fold', probability: 1, value: 0 }],
    },
    reason: null,
  }
  return {
    hand: 1,
    focal: 'v9gp',
    personality: 'jules',
    clientPos,
    hole: ['As', 'Kh'],
    slumbotHole: ['Qh', 'Jd'],
    action: `${action}f`,
    aivatDecisions: [decision],
  }
}

it('selects BB facing the first half-pot flop bet using attribution sizing', () => {
  expect(flopSpots(fixture(), 'log.jsonl', 2)).toEqual([
    { file: 'log.jsonl', line: 2, hand: 1, decision: 0, fraction: 0.5 },
  ])
  expect(flopSpots(fixture('b200c/b200b600'), 'log.jsonl', 2)).toEqual([])
  expect(flopSpots(fixture('b200c/b200', 1), 'log.jsonl', 2)).toEqual([])
  expect(flopSpots(fixture('b200c/kb160'), 'log.jsonl', 2)).toEqual([])
  expect(flopSpots(fixture('b200c/kb320'), 'log.jsonl', 2)[0]?.fraction).toBe(0.8)
  expect(flopSpots(fixture('b200c/kb321'), 'log.jsonl', 2)).toEqual([])
  const unknown = fixture()
  unknown.slumbotHole = null
  expect(flopSpots(unknown, 'log.jsonl', 2)).toEqual([])
})

it('samples deterministically independent of input ordering, then shards the selected sequence', () => {
  const spots: Spot[] = Array.from({ length: 40 }, (_, line) => ({
    file: 'log.jsonl',
    line,
    hand: line,
    decision: 1,
    fraction: 0.5,
  }))
  const all = selectSpots(spots, 17, 'seed')
  expect(selectSpots([...spots].reverse(), 17, 'seed')).toEqual(all)
  expect(selectSpots(spots, 17, 'different')).not.toEqual(all)
  const shards = [1, 2, 3].map((k) => selectSpots(spots, 17, 'seed', `${k}/3`))
  for (const [index, shard] of shards.entries())
    expect(shard).toEqual(all.filter((_, i) => i % 3 === index))
  expect(new Set(shards.flat().map((s) => s.line)).size).toBe(all.length)
  for (const shard of ['0/2', '3/2', '1/0', 'x'])
    expect(() => selectSpots(spots, 17, 'seed', shard)).toThrow('--shard')
})

it('replays earlier observations with logged actions despite different sampled actions, then releases fresh state', () => {
  const log = fixture()
  log.aivatDecisions = [
    fixture('b200').aivatDecisions[0] as AivatDecision,
    fixture('b200c').aivatDecisions[0] as AivatDecision,
    ...log.aivatDecisions,
  ]
  const spot = flopSpots(log, 'log.jsonl', 1)[0] as Spot
  const contexts: BotPolicyContextV1[] = []
  const releaseHand = vi.fn()
  const construct = vi.spyOn(v9g, 'v9gPolicy')
  vi.mocked(construct, { partial: true }).mockImplementation(() => ({
    policy: {
      id: 'replay-fixture',
      version: 1,
      releaseHand,
      decide(context: BotPolicyContextV1) {
        contexts.push(context)
        captureCumulativeStrategy(context.rng, [1], () => ({ kind: 'allIn' }))
        context.rng()
        return {
          policyId: 'replay-fixture',
          policyVersion: 1,
          observationVersion: 1,
          decision: { kind: 'allIn' },
          fallbackReason: null,
        }
      },
    },
  }))
  for (const variant of ['prod', 'big'] as const) {
    const row = replaySpot(log, spot, variant, 'runner-seed')
    expect(row.variantChoices).toEqual([
      { action: 'allIn', probability: 1, value: expect.any(Number) },
    ])
  }
  expect(construct.mock.calls).toEqual([
    [{ offTree: 'resolve', preflopTables: true }],
    [{ offTree: 'resolve', preflopTables: true, resolveIterationMultiplier: 10 }],
  ])
  expect(contexts.map((c) => c.observation)).toEqual([
    ...log.aivatDecisions.map((d) => d.observation),
    ...log.aivatDecisions.map((d) => d.observation),
  ])
  expect(contexts.every((c) => c.personality.id === 'jules' && c.profile.skill === 'og')).toBe(true)
  expect(releaseHand.mock.calls).toEqual([
    ['slumbot', 1],
    ['slumbot', 1],
  ])
})

it('reports paired fold means, equity deciles, parity, and both fold-weighted callEV conventions', () => {
  const row: ReplayRow = {
    file: 'log.jsonl',
    line: 1,
    hand: 0,
    decision: 1,
    fraction: 0.5,
    variant: 'prod',
    hole: ['As', 'Kh'],
    slumbotHole: ['Qh', 'Jd'],
    board: ['2h', '7d', 'Ts'],
    pot: 600,
    toCall: 200,
    equity: 0.75,
    loggedChoices: [
      { action: 'fold', probability: 0.6 },
      { action: 'call', probability: 0.4 },
    ],
    variantChoices: [
      { action: 'fold', probability: 0.5 },
      { action: 'call', probability: 0.5 },
    ],
    foldAbsDifference: 0.1,
    maxChoiceAbsDifference: 0.1,
    ms: 10,
  }
  const big: ReplayRow = {
    ...row,
    variant: 'big',
    variantChoices: [
      { action: 'fold', probability: 0.2 },
      { action: 'call', probability: 0.8 },
    ],
  }
  const result = summarise([row, big])
  expect(result.logged.meanFoldProbability).toBe(0.6)
  expect(result.prod?.meanFoldProbability).toBe(0.5)
  expect(result.big?.meanFoldProbability).toBe(0.2)
  expect(result.prod?.meanAbsFoldDifferenceFromLogged).toBeCloseTo(0.1)
  expect(result.prod?.meanFoldWeightedCallEVbb).toBe(2)
  expect(result.big?.meanFoldWeightedCallEVbb).toBe(0.8)
  expect(result.prod?.foldWeightedMeanCallEVbb).toBe(4)
  expect(result.prod?.equityDeciles[7]).toEqual({ decile: 7, spots: 1, meanFoldProbability: 0.5 })
  expect(() => summarise([row, row])).toThrow('duplicate')
  expect(() => summarise([row, { ...big, line: 2 }])).toThrow('identical spot sets')
})

import { mkdtempSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseCard } from '@river/engine'
import { afterEach, expect, it, vi } from 'vitest'
import {
  opponentPriorFromEnvironment,
  priorDigest,
  validateOpponentPrior,
} from './bot-opponent-prior.js'
import {
  buildOpponentPrior,
  opponentPriorHistory,
  type PriorHand,
} from './bot-opponent-prior-build.js'
import { pokerGuardPolicy } from './bot-poker-guard.js'
import {
  exactPreflopRanges,
  loadPreflopPack,
  tablePreflopPolicy,
  tracePreflop,
} from './bot-preflop-tables.js'
import { publicDecisions } from './bot-public-replay.js'
import { observationFor } from './bot-service.js'
import { slumbotRoom } from './bot-slumbot.js'

let directory: string | undefined
afterEach(() => {
  vi.unstubAllEnvs()
  if (directory) {
    for (const file of readdirSync(directory)) unlinkSync(join(directory, file))
    rmdirSync(directory)
    directory = undefined
  }
})
const available = () => [loadPreflopPack(100, 'v3'), loadPreflopPack(200, 'v3')]
function hand(action: string, clientPos: 0 | 1 = 0, slumbotHole = ['Ah', 'Kh']): PriorHand {
  return { action, clientPos, slumbotHole, hole: ['2c', '3d'], personality: 'test' }
}
function build(hands: PriorHand[], alpha = 20) {
  return buildOpponentPrior(
    [{ file: 'synthetic.jsonl', content: hands.map((h) => JSON.stringify(h)).join('\n') }],
    alpha,
  )
}
function observed(action: string, clientPos: 0 | 1) {
  const room = slumbotRoom(
    {
      action,
      clientPos,
      hole: ['2c', '3d'].map(parseCard),
      board: ['7h', '8s', '9c'].map(parseCard),
    },
    { ours: 'bot:test', theirs: 'bot:slumbot' },
  )
  const actor = room.viewFor('').currentActor?.playerId as string
  const observation = observationFor(
    room.viewFor(actor),
    actor,
    undefined,
    room.id,
    room.currentActions(),
  )
  if (!observation) throw new Error('missing observation')
  return observation
}

it('counts preflop folds and final unobserved opponent responses, with class smoothing and hashes', () => {
  const hands = [hand('b200f'), hand('f'), hand('b200c/kk'), hand('b200f', 1)]
  const prior = build(hands, 2)
  const root = prior.nodes.find((n) => n.nodeKey === 'button')
  const aks = root?.classes.find((r) => r.hand === 'AKs')
  expect(aks?.reach).toBe(3)
  expect(aks?.counts).toEqual([1, 0, 2, 0, 0, 0])
  const base = loadPreflopPack(200, 'v3')
    .nodes.find((n) => n.id === 'button')
    ?.classes.find((r) => r.hand === 'AKs')
  expect(aks?.frequencies[2]).toBe((2 + 2 * (base?.frequencies[2] as number)) / 5)
  const untouched = root?.classes.find((r) => r.hand === 'AA')
  expect(untouched?.frequencies).toEqual(
    loadPreflopPack(200, 'v3')
      .nodes.find((n) => n.id === 'button')
      ?.classes.find((r) => r.hand === 'AA')?.frequencies,
  )
  expect(
    prior.nodes.find((n) => n.nodeKey === 'button/raise-2')?.classes.find((r) => r.hand === 'AKs')
      ?.counts[0],
  ).toBe(1)
  expect(prior.diagnostics).toMatchObject({
    hands: 4,
    countedHands: 4,
    invalidHistory: 0,
    noObservationHands: 4,
    opponentSteps: 4,
  })
  expect(prior.inputs[0]?.sha256).toBe(priorDigest(hands.map((h) => JSON.stringify(h)).join('\n')))
  expect(() => build(hands, 0)).toThrow()
})

it('reuses observed prefixes and exact seeded off-tree node keys at play time', () => {
  const observation = { ...observed('b275c/', 0), roomId: 'seeded-room', handNumber: 19 }
  const h = { ...hand('b275c/kk'), aivatDecisions: [{ observation }] }
  const replay = opponentPriorHistory(h)
  expect(replay.reconstructed).toBe(0)
  const live = tracePreflop(observation, publicDecisions(observation) ?? [], available())
  const rebuilt = tracePreflop(replay.observation, replay.history, available())
  expect(rebuilt).toEqual(live)
  if (typeof live === 'string') throw new Error(live)
  expect(live.offTree).toEqual([0])
  const prior = build([h])
  const step = live.line[0]
  const row = prior.nodes
    .find((n) => n.depth === live.selection.depth && n.nodeKey === step?.node.id)
    ?.classes.find((r) => r.hand === 'AKs')
  expect(row?.counts[step?.indices[0] as number]).toBe(1)
  const beforeLast = observed('b200', 0)
  const suffix = opponentPriorHistory({
    ...hand('b200b700f'),
    aivatDecisions: [{ observation: beforeLast }],
  })
  expect(suffix.reconstructed).toBe(2)
  expect(
    build([{ ...hand('b200b700f'), aivatDecisions: [{ observation: beforeLast }] }])
      .nodes.find((n) => n.nodeKey === 'button/raise-2/raise-7')
      ?.classes.find((r) => r.hand === 'AKs')?.counts[0],
  ).toBe(1)
})

it('reports missing holes, invalid reconstructions and missing identities', () => {
  const prior = build([
    hand('x'),
    { ...hand('f'), slumbotHole: null },
    { ...hand('f'), personality: '' },
  ])
  expect(prior.diagnostics).toMatchObject({
    hands: 3,
    countedHands: 0,
    invalidHistory: 2,
    missingHole: 1,
  })
})

it('selects the same pack depth as the recorded public trace', () => {
  const full = observed('b200', 0)
  const observation = {
    ...full,
    actor: { ...full.actor, stack: full.actor.stack - 10_000 },
    seats: full.seats.map((seat) => ({ ...seat, stack: seat.stack - 10_000 })),
  }
  const live = tracePreflop(observation, publicDecisions(observation) ?? [], available())
  if (typeof live === 'string') throw new Error(live)
  expect(live.selection.depth).toBe(100)
  const prior = build([{ ...hand('b200f'), aivatDecisions: [{ observation }] }])
  expect(prior.nodes.map((node) => node.depth)).toEqual([live.selection.depth])
  expect(prior.diagnostics.invalidHistory).toBe(0)
})

it.each([0, 1] as const)(
  'leaves unset ranges identical and changes only the opponent in seat mapping %i',
  (clientPos) => {
    vi.stubEnv('RIVER_OPPONENT_PREFLOP_PRIOR', undefined)
    const observation = observed(clientPos === 0 ? 'b200c/' : 'b200c/k', clientPos)
    const history = publicDecisions(observation) ?? []
    const trace = tracePreflop(observation, history, available())
    if (typeof trace === 'string') throw new Error(trace)
    const players: readonly [string, string] = ['bot:test', 'bot:slumbot']
    const baseline = exactPreflopRanges(trace, observation.board, players)
    const source = tablePreflopPolicy(pokerGuardPolicy)
    expect(source.ranges(observation, history, players)).toEqual(baseline)
    const prior = build([hand('b200c/', clientPos)])
    directory = mkdtempSync(join(process.cwd(), 'art/out/opponent-prior-test-'))
    const file = join(directory, 'prior.json')
    writeFileSync(file, JSON.stringify(prior))
    vi.stubEnv('RIVER_OPPONENT_PREFLOP_PRIOR', file)
    const opted = tablePreflopPolicy(pokerGuardPolicy)
    const ours = observation.actor.playerId
    const ranges = opted.ranges(observation, history, players)
    const own = players.indexOf(ours)
    const other = 1 - own
    expect(ranges?.[own]).toEqual(baseline[own])
    expect(ranges?.[other]).not.toEqual(baseline[other])
    const opponentStep = trace.line.find((step) => trace.players[step.node.player] !== ours)
    const aks = ranges?.[other]?.find(
      (holding) =>
        holding.hole
          .map((c) => `${c.rank}${c.suit}`)
          .sort()
          .join('') === 'AhKh',
    )
    const expected = prior.nodes
      .find((node) => node.nodeKey === opponentStep?.node.id)
      ?.classes.find((row) => row.hand === 'AKs')
    expect(aks?.weight).toBe(
      opponentStep?.indices.reduce((sum, k) => sum + (expected?.frequencies[k] as number), 0),
    )
    const missing = { ...prior, nodes: [] }
    expect(exactPreflopRanges(trace, observation.board, players, { prior: missing, ours })).toEqual(
      baseline,
    )
    // Construction caches a validated file, rather than reading it at each flop.
    writeFileSync(file, 'broken')
    expect(opponentPriorFromEnvironment(available())).toBe(
      opponentPriorFromEnvironment(available()),
    )
    expect(opted.ranges(observation, history, players)).toEqual(ranges)
  },
)

it('rejects malformed files at policy construction and incompatible table identities', () => {
  directory = mkdtempSync(join(process.cwd(), 'art/out/opponent-prior-test-'))
  const file = join(directory, 'bad.json')
  writeFileSync(file, '{}')
  vi.stubEnv('RIVER_OPPONENT_PREFLOP_PRIOR', file)
  expect(() => tablePreflopPolicy(pokerGuardPolicy)).toThrow()
  const valid = build([hand('f')])
  for (const mutate of [
    (p: typeof valid) => {
      const row = p.nodes[0]?.classes[0]
      if (row) row.frequencies[0] = -1
    },
    (p: typeof valid) => {
      const node = p.nodes[0]
      if (node) node.nodeKey = 'unknown'
    },
    (p: typeof valid) => {
      const pack = p.packs[0]
      if (pack) pack.sha256 = '0'.repeat(64)
    },
    (p: typeof valid) => {
      const node = p.nodes[0]
      if (node) p.nodes.push(node)
    },
    (p: typeof valid) => {
      p.nodes[0]?.classes.pop()
    },
  ]) {
    const invalid = structuredClone(valid)
    mutate(invalid)
    expect(() => validateOpponentPrior(invalid, available())).toThrow()
  }
  vi.stubEnv('RIVER_PREFLOP_PACK', 'v4')
  expect(() => tablePreflopPolicy(pokerGuardPolicy)).toThrow('requires the v3 pack')
})

it('counts repeated opponent nodes once per hand and accounts for hands with no opponent decision', () => {
  const observation = observed('b200b700b1800', 0)
  const prior = build([
    { ...hand('b200b700b1800c/kk'), aivatDecisions: [{ observation }, { observation }] },
    hand('f', 1),
  ])
  expect(prior.diagnostics).toMatchObject({
    hands: 2,
    countedHands: 1,
    opponentSteps: 2,
    noOpponentDecisionHands: 1,
  })
  expect(
    prior.nodes.find((node) => node.nodeKey === 'button')?.classes.find((row) => row.hand === 'AKs')
      ?.reach,
  ).toBe(1)
  expect(
    prior.nodes
      .find((node) => node.nodeKey === 'button/raise-2/raise-7')
      ?.classes.find((row) => row.hand === 'AKs')?.reach,
  ).toBe(1)
})

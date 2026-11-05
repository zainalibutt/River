import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { type BotPolicy, mulberry32, parseCard, type TurnAction } from '@river/engine'
import { describe, expect, it } from 'vitest'
import {
  AIVAT_V2_HEURISTIC,
  AIVAT_V3_HEURISTIC,
  AIVAT_V4_HEURISTIC,
  type AivatNetworkVersion,
  type AivatRangeState,
  actionControl,
  aivatCorrection,
  captureCumulativeStrategy,
  withStrategyCapture,
} from './bot-aivat.js'
import { replaySlumbotHand } from './bot-aivat-replay.js'
import { aivatSolverState } from './bot-aivat-state.js'
import { enumerableAivatToy } from './bot-aivat-toy.js'
import { networkActionValue } from './bot-aivat-v2.js'
import { pokerGuardPolicy } from './bot-poker-guard.js'
import { riverSolverPolicy } from './bot-river-policy.js'
import { type RiverNode, type RiverSpot, riverTree } from './bot-river-solver.js'
import { actionFor, botPlayerId, observationFor } from './bot-service.js'
import { focalRotation } from './bot-session-campaign.js'
import { slumbotRoom } from './bot-slumbot.js'
import type { RiverValueNetwork } from './bot-value-network.js'

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const cards = (text: string) => text.split(' ').map(parseCard)
const personality = focalRotation()[0]
if (!personality) throw new Error('missing personality')
const ours = botPlayerId(personality.id)
const board = cards('2c 3d 7h 9s Jc')
const room = slumbotRoom(
  { action: 'ck/kk/kk/', clientPos: 0, hole: cards('As Ah'), board },
  { ours, theirs: 'bot:other' },
)
const observation = observationFor(room.viewFor(ours), ours)
if (!observation) throw new Error('missing observation')
const pair = (text: string) =>
  cards(text) as [ReturnType<typeof parseCard>, ReturnType<typeof parseCard>]
const ranges: AivatRangeState = {
  actorPlayer: 0,
  ranges: [
    [
      { hole: pair('As Ah'), weight: 1 },
      { hole: pair('4c 5c'), weight: 1 },
    ],
    [
      { hole: pair('Ks Kh'), weight: 1 },
      { hole: pair('4d 5d'), weight: 1 },
    ],
  ],
}
// Two buckets; own range's weaker-bucket mass affects all outputs. This makes
// range/order/chip mistakes visible without requiring external model files.
const weights = new Float32Array(4 * 7)
for (let row = 0; row < 4; row++) weights[row * 7 + 1] = 0.1
const network: RiverValueNetwork = {
  buckets: 2,
  layers: [
    {
      rows: 4,
      columns: 7,
      weight: weights,
      bias: Float32Array.from([0.2, 0.7, 0.4, 0.5]),
      slope: null,
    },
  ],
}

const frozenSpec = (version: AivatNetworkVersion) =>
  readFileSync(new URL(`../benchmark/frozen-${version}.json`, import.meta.url))

describe('frozen AIVAT networks', () => {
  it.each([
    ['v2', AIVAT_V2_HEURISTIC],
    ['v3', AIVAT_V3_HEURISTIC],
    ['v4', AIVAT_V4_HEURISTIC],
  ] as const)('pins the recipe and all six export hashes in frozen-%s', (version, id) => {
    const spec = JSON.parse(frozenSpec(version).toString('utf8'))
    const frozen = spec.estimators[version]
    expect(frozen.id).toBe(id)
    expect(frozen.models).toEqual({
      flop: {
        stem: 'flop2-ck50/river-buckets-128',
        jsonSha256: '8b1245ecd2c09040fb9f0862e8a03af297497c5f84cd974d56226a41cdd3ddff',
        binSha256: 'a82e78d6071545ec0ee4d9b239ba6218dcbab4e97b32197dbccf76c6cdd0f5d3',
      },
      turn: {
        stem: 'turnstart-c1-53k-e50/river-buckets-128',
        jsonSha256: '20848416424b84c6b58c71036c3476257bd9113e0c749e2c64804e17bb52797c',
        binSha256: '18f473d54de5790e0e1d0d7cc34a78f20b2c1dc90146e185da273e5f9cb6de36',
      },
      river: {
        stem: 'night1-buckets/river-buckets-128',
        jsonSha256: 'a02b91b39b6da6616230fa670734dc3aea062aad5ccc96b6d6fcd442f211032d',
        binSha256: '321f35f3fcff24a38a7456d96affc523ff94920e169579712e69686aaff8d330',
      },
    })
    expect(frozen.recipeSha256).toBe(digest(Buffer.from(JSON.stringify(frozen.recipe))))
  })

  it('pins the v4 implementation to the current sources', () => {
    const spec = JSON.parse(frozenSpec('v4').toString('utf8'))
    for (const [file, hash] of Object.entries(spec.estimators.v4.sourceSha256)) {
      expect(digest(readFileSync(new URL(file, import.meta.url))), file).toBe(hash)
    }
  })

  // v3's SIMD source changed; preserve its spec so recorded v3 runs still replay.
  it('keeps v3 retired but replayable, with v4 the same recipe and models', () => {
    expect(digest(frozenSpec('v3'))).toBe(
      'ddbee05066a76198eab5217f4d7801f582155f7ea4e8af1931339e0d0cb31607',
    )
    const v3 = JSON.parse(frozenSpec('v3').toString('utf8'))
    const v4 = JSON.parse(frozenSpec('v4').toString('utf8'))
    expect(v4.previousSpecification).toBe('frozen-v3.json')
    expect(v4.estimators.v4.recipe).toEqual(v3.estimators.v3.recipe)
    expect(v4.estimators.v4.recipeSha256).toBe(v3.estimators.v3.recipeSha256)
    expect(v4.estimators.v4.models).toEqual(v3.estimators.v3.models)
  })

  // v2's sources moved on with the flop re-solve work, so it no longer loads; its
  // spec stays byte-identical so the runs that recorded it still replay.
  it('keeps v2 retired but replayable, with v3 the same recipe and models', () => {
    expect(digest(frozenSpec('v2'))).toBe(
      '63cc42a3465163afdfa69600f583247c2fac693bd488bfe19de5d2c9835562b6',
    )
    const v2 = JSON.parse(frozenSpec('v2').toString('utf8'))
    const v3 = JSON.parse(frozenSpec('v3').toString('utf8'))
    expect(v3.previousSpecification).toBe('frozen-v2.json')
    expect(v3.estimators.v3.recipeSha256).toBe(v2.estimators.v2.recipeSha256)
    expect(v3.estimators.v3.models).toEqual(v2.estimators.v2.models)
  })

  it('centers imperfect network Q exactly over every supported action', () => {
    const toy = enumerableAivatToy((hero, action) =>
      networkActionValue(
        network,
        {
          ...observation,
          actor: { ...observation.actor, hole: pair(['4c 5c', 'Ks Kh', 'As Ah'][hero] ?? 'As Ah') },
        },
        action === 'check' ? { kind: 'check' } : { kind: 'raiseTo', to: 100 },
        ranges,
      ),
    )
    expect(toy.paths).toBe(18)
    expect(Math.abs(toy.bias)).toBeLessThan(1e-12)
    const alternatives = [
      { decision: { kind: 'check' }, probability: 0.2 },
      { decision: { kind: 'raiseTo', to: 100 }, probability: 0.3 },
      { decision: { kind: 'allIn' }, probability: 0.5 },
    ] as const
    const value = (action: TurnAction) => networkActionValue(network, observation, action, ranges)
    const controls = alternatives.map((choice) =>
      actionControl(observation, alternatives, choice.decision, (decision) => decision, value),
    )
    const expectation = controls.reduce(
      (sum, control, i) => sum + (alternatives[i]?.probability ?? 0) * aivatCorrection(control),
      0,
    )
    expect(Math.abs(expectation)).toBeLessThan(1e-10)
    expect(controls[0]?.choices).toEqual(controls[2]?.choices)
    expect(networkActionValue(network, observation, { kind: 'fold' }, ranges)).toBe(-100)
    const changed: AivatRangeState = {
      ...ranges,
      ranges: [[{ hole: pair('As Ah'), weight: 1 }], ranges.ranges[1]],
    }
    expect(value({ kind: 'check' })).not.toBe(
      networkActionValue(network, observation, { kind: 'check' }, changed),
    )
    expect(value({ kind: 'raiseTo', to: 100 })).toBeCloseTo(value({ kind: 'check' }) * 2, 4)
  })

  it('conditions both ranges on the public solver path and snapshots without RNG calls', () => {
    const spot: RiverSpot = {
      board,
      pot: 200,
      stack: 1000,
      ranges: ranges.ranges,
      betSizes: [0.5],
      allIn: false,
      maxRaises: 0,
    }
    const root = riverTree(spot) as Extract<RiverNode, { kind: 'action' }>
    const target = root.children[1] as Extract<RiverNode, { kind: 'action' }>
    const table = Float64Array.from([0.2, 0.8, 0.9, 0.1])
    const strategy = new Map([[root.history, table]])
    const snapshot = aivatSolverState(spot, root, strategy, target, 1)
    expect(snapshot.ranges[0].map((combo) => combo.weight)).toEqual([0.8, 0.09999999999999998])
    expect(snapshot.ranges[1].map((combo) => combo.weight)).toEqual([1, 1])
    let reads = 0
    let draws = 0
    const rng = () => {
      draws++
      return 0.5
    }
    const run = () =>
      captureCumulativeStrategy(
        rng,
        [0.5, 0.5],
        () => ({ kind: 'check' }),
        1,
        () => {
          reads++
          return snapshot
        },
      )
    withStrategyCapture(rng, run)
    expect(reads).toBe(0)
    expect(withStrategyCapture(rng, run, true).state).toBe(snapshot)
    expect(draws).toBe(0)
    expect(reads).toBe(1)
    expect(spot.ranges[0][0]?.weight).toBe(1)
    table.fill(0)
    expect(snapshot.ranges[0][0]?.weight).toBe(0.8)
  })

  it('records v2 ranges and fingerprints without changing the actual policy draw', () => {
    const policy: BotPolicy = {
      id: 'aivat-v2-test',
      version: 1,
      decide(context) {
        captureCumulativeStrategy(
          context.rng,
          [0.5, 0.5],
          (index) => (index === 0 ? { kind: 'check' } : { kind: 'raiseTo', to: 100 }),
          1,
          () => ranges,
        )
        return {
          policyId: this.id,
          policyVersion: 1,
          observationVersion: 1,
          fallbackReason: null,
          decision: context.rng() < 0.5 ? { kind: 'check' } : { kind: 'raiseTo', to: 100 },
        }
      },
    }
    const first = mulberry32(13)
    const second = mulberry32(13)
    const plain = actionFor(room.viewFor(ours), ours, personality, first, { policy })
    let recorded = false
    const captured = actionFor(room.viewFor(ours), ours, personality, second, {
      policy,
      aivatHeuristic: {
        id: AIVAT_V2_HEURISTIC,
        specificationSha256: 'test-only',
        value: (view, action, state) => {
          if (!state) throw new Error('missing ranges')
          return networkActionValue(network, view, action, state)
        },
      },
      aivat(row) {
        recorded = true
        expect(row.rangeState).toBe(ranges)
        expect(row.heuristic).toBe(AIVAT_V2_HEURISTIC)
        expect(row.specificationSha256).toBe('test-only')
        expect(row.control?.choices).toHaveLength(2)
      },
    })
    expect(recorded).toBe(true)
    expect(captured).toEqual(plain)
    expect(first()).toBe(second())
  })

  it('captures real solver ranges at the actual sampling site', () => {
    const solver = riverSolverPolicy(pokerGuardPolicy, 'aivat-real-solver', 1, { iterations: 2 })
    let captured = false
    actionFor(room.viewFor(ours), ours, personality, mulberry32(13), {
      policy: solver.policy,
      publicActions: room.currentActions(),
      aivatHeuristic: {
        id: AIVAT_V2_HEURISTIC,
        specificationSha256: 'test-only',
        value: (view, action, state) => {
          if (!state) throw new Error('missing solver ranges')
          return networkActionValue(network, view, action, state)
        },
      },
      aivat(row) {
        captured = true
        expect(row.reason).toBeNull()
        expect(row.rangeState?.ranges[0].length).toBeGreaterThan(1)
        expect(row.rangeState?.actorPlayer).toBe(0)
        expect(row.control?.choices.length).toBeGreaterThan(1)
      },
    })
    expect(captured).toBe(true)
  }, 30_000)

  it('does not manufacture action records when replaying historical terminal logs', () => {
    const result = replaySlumbotHand(
      {
        hand: 0,
        focal: 'v9g',
        clientPos: 0,
        hole: ['9c', '2h'],
        slumbotHole: ['Qs', '9s'],
        board: [],
        action: 'b200f',
        winnings: -100,
      },
      true,
    )
    expect(result.heuristic).toBeNull()
    expect(result.knownActions).toBe(0)
    expect(result.missingActions).toBeNull()
    expect(result.aivat).toBe(result.raw)
  })

  it.each([
    ['v2', AIVAT_V2_HEURISTIC],
    ['v3', AIVAT_V3_HEURISTIC],
  ] as const)('replays recorded %s decisions against their own frozen spec', (version, id) => {
    const specificationSha256 = digest(frozenSpec(version))
    const result = replaySlumbotHand(
      {
        hand: 0,
        focal: 'v9g',
        clientPos: 0,
        hole: ['9c', '2h'],
        slumbotHole: ['Qs', '9s'],
        board: [],
        action: 'b200f',
        winnings: -100,
        aivatDecisions: [
          {
            heuristic: id,
            specificationSha256,
            observation,
            control: null,
            reason: 'unsupported historical action',
          },
        ],
      },
      true,
    )
    expect(result.heuristic).toBe(id)
    expect(result.missingActions).toBe(1)
    expect(result.aivat).toBe(result.raw)
  })
})

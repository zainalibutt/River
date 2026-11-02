import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Card, cardKey, parseCard } from '@river/engine'
import { afterEach, expect, it, vi } from 'vitest'
import { type flopDumpSpot, type ReplayHand, replaySpot } from './bot-flop-defence-replay.js'
import {
  buildMatchedLocks,
  lockedRow,
  main,
  matchedDecision,
  matchedResolve,
  matchedSpotKey,
  parseHandKey,
  parseMatchedArgs,
  replaySpotForDump,
  type TexasNode,
  texasLookup,
} from './bot-flop-matched-range.js'
import { pokerGuardPolicy } from './bot-poker-guard.js'
import * as preflop from './bot-preflop-tables.js'
import * as solver from './bot-river-solver.js'
import { comboIndex52 } from './bot-river-value-data.js'
import { observationFor } from './bot-service.js'
import { slumbotRoom } from './bot-slumbot.js'
import * as v9g from './bot-v9g-policy.js'
import type { RiverValueNetwork } from './bot-value-network.js'

/** The v3 pack is private; a fresh checkout skips the tests that play it. */
const v3 = preflop.hasPreflopPack('v3')

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})
const cards = (text: string) => text.split(' ').map(parseCard)
const combo = (text: string, weight = 1) => ({ hole: cards(text) as [Card, Card], weight })
const node = (actions: string[], rows: Record<string, number[]>): TexasNode => ({
  actions,
  strategy: { strategy: rows },
})

it('parses both card orders into dump combo indices and rejects malformed keys', () => {
  expect(parseHandKey('KdKc')).toEqual(parseHandKey('KcKd'))
  expect(comboIndex52(...parseHandKey('KdKc'))).toBe(
    comboIndex52(cardKey(parseCard('Kd')), cardKey(parseCard('Kc'))),
  )
  for (const key of ['KdKd', 'KxKc', 'Kd Kc', '10dKc', ''])
    expect(() => parseHandKey(key)).toThrow()
})

it('uses only board-preserving suit permutations before the present hand-class mean', () => {
  const mono = texasLookup(node(['CHECK', 'BET 2.000000'], { KdQd: [0.2, 0.8] }), [
    '2s',
    '7s',
    'Ts',
  ])
  expect(mono.row(...parseHandKey('QcKc'))).toEqual([0.2, 0.8])
  expect(mono.counts).toEqual({ direct: 0, isomorphism: 1, class: 0, missing: 0 })
  const rainbow = texasLookup(
    node(['CHECK', 'BET 2.000000'], {
      KdQd: [0.2, 0.8],
      KhQh: [0.6, 0.4],
    }),
    ['2s', '7h', 'Td'],
  )
  expect(rainbow.row(...parseHandKey('KcQc'))?.[0]).toBeCloseTo(0.4)
  expect(rainbow.counts).toEqual({ direct: 0, isomorphism: 0, class: 1, missing: 0 })
  expect(rainbow.row(...parseHandKey('QdKd'))).toEqual([0.2, 0.8])
  expect(rainbow.row(...parseHandKey('AcQc'))).toBeUndefined()
  expect(rainbow.counts.missing).toBe(1)
  expect(() => texasLookup(node(['CHECK'], { KdKc: [0.5] }), ['2s', '7s', 'Ts'])).toThrow(
    'probabilities',
  )
})

const spot: solver.RiverSpot = {
  board: cards('2s 7s Ts'),
  pot: 400,
  stack: 2000,
  ranges: [
    [combo('Kd Kc', 0.3), combo('Ad Qd', 0.7)],
    [combo('Jh Jc', 0.4), combo('Ah Kh', 0.6)],
  ],
  betSizes: [0.5, 1],
  allIn: true,
  maxRaises: 1,
}
const texas: TexasNode = {
  ...node(['CHECK', 'BET 2.000000', 'ALLIN'], { KcKd: [0.25, 0.5, 0.25], AdQd: [0.8, 0.2, 0] }),
  childrens: {
    CHECK: node(['CHECK', 'BET 2.000000', 'BET 4.000000', 'ALLIN'], {
      JcJh: [0.2, 0.5, 0.2, 0.1],
      AhKh: [0.4, 0.2, 0.3, 0.1],
    }),
  },
}
function fixture() {
  const tree = solver.addRiverAction(spot, solver.riverTree(spot), 'k', 172)
  const blueprint = solver.solveRiver(spot, 8)
  const frozen = new Map([['', Float64Array.from([0.2, 0.4, 0.3, 0.1, 0.7, 0, 0.3, 0])]])
  const baseline = solver.solveRiver(spot, 8, undefined, undefined, undefined, tree, {
    fixedStrategies: frozen,
  })
  return { tree, blueprint, frozen, baseline }
}

it('locks only prefix rows, preserves exact probabilities and normalizes the alternatives', () => {
  const { baseline, frozen } = fixture()
  const locks = buildMatchedLocks('both', baseline, frozen, texas, 1.72)
  expect([...locks.fixedStrategies.keys()]).toEqual(['', 'k'])
  const root = Array.from(locks.fixedStrategies.get('') ?? [])
  for (const [a, p] of [0.25, 0.375, 0.28125, 0.09375].entries()) expect(root[a]).toBeCloseTo(p, 14)
  expect(root[4]).toBe(0.8)
  const ip = baseline.tree.kind === 'action' ? baseline.tree.children[0] : undefined
  if (ip?.kind !== 'action') throw new Error('missing IP')
  const bet = Array.from(locks.fixedStrategies.get('k') ?? [])
  const exact = ip.actions.indexOf('b172')
  expect(bet[exact]).toBe(0.5)
  const own = baseline.strategy.get('k') as Float64Array
  const residual = 0.5 + (own[ip.actions.indexOf('b200')] as number)
  expect(bet[ip.actions.indexOf('b200')]).toBeCloseTo(
    (0.5 * (own[ip.actions.indexOf('b200')] as number)) / residual,
  )
  expect(bet[ip.actions.indexOf('k')]).toBeCloseTo((0.5 * 0.2) / residual)
  expect(bet[ip.actions.indexOf('b400')]).toBeCloseTo((0.5 * 0.2) / residual)
  expect(bet[ip.actions.indexOf('a')]).toBeCloseTo((0.5 * 0.1) / residual)
  expect(bet[ip.actions.length + exact]).toBe(0.2)
  for (const [history, table] of locks.fixedStrategies) {
    const width = history === '' ? 4 : ip.actions.length
    for (let h = 0; h < table.length / width; h++) {
      const row = Array.from(table.subarray(h * width, (h + 1) * width))
      expect(row.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 14)
      expect(row.every((p) => p >= 0 && p <= 1)).toBe(true)
    }
  }
  expect(buildMatchedLocks('ip', baseline, frozen, texas, 1.72).fixedStrategies.get('')).toEqual(
    frozen.get(''),
  )
  expect(lockedRow(0, 0.4, [1, 0, 0])).toEqual([0.4, 0.6, 0])
  expect(buildMatchedLocks('none', baseline, frozen, texas, 1.72).fixedStrategies.size).toBe(0)
  expect(frozen.get('')?.[0]).toBe(0.2)
})

it('falls back to the bot strategy for unmatched IP action labels', () => {
  const { baseline, frozen } = fixture()
  const source = {
    ...texas,
    childrens: { CHECK: node(['CHECK', 'BET 2.000000'], { JcJh: [0.5, 0.5], AhKh: [0.8, 0.2] }) },
  }
  const locks = buildMatchedLocks('ip', baseline, frozen, source, 1.72)
  const ip = baseline.tree.kind === 'action' ? baseline.tree.children[0] : undefined
  if (ip?.kind !== 'action') throw new Error('missing IP')
  const row = locks.fixedStrategies.get('k') as Float64Array
  const own = baseline.strategy.get('k') as Float64Array
  const total =
    0.5 +
    (own[ip.actions.indexOf('b200')] as number) +
    (own[ip.actions.indexOf('b400')] as number) +
    (own[ip.actions.indexOf('a')] as number)
  expect(row[ip.actions.indexOf('b400')]).toBeCloseTo(
    (0.5 * (own[ip.actions.indexOf('b400')] as number)) / total,
  )
})

it('none equals an independent gadget-off solve with no fixed strategies', () => {
  const { tree, blueprint, frozen } = fixture()
  const capture = vi.fn()
  const solve = vi.fn((fixedStrategies: ReadonlyMap<string, Float64Array>) =>
    solver.solveRiver(spot, 12, undefined, undefined, undefined, tree, {
      scheme: 'dcfr',
      fixedStrategies,
    }),
  )
  const result = matchedResolve(
    'none',
    undefined,
    1.72,
    capture,
  )({ spot, tree, blueprint, fixedStrategies: frozen, solve })
  const independent = solver.solveRiver(spot, 12, undefined, undefined, undefined, tree, {
    scheme: 'dcfr',
  })
  expect(result.strategy).toEqual(independent.strategy)
  expect(solve).toHaveBeenCalledTimes(1)
  expect(solve.mock.calls[0]?.[0].size).toBe(0)
  expect(capture).toHaveBeenCalledTimes(1)
})

it('weights aggregate decisions by OOP locked reach and exports dump combo indices', () => {
  const { baseline, frozen } = fixture()
  const { fixedStrategies } = buildMatchedLocks('both', baseline, frozen, texas, 1.72)
  const solved = solver.solveRiver(spot, 8, undefined, undefined, undefined, baseline.tree, {
    fixedStrategies,
  })
  const output = matchedDecision(solved, 'kb172')
  const reach = [0.3 * 0.25, 0.7 * 0.8]
  expect(output.strategy.map((r) => r.combo)).toEqual(
    spot.ranges[0].map((c) => comboIndex52(cardKey(c.hole[0]), cardKey(c.hole[1]))),
  )
  expect(output.strategy.map((r) => r.reach)).toEqual(reach)
  const fold = output.actions.indexOf('f')
  expect(output.botFold).toBeCloseTo(
    output.strategy.reduce(
      (sum, row, h) => sum + (reach[h] as number) * (row.probabilities[fold] as number),
      0,
    ) / reach.reduce((a, b) => a + b, 0),
  )
})

it('parses multi-file inputs, lock alias and one-based shards without machine paths', () => {
  const args = [
    '--spots',
    'a.jsonl',
    'b.jsonl',
    '--index',
    'index.jsonl',
    '--solver',
    'solver',
    '--logs',
    'one.jsonl',
    'two.jsonl',
    '--out',
    'out.jsonl',
  ]
  expect(parseMatchedArgs(args)).toMatchObject({
    mode: 'both',
    spots: ['a.jsonl', 'b.jsonl'],
    logs: ['one.jsonl', 'two.jsonl'],
    k: 1,
    total: 1,
  })
  expect(parseMatchedArgs([...args, '--lock', 'ip', '--shard', '2/3'])).toMatchObject({
    mode: 'ip',
    k: 2,
    total: 3,
  })
  expect(() => parseMatchedArgs([...args, '--shard', '0/3'])).toThrow('--shard')
  expect(() => parseMatchedArgs([...args, '--mode', 'bad'])).toThrow('--mode')
  expect(matchedSpotKey('original/log.jsonl', 3)).toBe(matchedSpotKey('other\\log.jsonl', 3))
})

it.skipIf(!v3)(
  'runs all three CLI modes through production replay on synthetic logs, ranges and networks',
  async () => {
    for (const name of [
      'RIVER_DIAG_GADGET',
      'RIVER_DIAG_IP_JAM_OVER_RAISE',
      'RIVER_DIAG_ALLIN_RUNOUTS',
      'RIVER_FLOP_BET_SIZES',
      'RIVER_TURN_EXPLICIT_LEAF',
      'RIVER_TURN_RESIDUAL',
      'RIVER_TURN_RESIDUAL_REFRESH',
    ])
      vi.stubEnv(name, undefined)
    vi.stubEnv('RIVER_FLOP_NETWORK', 'fixture')
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
    const original = v9g.v9gPolicy
    vi.spyOn(v9g, 'v9gPolicy').mockImplementation((options) =>
      original(options, { turn: network, flop: network, turnStart: network, river: network }),
    )
    const table = preflop.tablePreflopPolicy(pokerGuardPolicy)
    vi.spyOn(preflop, 'tablePreflopPolicy').mockReturnValue({
      ...table,
      ranges: () => [
        [combo('Kd Kc', 0.3), combo('Ad Qd', 0.7)],
        [combo('Jh Jc', 0.4), combo('Ah Kh', 0.6)],
      ],
    })
    const room = slumbotRoom(
      { action: 'b200c/kb172', clientPos: 0, hole: cards('Kd Kc'), board: cards('2s 7s Ts') },
      { ours: 'bot:jules', theirs: 'bot:slumbot' },
    )
    const observation = observationFor(
      room.viewFor('bot:jules'),
      'bot:jules',
      undefined,
      room.id,
      room.currentActions(),
    )
    if (!observation) throw new Error('missing observation')
    const log: ReplayHand = {
      hand: 1,
      focal: 'v9gp',
      personality: 'jules',
      clientPos: 0,
      hole: ['Kd', 'Kc'],
      slumbotHole: ['Jh', 'Jc'],
      action: 'b200c/kb172f',
      aivatDecisions: [
        {
          observation,
          heuristic: 'pot-share-uniform-32-v1',
          reason: null,
          control: {
            kind: 'action',
            taken: 'fold',
            choices: [{ action: 'fold', probability: 1, value: 0 }],
          },
        },
      ],
    }
    let dump: ReturnType<typeof flopDumpSpot> | undefined
    replaySpot(
      log,
      { file: 'original/log.jsonl', line: 1, hand: 1, decision: 0, fraction: 0.43 },
      'prod',
      'fixture',
      (row) => {
        dump = row
      },
    )
    if (!dump) throw new Error('missing dump')
    expect(replaySpotForDump(log, dump).decision).toBe(0)
    const temporary = mkdtempSync(join(process.cwd(), 'apps/server/matched-fixture-'))
    try {
      const index = join(temporary, 'index.jsonl')
      const spots = join(temporary, 'spots.jsonl')
      const logs = join(temporary, 'log.jsonl')
      writeFileSync(
        index,
        `${JSON.stringify({ n: 1, file: 'old\\log.jsonl', hand: 1, bet: 1.72, history: 'kb172' })}\n`,
      )
      writeFileSync(spots, `${JSON.stringify(dump)}\n`)
      writeFileSync(logs, `${JSON.stringify(log)}\n`)
      writeFileSync(join(temporary, 'spot-01.json'), JSON.stringify(texas))
      for (const mode of ['none', 'ip', 'both']) {
        const calls = vi.spyOn(solver, 'solveRiver')
        const out = join(temporary, `${mode}.jsonl`)
        await main([
          '--spots',
          spots,
          '--index',
          index,
          '--solver',
          temporary,
          '--logs',
          logs,
          '--mode',
          mode,
          '--out',
          out,
        ])
        const output = JSON.parse(readFileSync(out, 'utf8'))
        expect(output).toMatchObject({
          n: 1,
          hand: 1,
          board: dump.board,
          mode,
          isomorphismMappedCombos: 0,
          classMappedCombos: 0,
        })
        expect(output.strategy).toHaveLength(2)
        const last = calls.mock.calls.at(-1)
        if (!last) throw new Error('no solve')
        expect(last[1]).toBe(40)
        expect(last[4]).toBeUndefined()
        expect(last[5]).toBeDefined()
        expect([...(last[6]?.fixedStrategies?.keys() ?? [])]).toEqual(
          mode === 'none' ? [] : ['', 'k'],
        )
        const result = calls.mock.results.at(-1)?.value as solver.RiverSolution
        expect(output.strategy).toEqual(matchedDecision(result, 'kb172').strategy)
        // Re-run the exact production showdown/tree/iterations with gadget off and no locks.
        if (mode === 'none') {
          const independent = solver.solveRiver(
            last[0],
            last[1],
            last[2],
            last[3],
            undefined,
            last[5],
            { scheme: 'dcfr' },
          )
          expect(result.strategy).toEqual(independent.strategy)
        }
        calls.mockRestore()
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true })
    }
  },
  180_000,
)

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cardKey, parseCard } from '@river/engine'
import { describe, expect, it } from 'vitest'
import { type RiverNode, riverTree, solveRiver, strategyRows } from './bot-river-solver.js'
import { comboIndex52 } from './bot-river-value-data.js'
import {
  classWeights,
  makeStreetSpecs,
  type StreetParitySpec,
  solveStreetParity,
  streetParityMain,
  streetParitySpot,
  texasInput,
  uniformClassRange,
  validateStreetSpec,
} from './bot-street-parity.js'
import type { RiverLeafEvaluator } from './bot-turn-river-leaves.js'

const board = ['Jc', '7h', '6h', '2d', '9s']
const indexOf = (a: string, b: string) => comboIndex52(cardKey(parseCard(a)), cardKey(parseCard(b)))
const addRanges = (a: number[], b: number[]) => a.map((w, i) => w + (b[i] as number))

function pairRange(rank: string, weight = 1) {
  const range = Array<number>(1326).fill(0)
  const suits = ['s', 'h', 'd', 'c']
  for (let a = 0; a < 4; a += 1)
    for (let b = a + 1; b < 4; b += 1)
      range[indexOf(`${rank}${suits[a]}`, `${rank}${suits[b]}`)] = weight
  return range
}

function fixture(overrides: Partial<StreetParitySpec> = {}): StreetParitySpec {
  return {
    n: 0,
    street: 'river',
    board,
    pot: 10,
    stack: 30,
    ranges: [pairRange('A'), pairRange('K')],
    betSize: 0.66,
    iterations: 30,
    ...overrides,
  }
}

describe('street parity specs', () => {
  it('validates the public game and both dense ranges', () => {
    expect(validateStreetSpec(fixture()).street).toBe('river')
    for (const overrides of [
      { n: -1 },
      { street: 'flop' },
      { board: board.slice(0, 4) },
      { board: ['Jc', '7h', '6h', '2d', 'Jc'] },
      { board: ['Jc', '7h', '6h', '2d', '9x'] },
      { pot: 0 },
      { stack: Number.POSITIVE_INFINITY },
      { iterations: 1.5 },
      { betSize: 0.5 },
      { ranges: [pairRange('A')] },
      { ranges: [[], pairRange('K')] },
      { ranges: [Array(1326).fill(0), pairRange('K')] },
      { ranges: [pairRange('A', -1), pairRange('K')] },
      { ranges: [pairRange('A', Number.NaN), pairRange('K')] },
    ])
      expect(() => validateStreetSpec({ ...fixture(), ...overrides })).toThrow()
    expect(() => validateStreetSpec(null)).toThrow('JSON object')
    expect(() =>
      validateStreetSpec(
        fixture({
          board: ['As', 'Ah', 'Jc', '7h', '6h'],
          ranges: [pairRange('A'), pairRange('A')],
        }),
      ),
    ).toThrow('no compatible joint deal')
  })

  it('requires uniformity across all unblocked members, including zeros and tiny weights', () => {
    const range = pairRange('A', 1e-12)
    expect(classWeights(range, board).get('AA')).toBe(1e-12)
    range[indexOf('As', 'Ah')] = 0
    expect(() => validateStreetSpec(fixture({ ranges: [range, pairRange('K')] }))).toThrow(
      'not class-uniform: AA',
    )
    // An arbitrary blocked member does not affect either solver's range.
    expect(() =>
      validateStreetSpec(
        fixture({ board: ['As', ...board.slice(1)], ranges: [range, pairRange('K')] }),
      ),
    ).not.toThrow()
  })

  it('averages on the final board and masks its blockers, without losing zero members', () => {
    const range = Array<number>(1326).fill(0)
    range[indexOf('As', 'Ah')] = 0.6
    range[indexOf('Ad', 'Ac')] = 0.3
    const averaged = uniformClassRange(range, ['Jc', '7h', '6h', 'As'])
    expect(averaged[indexOf('As', 'Ah')]).toBe(0)
    expect(averaged[indexOf('Ah', 'Ad')]).toBeCloseTo(0.1)
    expect(averaged[indexOf('Ad', 'Ac')]).toBeCloseTo(0.1)
    expect(classWeights(averaged, ['Jc', '7h', '6h', 'As']).get('AA')).toBeCloseTo(0.1)
  })

  it('selects dump spots without replacement and deals reproducibly without board collisions', () => {
    const roots = Array.from({ length: 5 }, (_, n) => ({
      board: ['Jc', '7h', '6h'],
      ranges: [pairRange('A', n + 1), pairRange('K')] as const,
    }))
    const options = { count: 4, seed: 'parity', street: 'river' as const, pot: 10, stack: 30 }
    const a = makeStreetSpecs(roots, options)
    expect(a).toEqual(makeStreetSpecs(roots, options))
    expect(a).not.toEqual(makeStreetSpecs(roots, { ...options, seed: 'other' }))
    expect(new Set(a.map((row) => Math.max(...row.ranges[0]))).size).toBe(4)
    for (const row of a) {
      expect(new Set(row.board).size).toBe(5)
      expect(validateStreetSpec(row)).toBe(row)
      const blocked = new Set(row.board.map((c) => cardKey(parseCard(c))))
      for (let low = 0; low < 52; low += 1)
        for (let high = low + 1; high < 52; high += 1)
          if (blocked.has(low) || blocked.has(high))
            expect(row.ranges[0][comboIndex52(low, high)]).toBe(0)
    }
    expect(makeStreetSpecs(roots, { ...options, street: 'turn', count: 1 })[0]?.board).toHaveLength(
      4,
    )
    expect(() => makeStreetSpecs(roots, { ...options, count: 6 })).toThrow('count exceeds')
  })
})

describe('standalone betting menu', () => {
  it('allows only fold/call/all-in facing a bet, and fold/call facing all-in for both players', () => {
    const spot = streetParitySpot(fixture())
    const walk = (node: RiverNode) => {
      if (node.kind !== 'action') return
      const facing = node.paid[node.player === 0 ? 1 : 0] > node.paid[node.player]
      expect(node.actions).toEqual(
        facing
          ? Math.max(...node.paid) === spot.stack
            ? ['f', 'c']
            : ['f', 'c', 'a']
          : ['k', 'b6.6', 'a'],
      )
      node.children.forEach(walk)
    }
    walk(riverTree(spot))
    // Existing production defaults still include rounded bets and non-all-in raises.
    const {
      allInRaisesOnly: _raises,
      allInThreshold: _threshold,
      fractionalBets: _fractional,
      ...production
    } = spot
    const original = riverTree(production)
    expect(original.kind === 'action' && original.actions).toEqual(['k', 'b7', 'a'])
    if (original.kind !== 'action') throw new Error('missing root')
    const response = original.children[1]
    expect(response?.kind === 'action' && response.actions.some((a) => a.startsWith('b'))).toBe(
      true,
    )
  })

  it('collapses at the inclusive 67% boundary, including fractional-bb pots', () => {
    for (const [pot, stack, expected] of [
      [67, 66, ['k', 'a']],
      [66.999, 66, ['k', 'b44.21934', 'a']],
      [0.5, 0.4, ['k', 'a']],
    ] as const) {
      const tree = riverTree(streetParitySpot(fixture({ pot, stack })))
      expect(tree.kind === 'action' && tree.actions).toEqual(expected)
      if (tree.kind !== 'action') throw new Error('missing root')
      const checked = tree.children[0]
      expect(checked?.kind === 'action' && checked.actions).toEqual(expected)
    }
  })
})

it('writes the requested TexasSolver commands, with no non-all-in raise sizes', () => {
  expect(texasInput(fixture(), '0-river.json', 3)).toBe(
    [
      'set_pot 10',
      'set_effective_stack 30',
      'set_board Jc,7h,6h,2d,9s',
      'set_range_oop AA:1',
      'set_range_ip KK:1',
      'set_bet_sizes oop,river,bet,66',
      'set_bet_sizes oop,river,allin',
      'set_bet_sizes ip,river,bet,66',
      'set_bet_sizes ip,river,allin',
      'set_allin_threshold 0.67',
      'build_tree',
      'set_thread_num 3',
      'set_accuracy 0.3',
      'set_max_iteration 1000',
      'set_print_interval 50',
      'set_use_isomorphism 1',
      'start_solve',
      'set_dump_rounds 2',
      'dump_result 0-river.json',
      '',
    ].join('\n'),
  )
  const turn = texasInput(fixture({ street: 'turn', board: board.slice(0, 4) }), '0-turn.json')
  expect(turn.match(/set_bet_sizes/g)).toHaveLength(8)
  expect(turn).not.toContain(',raise')
  expect(turn).toContain('oop,turn,bet,66')
  const tiny = addRanges(pairRange('A', 1e-12), pairRange('Q', 2e-12))
  const text = texasInput(fixture({ ranges: [tiny, pairRange('K')] }), 'tiny.json')
  expect(text).toContain('AA:1')
  expect(text).toContain('QQ:2')
  expect(() => texasInput(fixture(), 'bad path.json')).toThrow('whitespace')
  expect(() => texasInput(fixture(), 'ok.json', 0)).toThrow('threads')
})

it('solves a tiny river with the exact production core and weights the facing node by OOP check reach', () => {
  const mixed = addRanges(pairRange('A', 0.25), pairRange('8', 0.75))
  const spec = fixture({ ranges: [mixed, pairRange('K')], iterations: 100 })
  const result = solveStreetParity(spec, 2)
  expect(result.iterations).toBe(200)
  expect(result.ms).toBeGreaterThanOrEqual(0)
  expect(result.nodes.map((node) => node.history)).toEqual(['', 'k', 'kb6.6'])
  const solution = solveRiver(
    streetParitySpot(spec),
    200,
    undefined,
    undefined,
    undefined,
    undefined,
    { scheme: 'dcfr' },
  )
  for (const node of result.nodes) {
    expect(node.strategy.map((row) => row.probabilities)).toEqual(
      strategyRows(solution, node.history)?.map((row) => [...row]),
    )
    for (const row of node.strategy) {
      expect(row.probabilities.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12)
      expect(row.probabilities.every((p) => p >= 0 && p <= 1)).toBe(true)
      expect(spec.ranges[node.player][row.combo]).toBeGreaterThan(0)
    }
  }
  const root = result.nodes[0]
  const facing = result.nodes[2]
  if (!root || !facing) throw new Error('missing result node')
  let mass = 0
  let call = 0
  facing.strategy.forEach((row, h) => {
    const reach =
      (spec.ranges[0][row.combo] as number) *
      (root.strategy[h]?.probabilities[root.actions.indexOf('k')] as number)
    mass += reach
    call += reach * (row.probabilities[facing.actions.indexOf('c')] as number)
  })
  expect(result.facingBet.reachWeight).toBeCloseTo(mass, 12)
  expect(result.facingBet.call).toBeCloseTo(call / mass, 12)
  expect(
    (result.facingBet.fold ?? Number.NaN) +
      (result.facingBet.call ?? Number.NaN) +
      (result.facingBet.allIn ?? Number.NaN),
  ).toBeCloseTo(1, 12)
  const collapsed = solveStreetParity(fixture({ stack: 5 }))
  expect(collapsed.nodes[2]?.history).toBe('ka')
  expect(collapsed.facingBet.allIn).toBe(0)
  expect(() => solveStreetParity(spec, 0)).toThrow('multiplier')
  expect(() => solveStreetParity(spec, 0.001)).toThrow('scaled iterations')
})

it('runs turn CFR with per-river leaves, with no need for a carry record or turn-end network', () => {
  const seen = new Set<string>()
  const half = new Float64Array(1326).fill(0.5)
  const leaf: RiverLeafEvaluator = (spot) => {
    seen.add(spot.board.map((c) => `${c.rank}${c.suit}`).join(','))
    return [half, half]
  }
  const result = solveStreetParity(
    fixture({ street: 'turn', board: board.slice(0, 4), iterations: 2 }),
    1,
    leaf,
  )
  expect(result.street).toBe('turn')
  expect(seen.size).toBe(48)
  expect(result.nodes).toHaveLength(3)
})

it('runs both CLI modes on JSONL and rejects invalid input before opening output', () => {
  const dir = mkdtempSync(join(dirname(fileURLToPath(import.meta.url)), '.parity-test-'))
  try {
    const dump = join(dir, 'dump.jsonl')
    const spec = join(dir, 'spec.jsonl')
    const out = join(dir, 'out.jsonl')
    writeFileSync(
      dump,
      `${JSON.stringify({ type: 'header', schema: 'river-flop-root-v1' })}\n${JSON.stringify({ type: 'spot', board: board.slice(0, 3), root: { ranges: fixture().ranges } })}\n`,
    )
    streetParityMain([
      '--make-spec',
      '--dumps',
      dump,
      '--count',
      '1',
      '--seed',
      'cli',
      '--street',
      'river',
      '--pot',
      '10',
      '--stack',
      '30',
      '--iterations',
      '3',
      '--out',
      spec,
    ])
    const generated = validateStreetSpec(JSON.parse(readFileSync(spec, 'utf8')))
    expect(generated.iterations).toBe(3)
    streetParityMain([
      '--spec',
      spec,
      '--out',
      out,
      '--iterations-multiplier',
      '2',
      '--texas-dir',
      join(dir, 'texas'),
      '--threads',
      '2',
    ])
    const result = JSON.parse(readFileSync(out, 'utf8'))
    expect(result.iterations).toBe(6)
    expect(result.nodes).toHaveLength(3)
    expect(readFileSync(join(dir, 'texas', '0-river.txt'), 'utf8')).toContain('set_thread_num 2')
    writeFileSync(spec, `${JSON.stringify({ ...generated, betSize: 0.5 })}\n`)
    writeFileSync(out, 'preserved')
    expect(() => streetParityMain(['--spec', spec, '--out', out])).toThrow('spec row 1')
    expect(readFileSync(out, 'utf8')).toBe('preserved')
    expect(() => streetParityMain(['--spec', spec, '--out', out, '--typo', '1'])).toThrow('unknown')
    writeFileSync(spec, '{oops}\n')
    expect(() => streetParityMain(['--spec', spec, '--out', out])).toThrow('invalid JSON')
    writeFileSync(spec, `${JSON.stringify(generated)}\n${JSON.stringify(generated)}\n`)
    expect(() => streetParityMain(['--spec', spec, '--out', out])).toThrow('duplicate spec n')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

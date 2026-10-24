import { type BotObservationV1, type Card, cardKey, parseCard } from '@river/engine'
import { describe, expect, it } from 'vitest'
import { followWithResolving, type OffTreeState, offTreeStats } from './bot-off-tree.js'
import type { PublicDecision } from './bot-public-replay.js'
import { boundedRiverAdaptation, RIVER_ADAPTATION_ALLOWANCE } from './bot-river-adaptation.js'
import { carryFromRecord } from './bot-river-carry.js'
import {
  RIVER_POLICY_TUNING,
  type RiverReads,
  readBasedRiverProposal,
  readsModel,
} from './bot-river-policy.js'
import {
  type Player,
  prepare,
  type RangeCombo,
  type RiverGadget,
  type RiverNode,
  type RiverSolution,
  type RiverSpot,
  riverValues,
  type ShowdownValues,
  solveRiver,
} from './bot-river-solver.js'
import { COMBOS, comboIndex52 } from './bot-river-value-data.js'
import { solveBudgetedStreet } from './bot-safe-exploitation.js'
import {
  carriedPromises,
  createPromiseRecord,
  type PromiseRecord,
  perCardShowdown,
  type RiverLeafEvaluator,
} from './bot-turn-river-leaves.js'

// Reduced-deck hold'em, with one out-of-position bet and fold/call per street.
// Both boundaries use the production perTurnShowdown/perRiverShowdown kernel;
// only the deck and its N-board-4 chance divisor differ from 52-card hold'em.
// Run faults separately with CHAIN_MUTATION set to any nonempty entry below;
// each is expected to make both solver variants exit with a test failure.
const cards = (s: string) => s.split(' ').map(parseCard)
const deck = cards('2c 3d 4c Ac Ad Kc Kd Qc Qd 6c 6d')
const held = (s: string, weight = 1): RangeCombo => ({ hole: cards(s) as [Card, Card], weight })
const id = (h: RangeCombo) => comboIndex52(cardKey(h.hole[0]), cardKey(h.hole[1]))
const clear = (a: readonly Card[], b: readonly Card[]) =>
  a.every((c) => b.every((d) => cardKey(c) !== cardKey(d)))
const seats = [0, 1] as const
const iterations = 24
const mutation = process.env.CHAIN_MUTATION ?? ''
const mutations = [
  '',
  'refresh-turn',
  'refresh-river',
  'chip-origin',
  'holding-order',
  'blocked',
  'snapshot',
  'off-tree-refresh',
  'off-tree-drop',
  'off-tree-refresh-river',
  'off-tree-drop-river',
]
if (!mutations.includes(mutation)) throw new Error(`unknown CHAIN_MUTATION: ${mutation}`)
const root: RiverSpot = {
  board: cards('2c 3d 4c'),
  pot: 20,
  stack: 200,
  // Deliberately non-canonical order, unequal weights, cross-seat blockers.
  ranges: [
    [held('Kc Kd', 0.7), held('6c 6d', 0.4), held('Ac Ad', 1.2)],
    [held('Kc 6c', 0.8), held('Qc Qd', 1.3), held('Ac Qc', 0.6), held('6c 6d', 0.2)],
  ],
  betSizes: [0.5],
  allIn: false,
  maxRaises: 0,
}
const streetKey = (s: RiverSpot) => s.board.map(cardKey).join(',')
let offTreeOracle = false
const info = (s: RiverSpot, prefix: string, history: string, p: Player, h: RangeCombo) =>
  `${prefix}/${streetKey(s)}/${history}/${p}/${id(h)}`
type Policy = Map<string, number[]>
const playerOf = (key: string) => Number(key.split('/').at(-2))
const preUpdateReaches = new WeakMap<
  PromiseRecord,
  Map<string, { weight: number; reach: number[] }>
>()
let zeroReachQueries = 0
let exactQueries = 0
let maxExactGap = 0

// Independent 5-of-7 evaluator: no handScore, strength tables or solver values.
const scoreCache = new Map<string, number>()
function score(cs: readonly Card[]): number {
  const key = cs
    .map(cardKey)
    .sort((a, b) => a - b)
    .join(',')
  const cached = scoreCache.get(key)
  if (cached !== undefined) return cached
  let best = -1
  const five = (v: readonly Card[]) => {
    const rs = v.map((c) => '23456789TJQKA'.indexOf(c.rank) + 2).sort((a, b) => b - a)
    const groups = [...new Set(rs)]
      .map((r) => [rs.filter((x) => x === r).length, r])
      .sort((a, b) => (b[0] as number) - (a[0] as number) || (b[1] as number) - (a[1] as number))
    const flush = v.every((c) => c.suit === v[0]?.suit)
    const unique = [...new Set(rs)]
    const straight =
      unique.length === 5 && (rs[0] as number) - (rs[4] as number) === 4
        ? (rs[0] as number)
        : unique.join(',') === '14,5,4,3,2'
          ? 5
          : 0
    let category = 0
    let order = rs
    if (flush && straight) {
      category = 8
      order = [straight]
    } else if (groups[0]?.[0] === 4) {
      category = 7
      order = groups.map((g) => g[1] as number)
    } else if (groups[0]?.[0] === 3 && groups[1]?.[0] === 2) {
      category = 6
      order = groups.map((g) => g[1] as number)
    } else if (flush) category = 5
    else if (straight) {
      category = 4
      order = [straight]
    } else if (groups[0]?.[0] === 3) {
      category = 3
      order = groups.map((g) => g[1] as number)
    } else if (groups[0]?.[0] === 2) {
      category = groups[1]?.[0] === 2 ? 2 : 1
      order = groups.map((g) => g[1] as number)
    }
    let n = category
    for (let i = 0; i < 5; i++) n = n * 15 + (order[i] ?? 0)
    best = Math.max(best, n)
  }
  for (let a = 0; a < cs.length; a++)
    for (let b = a + 1; b < cs.length; b++) {
      five(cs.filter((_, i) => i !== a && i !== b))
    }
  scoreCache.set(key, best)
  return best
}
const share = (board: readonly Card[], a: RangeCombo, b: RangeCombo) => {
  const x = score([...board, ...a.hole])
  const y = score([...board, ...b.hole])
  return x === y ? 0.5 : x > y ? 1 : 0
}

// This betting tree is intentionally smaller than riverTree: no IP open-bet.
function betting(s: RiverSpot): RiverNode {
  const bet = Math.round(s.pot / 2)
  if (
    offTreeOracle &&
    ((s.board.length === 4 && cardKey(s.board[3] as Card) === cardKey(parseCard('Kc'))) ||
      (s.board.length === 5 &&
        s.pot === 74 &&
        cardKey(s.board[3] as Card) === cardKey(parseCard('Kc')) &&
        cardKey(s.board[4] as Card) === cardKey(parseCard('Kd'))))
  ) {
    const targets = [...new Set([bet, Math.round(s.pot * 0.43)])]
    return {
      kind: 'action',
      player: 0,
      history: '',
      paid: [0, 0],
      actions: ['k', ...targets.map((n) => `b${n}`)],
      children: [
        { kind: 'showdown', paid: [0, 0] },
        ...targets.map(
          (n): RiverNode => ({
            kind: 'action',
            player: 1,
            history: `b${n}`,
            paid: [n, 0],
            actions: ['f', 'c'],
            children: [
              { kind: 'fold', folder: 1, paid: [n, 0] },
              { kind: 'showdown', paid: [n, n] },
            ],
          }),
        ),
      ],
    }
  }
  return {
    kind: 'action',
    player: 0,
    history: '',
    paid: [0, 0],
    actions: ['k', `b${bet}`],
    children: [
      { kind: 'showdown', paid: [0, 0] },
      {
        kind: 'action',
        player: 1,
        history: `b${bet}`,
        paid: [bet, 0],
        actions: ['f', 'c'],
        children: [
          { kind: 'fold', folder: 1, paid: [bet, 0] },
          { kind: 'showdown', paid: [bet, bet] },
        ],
      },
    ],
  }
}
const nextSpot = (s: RiverSpot, paid: readonly number[], c: Card): RiverSpot => ({
  ...s,
  board: [...s.board, c],
  pot: s.pot + (paid[0] as number) + (paid[1] as number),
  stack: s.stack - Math.max(...paid),
  ranges: s.ranges.map((r) =>
    r.filter((h) => clear(h.hole, [c])),
  ) as unknown as RiverSpot['ranges'],
})

describe.each(['cfr+', 'dcfr'] as const)('%s off-tree three-street chain', (scheme) => {
  it('widens turn and river opponent bets with inherited bounds and audits full-game BR', () => {
    offTreeOracle = true
    try {
      const record = createPromiseRecord()
      const sums: Policy = new Map()
      const flop = solveRiver(
        root,
        iterations,
        undefined,
        leaf(root, '', record, sums),
        undefined,
        betting(root),
        { scheme },
      )
      const blueprint = normalized(sums)
      install(flop, '', blueprint)
      const br = seats.map((p) => aggregate(root, values(root, '', blueprint, p, true), p))
      const gap = Math.max(0, (br[0] as number) + (br[1] as number) - root.pot)
      expect(gap).toBeLessThan(1)
      const tolerance = 2 * gap + 1e-6
      const turnBase = nextSpot(root, [10, 10], parseCard('Kc'))
      const turnCarry = carryFromRecord(record, 'b10c', cardKey(parseCard('Kc')), 1, turnBase)
      const turnSpot = { ...turnBase, ranges: turnCarry.ranges }
      const stats = offTreeStats()
      const stripActual = (tree: RiverNode): RiverNode => {
        if (tree.kind !== 'action') throw new Error('expected betting root')
        return { ...tree, actions: tree.actions.slice(0, 2), children: tree.children.slice(0, 2) }
      }
      type Resolved = RiverSolution & {
        readonly players: readonly [string, string]
        readonly record?: PromiseRecord
        readonly continuation: Policy
        readonly offTree: OffTreeState<Resolved>
      }
      const resolve = (spot: RiverSpot, prefix: string, inherited: RiverGadget): Resolved => {
        const state: OffTreeState<Resolved> = {
          failures: new Map(),
          solve: (tree) => run(tree, true),
        }
        const run = (tree: RiverNode, widened: boolean): Resolved => {
          const rec = createPromiseRecord()
          const continuation: Policy = new Map()
          const showdown =
            spot.board.length === 4 ? leaf(spot, prefix, rec, continuation) : undefined
          let gadget = inherited
          if (
            widened &&
            (mutation === 'off-tree-refresh' ||
              (spot.board.length === 5 && mutation === 'off-tree-refresh-river'))
          ) {
            const fresh = solveRiver(spot, iterations, undefined, showdown, undefined, tree, {
              scheme,
            })
            gadget = { player: 0, promises: riverValues(fresh).values[0] }
          }
          if (
            widened &&
            (mutation === 'off-tree-drop' ||
              (spot.board.length === 5 && mutation === 'off-tree-drop-river'))
          )
            tree = stripActual(tree)
          const solution = solveRiver(spot, iterations, undefined, showdown, gadget, tree, {
            scheme,
          })
          expect(gadget.promises, 'off-tree solve retains inherited holding bounds').toBe(
            inherited.promises,
          )
          const policy = normalized(continuation)
          install(solution, prefix, policy)
          return {
            ...solution,
            players: ['opponent', 'us'],
            record: rec,
            continuation: policy,
            offTree: state,
          }
        }
        return run(stripActual(betting(spot)), false)
      }
      const follow = (initial: Resolved, target: number) => {
        const decision: PublicDecision = {
          observation: { actor: { playerId: 'opponent' } } as BotObservationV1,
          taken: {
            seat: 0,
            street: initial.spot.board.length === 4 ? 'turn' : 'river',
            action: { kind: 'raiseTo', to: target },
          },
        }
        const found = followWithResolving(initial, [decision], 1, stats, () => {})
        if (typeof found === 'string') throw new Error(found)
        expect(found.node.kind).toBe('action')
        expect(found.solved.tree.kind === 'action' && found.solved.tree.actions).toEqual([
          'k',
          `b${Math.round(initial.spot.pot / 2)}`,
          `b${target}`,
        ])
        return found.solved
      }
      const turnPrefix = '/b10c'
      const turn = follow(resolve(turnSpot, turnPrefix, turnCarry.gadget), 17)
      // Hand arithmetic: 40 + 17 + 17 = 74; 190 - 17 = 173 behind.
      const turnHistory = 'b17c'
      expect(turn.record?.leaves.get(turnHistory)?.paid).toEqual([17, 17])
      const riverCard = parseCard('Kd')
      const riverBase = nextSpot(turnSpot, [17, 17], riverCard)
      expect([riverBase.pot, riverBase.stack]).toEqual([74, 173])
      const riverCarry = carryFromRecord(
        turn.record as PromiseRecord,
        turnHistory,
        cardKey(riverCard),
        1,
        riverBase,
      )
      const source = turn.record?.leaves.get(turnHistory)
      const actual = carriedPromises(
        turn.record as PromiseRecord,
        turnHistory,
        cardKey(riverCard),
        1,
      )
      const translated = carriedPromises(
        turn.record as PromiseRecord,
        'b20c',
        cardKey(riverCard),
        1,
      )
      expect(actual.promises).not.toEqual(translated.promises)
      for (const [i, h] of prepare(riverCarry.ranges[0], riverBase.board).combos.entries()) {
        expect(riverCarry.gadget.promises[i]).toBeCloseTo(
          (actual.promises[id(h)] as number) * 74,
          8,
        )
        expect(source?.cards.get(cardKey(riverCard))).toBeDefined()
      }
      const riverSpot = { ...riverBase, ranges: riverCarry.ranges }
      const riverPrefix = `${turnPrefix}/${turnHistory}`
      const river = follow(resolve(riverSpot, riverPrefix, riverCarry.gadget), 32)
      const changed = (replacement: Policy, reference: Policy) =>
        Math.max(
          ...[...replacement]
            .filter(([key]) => playerOf(key) === 1)
            .flatMap(([key, row]) =>
              row.map((v, i) => Math.abs(v - (reference.get(key)?.[i] ?? v))),
            ),
        )
      expect(
        changed(turn.continuation, blueprint),
        'turn changes our continuation',
      ).toBeGreaterThan(1e-5)
      expect(
        changed(river.continuation, turn.continuation),
        'river changes our continuation',
      ).toBeGreaterThan(1e-5)
      const chain = new Map(blueprint)
      for (const replacement of [turn.continuation, river.continuation])
        for (const [key, row] of replacement) if (playerOf(key) === 1) chain.set(key, row)
      const chainedBR = aggregate(root, values(root, '', chain, 0, true), 0)
      expect(
        chainedBR,
        'independent full-game opponent BR including both actual sizes',
      ).toBeLessThanOrEqual((br[0] as number) + tolerance)
      expect(stats).toMatchObject({ events: 2, resolves: 2, failures: {} })
      // Budgeted river adaptation also composes on the actual widened tree.
      const modeled: import('./bot-river-solver.js').RiverOpponentModel = {
        player: 0,
        weight: 0.35,
        strategy: (node, hands) =>
          Float64Array.from(
            hands.combos.flatMap(() =>
              node.actions.map((_, a) => Number(a === node.actions.length - 1)),
            ),
          ),
      }
      const chosen = solveBudgetedStreet(river, modeled, riverSpot.ranges[0], 0.04)
      const adapted: Policy = new Map()
      install(chosen.solution, riverPrefix, adapted)
      const adaptedChain = new Map(chain)
      for (const [key, row] of adapted) if (playerOf(key) === 1) adaptedChain.set(key, row)
      const adaptedBR = aggregate(root, values(root, '', adaptedChain, 0, true), 0)
      expect(adaptedBR, 'v9gz widened river full-game BR').toBeLessThanOrEqual(
        chainedBR + 0.04 + 1e-9,
      )
      console.log(
        JSON.stringify({
          scheme,
          offTree: true,
          blueprintBR: br[0],
          chainedBR,
          gap,
          tolerance,
          stats,
        }),
      )
    } finally {
      offTreeOracle = false
    }
  }, 60_000)
})

// Two-phase simplex, max c*x subject to A*x <= b, x >= 0. Bland-style index
// tie breaking makes degenerate zero-reach continuations deterministic.
function lp(a: number[][], b: number[], c: number[]): number[] {
  const m = b.length
  const n = c.length
  const basic = Array.from({ length: m }, (_, i) => n + i)
  const nonbasic = Array.from({ length: n + 1 }, (_, i) => (i === n ? -1 : i))
  const d = Array.from({ length: m + 2 }, () => new Float64Array(n + 2))
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) (d[i] as Float64Array)[j] = a[i]?.[j] ?? 0
    ;(d[i] as Float64Array)[n] = -1
    ;(d[i] as Float64Array)[n + 1] = b[i] as number
  }
  for (let j = 0; j < n; j++) (d[m] as Float64Array)[j] = -(c[j] as number)
  ;(d[m + 1] as Float64Array)[n] = 1
  const pivot = (r: number, s: number) => {
    const inv = 1 / (d[r]?.[s] as number)
    for (let i = 0; i < m + 2; i++)
      if (i !== r) {
        for (let j = 0; j < n + 2; j++)
          if (j !== s) {
            ;(d[i] as Float64Array)[j] =
              ((d[i] as Float64Array)[j] as number) -
              (d[r]?.[j] as number) * (d[i]?.[s] as number) * inv
          }
      }
    for (let j = 0; j < n + 2; j++)
      if (j !== s) (d[r] as Float64Array)[j] = ((d[r] as Float64Array)[j] as number) * inv
    for (let i = 0; i < m + 2; i++)
      if (i !== r) (d[i] as Float64Array)[s] = ((d[i] as Float64Array)[s] as number) * -inv
    ;(d[r] as Float64Array)[s] = inv
    const old = basic[r] as number
    basic[r] = nonbasic[s] as number
    nonbasic[s] = old
  }
  const simplex = (phase: number) => {
    const row = phase === 1 ? m + 1 : m
    for (let steps = 0; steps < 10_000; steps++) {
      let s = -1
      for (let j = 0; j <= n; j++) {
        if (phase === 2 && nonbasic[j] === -1) continue
        if (
          s < 0 ||
          (d[row]?.[j] as number) < (d[row]?.[s] as number) - 1e-9 ||
          (Math.abs((d[row]?.[j] as number) - (d[row]?.[s] as number)) < 1e-9 &&
            (nonbasic[j] as number) < (nonbasic[s] as number))
        )
          s = j
      }
      if ((d[row]?.[s] as number) >= -1e-9) return
      let r = -1
      for (let i = 0; i < m; i++)
        if ((d[i]?.[s] as number) > 1e-9) {
          const ratio = (d[i]?.[n + 1] as number) / (d[i]?.[s] as number)
          const prev = r < 0 ? Infinity : (d[r]?.[n + 1] as number) / (d[r]?.[s] as number)
          if (
            ratio < prev - 1e-9 ||
            (Math.abs(ratio - prev) < 1e-9 && (basic[i] as number) < (basic[r] as number))
          )
            r = i
        }
      if (r < 0) throw new Error('unbounded oracle LP')
      pivot(r, s)
    }
    throw new Error('oracle LP pivot limit')
  }
  let r = 0
  for (let i = 1; i < m; i++) if ((b[i] as number) < (b[r] as number)) r = i
  if ((b[r] as number) < -1e-9) {
    pivot(r, n)
    simplex(1)
    if (Math.abs(d[m + 1]?.[n + 1] as number) > 1e-7) throw new Error('infeasible oracle LP')
    const artificial = basic.indexOf(-1)
    if (artificial >= 0) {
      const s = nonbasic.findIndex((_, j) => Math.abs(d[artificial]?.[j] as number) > 1e-9)
      if (s >= 0) pivot(artificial, s)
    }
  }
  simplex(2)
  const x = new Array<number>(n).fill(0)
  basic.forEach((v, i) => {
    if (v >= 0 && v < n) x[v] = d[i]?.[n + 1] as number
  })
  return x
}

type Flow = { key: string; parent: number; children: number[] }
type End = { seq: readonly [number, number]; i: number; j: number; chance: number; payoff: number }
// Sequence form enumerates every legal private deal, chance card and terminal.
// Flow constraints preserve imperfect information; no clairvoyant pairwise max.
function exact(s: RiverSpot, prefix: string) {
  const flows: [Flow[], Flow[]] = [[], []]
  const lookup = [new Map<string, Flow>(), new Map<string, Flow>()]
  const count: [number, number] = [1, 1]
  const ends: End[] = []
  const walk = (
    spot: RiverSpot,
    pre: string,
    node: RiverNode,
    history: string,
    hs: readonly [RangeCombo, RangeCombo],
    seq: readonly [number, number],
    chance: number,
    paid: readonly [number, number],
    i: number,
    j: number,
  ) => {
    if (node.kind === 'action') {
      const p = node.player
      const key = info(spot, pre, node.history, p, hs[p])
      let f = lookup[p]?.get(key)
      if (!f) {
        f = { key, parent: seq[p], children: node.actions.map(() => count[p]++ as number) }
        lookup[p]?.set(key, f)
        flows[p].push(f)
      }
      node.children.forEach((child, a) => {
        const next: [number, number] = [...seq]
        next[p] = f.children[a] as number
        walk(spot, pre, child, history + node.actions[a], hs, next, chance, paid, i, j)
      })
      return
    }
    const totalPaid: [number, number] = [paid[0] + node.paid[0], paid[1] + node.paid[1]]
    if (node.kind === 'fold' || spot.board.length === 5) {
      const won =
        node.kind === 'fold' ? (node.folder === 0 ? 0 : 1) : share(spot.board, hs[0], hs[1])
      ends.push({
        seq,
        i,
        j,
        chance,
        payoff: won * (s.pot + totalPaid[0] + totalPaid[1]) - totalPaid[0],
      })
      return
    }
    for (const c of deck)
      if (clear([c], [...spot.board, ...hs[0].hole, ...hs[1].hole])) {
        const next = nextSpot(spot, node.paid, c)
        walk(
          next,
          `${pre}/${history}`,
          betting(next),
          '',
          hs,
          seq,
          chance / (deck.length - spot.board.length - 4),
          totalPaid,
          i,
          j,
        )
      }
  }
  s.ranges[0].forEach((h, i) => {
    s.ranges[1].forEach((o, j) => {
      if (clear(h.hole, o.hole)) walk(s, prefix, betting(s), '', [h, o], [0, 0], 1, [0, 0], i, j)
    })
  })
  const policy: Policy = new Map()
  const realization = [new Map<string, number[]>(), new Map<string, number[]>()]
  for (const p of seats) {
    const other = p === 0 ? 1 : 0
    const ownCount = count[p] as number
    const oppCount = count[other] as number
    const oppRows = flows[other].length + 1
    const variables = ownCount + 2 * oppRows
    const a: number[][] = []
    const b: number[] = []
    const row = () => new Array<number>(variables).fill(0)
    const equality = (r: number[], rhs: number) => {
      a.push(
        r,
        r.map((x) => -x),
      )
      b.push(rhs, -rhs)
    }
    const r = row()
    r[0] = 1
    equality(r, 1)
    for (const f of flows[p]) {
      const r = row()
      r[f.parent] = -1
      for (const child of f.children) r[child] = 1
      equality(r, 0)
    }
    const constraints = Array.from({ length: oppCount }, row)
    const q = (seq: number, k: number, value: number) => {
      ;(constraints[seq] as number[])[ownCount + k] =
        ((constraints[seq] as number[])[ownCount + k] as number) + value
      ;(constraints[seq] as number[])[ownCount + oppRows + k] =
        ((constraints[seq] as number[])[ownCount + oppRows + k] as number) - value
    }
    q(0, 0, 1)
    flows[other].forEach((f, k) => {
      q(f.parent, k + 1, -1)
      for (const child of f.children) q(child, k + 1, 1)
    })
    for (const e of ends) {
      const weight = (s.ranges[0][e.i]?.weight as number) * (s.ranges[1][e.j]?.weight as number)
      ;(constraints[e.seq[other]] as number[])[e.seq[p]] =
        ((constraints[e.seq[other]] as number[])[e.seq[p]] as number) -
        e.chance * weight * (p === 0 ? e.payoff : s.pot - e.payoff)
    }
    a.push(...constraints)
    b.push(...constraints.map(() => 0))
    const c = row()
    c[ownCount] = 1
    c[ownCount + oppRows] = -1
    const x = lp(a, b, c)
    for (const f of flows[p]) {
      const xs = f.children.map((i) => Math.max(0, x[i] as number))
      const sum = xs.reduce((a, b) => a + b, 0)
      policy.set(f.key, sum > 1e-10 ? xs.map((v) => v / sum) : xs.map(() => 1 / xs.length))
      realization[p]?.set(f.key, xs)
    }
  }
  return { policy, realization }
}

// Independent full-game BR. At a responder information set, maximize AFTER
// summing all compatible opponent holdings; never choose by hidden deal.
function values(s: RiverSpot, prefix: string, policy: Policy, p: Player, best: boolean) {
  const other = p === 0 ? 1 : 0
  const probabilities = (key: string, width: number) => {
    const row = policy.get(key)
    if (
      row?.length !== width ||
      row.some((v) => !Number.isFinite(v) || v < -1e-9) ||
      Math.abs(row.reduce((a, b) => a + b, 0) - 1) > 1e-8
    ) {
      throw new Error(`missing or invalid full-game policy: ${key}`)
    }
    return row
  }
  return s.ranges[p].map((h) => {
    const walk = (
      spot: RiverSpot,
      pre: string,
      node: RiverNode,
      history: string,
      reach: number[],
      paid: readonly [number, number],
    ): number => {
      if (node.kind === 'action') {
        const actor = node.player
        const actions = node.actions
        const result = actions.map((action, ai) => {
          let r = reach
          if (actor === other)
            r = reach.map((w, j) => {
              if (w === 0) return 0
              const o = s.ranges[other][j] as RangeCombo
              return (
                w *
                (probabilities(info(spot, pre, history, other, o), actions.length)[ai] as number)
              )
            })
          return walk(spot, pre, node.children[ai] as RiverNode, history + action, r, paid)
        })
        if (actor === p) {
          if (best) return Math.max(...result)
          const probs = probabilities(info(spot, pre, history, p, h), actions.length)
          return result.reduce((a, v, i) => a + v * (probs[i] as number), 0)
        }
        return result.reduce((a, b) => a + b, 0)
      }
      const r = reach
      const nextPaid: [number, number] = [paid[0] + node.paid[0], paid[1] + node.paid[1]]
      const pot = s.pot + nextPaid[0] + nextPaid[1]
      if (node.kind === 'fold')
        return r.reduce((a, w) => a + w * (p === node.folder ? -nextPaid[p] : pot - nextPaid[p]), 0)
      const closed = history
      if (spot.board.length === 5)
        return r.reduce((a, w, j) => {
          const o = s.ranges[other][j] as RangeCombo
          return a + w * (share(spot.board, h, o) * pot - nextPaid[p])
        }, 0)
      let v = 0
      for (const c of deck)
        if (clear([c], [...spot.board, ...h.hole])) {
          const rr = r.map((w, j) => (clear([c], (s.ranges[other][j] as RangeCombo).hole) ? w : 0))
          if (rr.every((w) => w === 0)) continue
          const ns = nextSpot(spot, node.paid, c)
          v +=
            walk(ns, `${pre}/${closed}`, betting(ns), '', rr, nextPaid) /
            (deck.length - spot.board.length - 4)
        }
      return v
    }
    const reach = s.ranges[other].map((o) => (clear(h.hole, o.hole) ? o.weight : 0))
    const mass = reach.reduce((a, b) => a + b, 0)
    return mass > 0 ? walk(s, prefix, betting(s), '', reach, [0, 0]) / mass : 0
  })
}
function aggregate(s: RiverSpot, vs: number[], p: Player) {
  let sum = 0
  let mass = 0
  s.ranges[p].forEach((h, i) => {
    const m = s.ranges[p === 0 ? 1 : 0].reduce(
      (a, o) => a + (clear(h.hole, o.hole) ? h.weight * o.weight : 0),
      0,
    )
    mass += m
    sum += m * (vs[i] as number)
  })
  return mass > 0 ? sum / mass : 0
}

function install(solution: RiverSolution, prefix: string, policy: Policy) {
  const walk = (node: RiverNode) => {
    if (node.kind !== 'action') return
    const hands = prepare(solution.spot.ranges[node.player], solution.spot.board)
    hands.combos.forEach((h, i) => {
      policy.set(
        info(solution.spot, prefix, node.history, node.player, h),
        Array.from(
          solution.strategy
            .get(node.history)
            ?.slice(i * node.actions.length, (i + 1) * node.actions.length) ?? [],
        ),
      )
    })
    node.children.forEach(walk)
  }
  walk(solution.tree)
}

// Recreate the old root strategy table using its pre-regret own traversal,
// while leaving the production recorder's opponent-traversal CFVs untouched.
// The fixture has exactly one decision for player 0 on each street, so these
// two closed realizations reconstruct that table without a solver copy.
function oldSnapshot(solution: RiverSolution, record: PromiseRecord) {
  const table = solution.strategy.get('')
  if (!table) throw new Error('missing root strategy for snapshot mutation')
  const bet = Math.round(solution.spot.pot / 2)
  for (const [a, history] of ['k', `b${bet}c`].entries()) {
    const sample = preUpdateReaches.get(record)?.get(history)
    if (!sample) throw new Error('missing own-pass snapshot')
    solution.spot.ranges[0].forEach((h, i) => {
      table[i * 2 + a] = (sample.reach[i] as number) / sample.weight / h.weight
    })
  }
}

// Exact turn/river continuation strategies are averaged by OWN realization
// in the opponent traversal, just like the production snapshot recorder.
function leaf(s: RiverSpot, prefix: string, record: PromiseRecord, sums: Policy): ShowdownValues {
  const preUpdate = new Map<string, { weight: number; reach: number[] }>()
  preUpdateReaches.set(record, preUpdate)
  let traverser: Player = 0
  let history = ''
  let weight = 0
  const evaluator: RiverLeafEvaluator = (next) => {
    const pre = `${prefix}/${history}`
    const solved = exact(next, pre)
    const p = traverser === 0 ? 1 : 0
    for (const [key, xs] of solved.realization[p] ?? []) {
      const holding = Number(key.slice(key.lastIndexOf('/') + 1))
      const own = next.ranges[p].find((h) => id(h) === holding)?.weight ?? 0
      const before = sums.get(key) ?? xs.map(() => 0)
      sums.set(
        key,
        xs.map((x, i) => (before[i] as number) + weight * own * x),
      )
    }
    const out = [new Float64Array(COMBOS), new Float64Array(COMBOS)] as const
    let brSum = 0
    for (const p of seats) {
      const vs = values(next, pre, solved.policy, p, true)
      brSum += aggregate(next, vs, p)
      next.ranges[p].forEach((h, i) => {
        out[p][id(h)] = (vs[i] as number) / next.pot
      })
    }
    const legalMass = next.ranges[0].reduce(
      (a, h) =>
        a +
        next.ranges[1].reduce((b, o) => b + (clear(h.hole, o.hole) ? h.weight * o.weight : 0), 0),
      0,
    )
    if (legalMass > 1e-12) {
      const gap = Math.abs(brSum - next.pot)
      maxExactGap = Math.max(maxExactGap, gap)
      if (gap > 1e-6) throw new Error(`inexact continuation LP: ${gap}`)
    }
    exactQueries++
    if (next.ranges.some((r) => r.some((h) => h.weight === 0))) zeroReachQueries++
    return out
  }
  const candidates = deck
    .filter((c) => clear([c], s.board))
    .map((card) => {
      const ranks = new Uint16Array(COMBOS)
      for (const range of s.ranges)
        for (const h of range) if (clear(h.hole, [card])) ranks[id(h)] = 1
      return { card, key: cardKey(card), ranks }
    })
  const hook = perCardShowdown(
    s,
    evaluator,
    candidates,
    deck.length - s.board.length - 4,
    () => {
      throw new Error('fixture must not reach all-in')
    },
    record,
  )
  return (node, p, hands, self, opponent, out, visit) => {
    traverser = p
    history = visit?.history ?? ''
    weight = visit?.weight ?? 0
    // Simulate the pre-04b51ce own-pass strategy snapshot without modifying
    // production source: retain its closed realization for the mutation audit.
    if (p === 0 && visit) {
      const old = preUpdate.get(history) ?? { weight: 0, reach: Array.from(self, () => 0) }
      const discount = visit.discount ?? 1
      old.weight = old.weight * discount + weight
      old.reach = old.reach.map((v, i) => v * discount + weight * (self[i] as number))
      preUpdate.set(history, old)
    }
    if (visit?.discount !== undefined && visit.discount !== 1) {
      // Each information set belongs to exactly one closed street history.
      const start = `${prefix}/${history}/`
      for (const [key, xs] of sums)
        if (key.startsWith(start) && playerOf(key) === (p === 0 ? 1 : 0))
          sums.set(
            key,
            xs.map((x) => x * (visit.discount as number)),
          )
    }
    hook(node, p, hands, self, opponent, out, visit)
  }
}
function normalized(sums: Policy): Policy {
  return new Map(
    [...sums].map(([k, xs]) => {
      const total = xs.reduce((a, b) => a + b, 0)
      return [k, total > 0 ? xs.map((x) => x / total) : xs.map(() => 1 / xs.length)]
    }),
  )
}

// Separate boundary audit from the BR inequality: safety alone cannot detect
// every wrong promise (some errors are conservative). Audit uses explicit
// holding enumeration, returned strategy reaches, and recorded chip CFVs.
function boundary(
  record: PromiseRecord,
  history: string,
  card: Card,
  parent: RiverSolution,
  next: RiverSpot,
  refreshed: boolean,
) {
  const carry = carryFromRecord(record, history, cardKey(card), 0, next)
  const promised = carriedPromises(record, history, cardKey(card), 0)
  const source = record.leaves.get(history)
  if (!source) throw new Error('missing closed history')
  const raw = source.cards.get(cardKey(card))
  if (!raw) throw new Error('missing recorded public card')
  let promises = Float64Array.from(carry.gadget.promises)
  let ranges = carry.ranges
  if (refreshed) {
    const fresh = exact({ ...next, ranges }, 'refresh')
    promises = Float64Array.from(values({ ...next, ranges }, 'refresh', fresh.policy, 1, true))
  }
  if (mutation === 'chip-origin') promises = promises.map((v) => v - source.paid[1])
  if (mutation === 'holding-order') {
    // Rotate so distinct promises move even if the two end entries tie.
    ranges = [ranges[0], [...ranges[1].slice(1), ranges[1][0] as RangeCombo]]
  }
  if (mutation === 'blocked') {
    const blocked = parent.spot.ranges[1].find((h) => !clear(h.hole, next.board))
    if (blocked) ranges = [ranges[0], [...ranges[1], blocked]]
  }
  for (const p of seats)
    expect(
      ranges[p].every((h) => clear(h.hole, next.board)),
      'board blockers',
    ).toBe(true)
  const prepared = prepare(ranges[1], next.board)
  if (parent.spot.board.length === 3) {
    expect(
      prepare(carry.ranges[1], next.board).combos.map(id),
      'fixture changes prepared holding order',
    ).not.toEqual(parent.spot.ranges[1].filter((h) => clear(h.hole, next.board)).map(id))
  }
  expect(promises.length, 'one promise per prepared holding').toBe(prepared.combos.length)
  for (const o of parent.spot.ranges[1]) {
    const mass = ranges[0].reduce((v, h) => v + (clear(h.hole, o.hole) ? h.weight : 0), 0)
    if (!clear(o.hole, next.board) || mass === 0) {
      expect(
        carry.ranges[1].some((h) => id(h) === id(o)),
        'drop blocked/zero compatible mass',
      ).toBe(false)
      expect(promised.zeroMass[id(o)]).toBe(1)
    }
  }
  prepared.combos.forEach((o, i) => {
    let mass = 0
    for (const h of ranges[0]) if (clear(h.hole, o.hole)) mass += h.weight
    expect(mass).toBeGreaterThan(0)
    const old = (raw[1][id(o)] as number) / source.weight[0]
    expect(promised.cfvs[id(o)]).toBeCloseTo(old, 8)
    expect(promised.masses[id(o)]).toBeCloseTo(mass, 8)
    expect(
      promises[i],
      'inherited chip CFV / compatible mass + paid, remapped by holding',
    ).toBeCloseTo(old / mass + source.paid[1], 7)
  })
  // A zero opponent realization must retain its counterfactual deviation.
  // Copy a real recorded leaf, zero only that player's reach, and leave the
  // inherited CFVs and our positive compatible mass untouched.
  const zero = prepared.combos[0]
  if (!zero) throw new Error('missing zero-reach support witness')
  const zeroRecord: PromiseRecord = { leaves: new Map(record.leaves) }
  const zeroOpponent = Float64Array.from(source.reach[1])
  zeroOpponent[id(zero)] = 0
  zeroRecord.leaves.set(history, { ...source, reach: [source.reach[0], zeroOpponent] })
  const zeroCarry = carryFromRecord(zeroRecord, history, cardKey(card), 0, next)
  expect(
    zeroCarry.ranges[1].find((h) => id(h) === id(zero))?.weight,
    'zero-reach opponent retains positive placeholder',
  ).toBe(1)
  expect(zeroCarry.gadget.promises).toEqual(carry.gadget.promises)
  // Independently multiply returned average policy along this closed history.
  const reach = parent.spot.ranges[0].map((h) => h.weight)
  const walk = (node: RiverNode, line: string): boolean => {
    if (node.kind !== 'action') return line === history
    for (let a = 0; a < node.actions.length; a++) {
      const action = node.actions[a] as string
      if (!history.startsWith(line + action)) continue
      if (node.player === 0) {
        const table = parent.strategy.get(node.history)
        reach.forEach((w, i) => {
          reach[i] = w * (table?.[i * node.actions.length + a] as number)
        })
      }
      return walk(node.children[a] as RiverNode, line + action)
    }
    return false
  }
  expect(walk(parent.tree, '')).toBe(true)
  parent.spot.ranges[0].forEach((h, i) => {
    if (clear(h.hole, [card]))
      expect(promised.reach[id(h)], 'closed-policy snapshot reach').toBeCloseTo(
        reach[i] as number,
        8,
      )
  })
  return { ranges, gadget: { ...carry.gadget, promises } }
}

describe.each(['cfr+', 'dcfr'] as const)('%s three-street chain oracle', (scheme) => {
  it('inherits both promises and bounds independent full-game opponent BR', () => {
    zeroReachQueries = 0
    exactQueries = 0
    maxExactGap = 0
    // LP is certified by independent full-game BR enumeration here and at
    // every positive-mass continuation query during both production solves.
    const certSpot = nextSpot(root, [10, 10], parseCard('Kc'))
    const certificate = exact(certSpot, '')
    const exactBr = seats.map((p) =>
      aggregate(certSpot, values(certSpot, '', certificate.policy, p, true), p),
    )
    expect((exactBr[0] as number) + (exactBr[1] as number) - certSpot.pot).toBeLessThan(1e-6)
    const record = createPromiseRecord()
    const sums: Policy = new Map()
    const flop = solveRiver(
      root,
      iterations,
      undefined,
      leaf(root, '', record, sums),
      undefined,
      betting(root),
      { scheme },
    )
    if (mutation === 'snapshot') oldSnapshot(flop, record)
    const blueprint = normalized(sums)
    install(flop, '', blueprint)
    const br = seats.map((p) => aggregate(root, values(root, '', blueprint, p, true), p))
    const ev = seats.map((p) => aggregate(root, values(root, '', blueprint, p, false), p))
    expect((ev[0] as number) + (ev[1] as number)).toBeCloseTo(root.pot, 9)
    for (const p of seats) expect(br[p] as number).toBeGreaterThanOrEqual((ev[p] as number) - 1e-8)
    const gap = Math.max(0, (br[0] as number) + (br[1] as number) - root.pot)
    expect(gap).toBeLessThan(1) // a loose oracle must not silently accept anything
    const history = 'b10c'
    const turnCard = parseCard('Kc')
    const turnBase = nextSpot(root, [10, 10], turnCard)
    const turnCarry = boundary(
      record,
      history,
      turnCard,
      flop,
      turnBase,
      mutation === 'refresh-turn',
    )
    const turnSpot = { ...turnBase, ranges: turnCarry.ranges }
    const turnRecord = createPromiseRecord()
    const turnSums: Policy = new Map()
    const turnPrefix = `/${history}`
    const turn = solveRiver(
      turnSpot,
      iterations,
      undefined,
      leaf(turnSpot, turnPrefix, turnRecord, turnSums),
      turnCarry.gadget,
      betting(turnSpot),
      { scheme },
    )
    const turnPolicy = normalized(turnSums)
    install(turn, turnPrefix, turnPolicy)
    const riverCard = parseCard('Kd')
    const turnHistory = 'b20c'
    const riverBase = nextSpot(turnSpot, [20, 20], riverCard)
    const riverCarry = boundary(
      turnRecord,
      turnHistory,
      riverCard,
      turn,
      riverBase,
      mutation === 'refresh-river',
    )
    const riverSpot = { ...riverBase, ranges: riverCarry.ranges }
    const riverPrefix = `${turnPrefix}/${turnHistory}`
    const river = solveRiver(
      riverSpot,
      iterations,
      undefined,
      undefined,
      riverCarry.gadget,
      betting(riverSpot),
      { scheme },
    )
    const riverPolicy: Policy = new Map()
    install(river, riverPrefix, riverPolicy)
    const chain = new Map(blueprint)
    // Replace only our strategy at the selected public card/history; every
    // other chance branch and both earlier streets retain the blueprint.
    const difference = (a: Policy, b: Policy) =>
      Math.max(
        ...[...a].flatMap(([k, vs]) =>
          playerOf(k) === 0 ? vs.map((v, i) => Math.abs(v - (b.get(k)?.[i] as number))) : [],
        ),
      )
    expect(difference(turnPolicy, blueprint), 'turn changes our continuation').toBeGreaterThan(1e-5)
    expect(difference(riverPolicy, turnPolicy), 'river changes our continuation').toBeGreaterThan(
      1e-5,
    )
    for (const [k, v] of turnPolicy) if (playerOf(k) === 0) chain.set(k, v)
    for (const [k, v] of riverPolicy) if (playerOf(k) === 0) chain.set(k, v)
    const chained = aggregate(root, values(root, '', chain, 1, true), 1)
    // Measured finite-iteration error, not a magic chip allowance. The exact
    // equilibrium value lies within the blueprint's two-sided BR interval.
    const tolerance = 2 * gap + 1e-6
    expect(chained).toBeLessThanOrEqual((br[1] as number) + tolerance)
    // The actual opponent can deviate over the ENTIRE original game. The
    // correct model matches an explicitly enumerated always-fold opponent;
    // the wrong model predicts calls, and changing alternates those beliefs.
    // None of those beliefs enter this independent maximization oracle.
    const correct: RiverReads = {
      bet: 0,
      fold: 1,
      raise: 0,
      foldSmall: 1,
      foldMedium: 1,
      foldLarge: 1,
      air: 0,
      size: 0.5,
      trust: 0.7,
    }
    const wrong: RiverReads = {
      ...correct,
      bet: 0.95,
      fold: 0,
      foldSmall: 0,
      foldMedium: 0,
      foldLarge: 0,
      air: 0.95,
    }
    // The recorder's own averaged continuation is an independently certified
    // feasible baseline too. Exercise proposals there even when finite-CFR
    // river re-solving fails the strict inherited cap gate above.
    const inheritedStrategy = new Map(river.strategy)
    const restore = (node: RiverNode) => {
      if (node.kind !== 'action') return
      const hands = prepare(riverSpot.ranges[node.player], riverSpot.board)
      inheritedStrategy.set(
        node.history,
        Float64Array.from(
          hands.combos.flatMap(
            (h) => turnPolicy.get(info(riverSpot, riverPrefix, node.history, node.player, h)) ?? [],
          ),
        ),
      )
      node.children.forEach(restore)
    }
    restore(river.tree)
    const inheritedRiver = { ...river, strategy: inheritedStrategy }
    const adaptations = []
    for (const baseline of [river, inheritedRiver])
      for (const name of ['correct', 'wrong', 'changing'] as const) {
        let calls = 0
        const propose = () => {
          calls++
          const reads =
            name === 'correct' || (name === 'changing' && calls % 2 === 0) ? correct : wrong
          // The empirical posterior contains actual reach, never the positive
          // zero-reach placeholders of the protected support.
          const inherited = carriedPromises(turnRecord, turnHistory, cardKey(riverCard), 1)
          const posterior = riverSpot.ranges[1].map((h) => ({
            ...h,
            weight: inherited.reach[id(h)] as number,
          }))
          const proposal = readBasedRiverProposal(baseline, posterior, reads, 1, {
            ...RIVER_POLICY_TUNING,
            iterations: 100,
            scheme,
          })
          if (name === 'correct' && proposal !== null) {
            const modelSpot = {
              ...riverSpot,
              ranges: [riverSpot.ranges[0], posterior.filter((h) => h.weight > 0)] as const,
            }
            const truth: Policy = new Map()
            install({ ...baseline, spot: modelSpot }, riverPrefix, truth)
            for (const [key] of truth) if (playerOf(key) === 1) truth.set(key, [1, 0])
            const independent = aggregate(
              modelSpot,
              values(modelSpot, riverPrefix, truth, 0, false),
              0,
            )
            expect(
              proposal.value(baseline),
              'correct model matches enumerated actual opponent',
            ).toBeCloseTo(independent, 8)
          }
          return proposal
        }
        const chosen = boundedRiverAdaptation(baseline, riverCarry.gadget, propose)
        if (baseline === inheritedRiver) expect(chosen.baseline.violations).toBe(0)
        const adapted: Policy = new Map()
        install(chosen.solution, riverPrefix, adapted)
        const complete = new Map(chain)
        for (const [key, row] of adapted) if (playerOf(key) === 0) complete.set(key, row)
        const fullBR = aggregate(root, values(root, '', complete, 1, true), 1)
        expect(fullBR, `${name} model full-game BR`).toBeLessThanOrEqual(
          (br[1] as number) + tolerance + RIVER_ADAPTATION_ALLOWANCE,
        )
        const local = values(riverSpot, riverPrefix, adapted, 1, true)
        if (chosen.baseline.violations === 0)
          local.forEach((v, h) => {
            expect(v, `${name} inherited holding ${h}`).toBeLessThanOrEqual(
              (riverCarry.gadget.promises[h] as number) + RIVER_ADAPTATION_ALLOWANCE,
            )
          })
        else expect(chosen.solution).toBe(baseline)
        expect(calls).toBe(chosen.baseline.violations === 0 ? 1 : 0)
        adaptations.push({
          baseline: baseline === river ? 'resolved' : 'inherited',
          name,
          weight: chosen.weight,
          baselineViolations: chosen.baseline.violations,
          fullBR,
        })
      }
    expect(adaptations.some((entry) => entry.baseline === 'inherited' && entry.weight > 0)).toBe(
      true,
    )
    // v9gz: actual x0 BR caps, not the inherited promises. The independent
    // full-game enumerator includes every chance card and opponent deviation.
    const budgeted = []
    for (const [name, reads] of [
      ['correct', correct],
      ['wrong', wrong],
      ['changing', correct],
    ] as const) {
      const fixedModel = readsModel(reads, riverSpot, 1)
      let calls = 0
      const selectedModel =
        name === 'changing'
          ? {
              ...fixedModel,
              strategy: (
                node: Extract<RiverNode, { kind: 'action' }>,
                hands: ReturnType<typeof prepare>,
              ) => readsModel(++calls % 2 ? correct : wrong, riverSpot, 1).strategy(node, hands),
            }
          : fixedModel
      const budget = 0.04
      const chosen = solveBudgetedStreet(river, selectedModel, riverSpot.ranges[1], budget)
      const adapted: Policy = new Map()
      install(chosen.solution, riverPrefix, adapted)
      const complete = new Map(chain)
      for (const [key, row] of adapted) if (playerOf(key) === 0) complete.set(key, row)
      const local0 = values(riverSpot, riverPrefix, riverPolicy, 1, true)
      values(riverSpot, riverPrefix, adapted, 1, true).forEach((v, h) => {
        expect(v - (local0[h] as number), `v9gz ${name} holding ${h}`).toBeLessThanOrEqual(
          budget + 1e-9,
        )
      })
      const fullBR = aggregate(root, values(root, '', complete, 1, true), 1)
      expect(fullBR, `v9gz ${name} whole chain`).toBeLessThanOrEqual(chained + budget + 1e-9)
      expect(fullBR).toBeLessThanOrEqual((br[1] as number) + tolerance + budget)
      budgeted.push({ name, weight: chosen.weight, maxBRIncrease: chosen.maxBRIncrease, fullBR })
    }
    expect(zeroReachQueries).toBeGreaterThan(0)
    expect([...flop.strategy.values()].some((r) => r.some((v) => Math.abs(v - 0.5) > 0.1))).toBe(
      true,
    )
    console.log(
      JSON.stringify({
        scheme,
        iterations,
        blueprintBR: br[1],
        chainedBR: chained,
        gap,
        tolerance,
        exactBr,
        exactQueries,
        zeroReachQueries,
        maxExactGap,
        adaptations,
        budgeted,
      }),
    )
  }, 30_000)
})

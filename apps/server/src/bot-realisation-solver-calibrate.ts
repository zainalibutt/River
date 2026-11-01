import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { cardKey, cardToString, makeDeck, mulberry32, seedFromString } from '@river/engine'
import { flopRunouts } from './bot-flop-solver.js'
import { perTurnShowdown, type TurnLeafEvaluator } from './bot-flop-turn-leaves.js'
import { DEFAULT_HAND_REALISATION, flopContext } from './bot-preflop-solve-realisation.js'
import type { PreflopNode } from './bot-preflop-solve-tree.js'
import {
  exactPreflopRanges,
  loadPreflopPack,
  type PreflopPack,
  type PreflopTrace,
  preflopClass,
  preflopPackFile,
} from './bot-preflop-tables.js'
import {
  fitRealisation,
  type RealisationObservation,
  realisationError,
} from './bot-realisation-fit.js'
import {
  compatibleMasses,
  type Hands,
  prepare,
  type RangeCombo,
  type RiverSolution,
  type RiverSpot,
  riverTerminalEvaluator,
  riverValues,
  solveRiver,
} from './bot-river-solver.js'
import { comboIndex52 } from './bot-river-value-data.js'
import { loadValueNetwork, type RiverValueNetwork } from './bot-value-network.js'

const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')
export const SOLVER_EQUITY_HASH = hash(
  'all 1176 flop public runouts; exact weighted blocker sweeps; divisor C(45,2)=990; v1',
)
const STRATA = [
  'limped',
  'open-2',
  'open-2.5',
  'open-3',
  'limp-isolation',
  'three-bet-plus',
] as const
const CHIPS_PER_BB = 100 // same chip rounding as live play, including fractional preflop sizes
const players = ['button', 'bb'] as const

export interface CalibrationTerminal {
  trace: PreflopTrace
  id: string
  stratum: string
  depth: number
  paid: readonly [number, number]
  ranges: readonly [readonly RangeCombo[], readonly RangeCombo[]] // IP, OOP
  jointMass: number
}

/** Enumerate every non-all-in table terminal; use the production exact reach expander. */
export function calibrationTerminals(pack: PreflopPack): CalibrationTerminal[] {
  const out: CalibrationTerminal[] = []
  const walk = (node: PreflopNode, line: PreflopTrace['line'], id: string): void => {
    if (node.kind === 'decision') {
      node.children.forEach((child, k) => {
        walk(
          child,
          [...line, { node, indices: [k] }],
          `${node.id}/${required(node.actions[k]).label}`,
        )
      })
    } else if (node.kind === 'flop') {
      const depth = pack.metadata.effectiveStackBb
      const trace: PreflopTrace = {
        pack,
        node,
        bb: CHIPS_PER_BB,
        players,
        line,
        offTree: [],
        selection: { depth, clamp: null },
      }
      const ranges = exactPreflopRanges(trace, [], players)
      // prepare() only scores hands; values of two-card strengths are unused here.
      const hands = ranges.map((r) => prepare(r, [])) as unknown as readonly [Hands, Hands]
      const mass = compatibleMasses(hands[0], hands[1], hands[1].weights)
      const jointMass = hands[0].weights.reduce((s, w, h) => s + w * required(mass[h]), 0)
      const first = required(line[0])
      const action = required(first.node.actions[required(first.indices[0])])
      const stratum =
        Math.max(...node.paid) > 4
          ? 'three-bet-plus'
          : Math.max(...node.paid) === 1
            ? 'limped'
            : action.kind === 'limp'
              ? 'limp-isolation'
              : `open-${action.to}`
      if (jointMass > 0) out.push({ trace, id, depth, stratum, paid: node.paid, ranges, jointMass })
    }
  }
  walk(pack.metadata.tree, [], '')
  return out
}

/** Balanced depth/stratum coverage; within each cell sample terminals by exact joint reach. */
export function sampleCalibrationSpot(
  terminals: readonly CalibrationTerminal[],
  seed: string,
  worker: number,
  index: number,
) {
  const cells = [100, 200].flatMap((depth) => STRATA.map((stratum) => ({ depth, stratum })))
  const cell = required(cells[index % cells.length])
  const choices = terminals.filter((t) => t.depth === cell.depth && t.stratum === cell.stratum)
  const key = `${seed}:${worker}:${index}`
  const rng = mulberry32(seedFromString(`${key}:terminal`))
  let draw = rng() * choices.reduce((s, t) => s + t.jointMass, 0)
  const terminal = required(
    choices.find((t) => {
      draw -= t.jointMass
      return draw < 0
    }) ?? choices.at(-1),
  )
  const deck = makeDeck()
  const boardRng = mulberry32(seedFromString(`${key}:flop`))
  for (let i = 0; i < 3; i++) {
    const j = i + Math.floor(boardRng() * (52 - i))
    ;[deck[i], deck[j]] = [required(deck[j]), required(deck[i])]
  }
  const board = deck.slice(0, 3)
  // Production ordering is OOP first. No support floor, normalization, or pruning.
  const ranges = exactPreflopRanges(terminal.trace, board, ['bb', 'button'])
  const contribution = Math.max(...terminal.paid)
  const spot: RiverSpot = {
    board,
    pot: 2 * contribution * CHIPS_PER_BB,
    stack: Math.round((terminal.depth - contribution) * CHIPS_PER_BB),
    ranges,
    betSizes: [0.66],
    allIn: true,
    maxRaises: 1,
  }
  return { key, terminal, spot }
}

/** Exact flop equity for every holding, O(runouts * holdings log holdings), not pairwise MC.
 * Ranks=0 exclude runout-blocked holdings. Every compatible pair leaves 990 runouts.
 */
export function flopRangeEquities(spot: RiverSpot, hands: readonly [Hands, Hands]) {
  if (spot.board.length !== 3) throw new Error('equity needs a flop')
  const indices = hands.map((side) =>
    Int32Array.from(side.combos, (h) => comboIndex52(cardKey(h.hole[0]), cardKey(h.hole[1]))),
  )
  const work = hands.map((side) => ({
    ...side,
    strength: new Float64Array(side.combos.length),
    order: Int32Array.from(side.combos.keys()),
    weights: new Float64Array(side.weights),
  })) as unknown as readonly [Hands, Hands]
  const wins = hands.map((side) => new Float64Array(side.combos.length))
  const masses = [
    compatibleMasses(hands[0], hands[1], hands[1].weights),
    compatibleMasses(hands[1], hands[0], hands[0].weights),
  ]
  const terminal = riverTerminalEvaluator(work, 1)
  for (const { ranks } of flopRunouts(spot.board, 1176)) {
    for (const p of [0, 1] as const) {
      for (let h = 0; h < work[p].combos.length; h++) {
        const rank = required(ranks[required(required(indices[p])[h])])
        work[p].strength[h] = rank
        work[p].weights[h] = rank > 0 ? required(hands[p].weights[h]) : 0
      }
      work[p].order.sort((a, b) => required(work[p].strength[a]) - required(work[p].strength[b]))
    }
    for (const p of [0, 1] as const) {
      const won = terminal({ kind: 'showdown', paid: [0, 0] }, p, work[p === 0 ? 1 : 0].weights)
      for (let h = 0; h < won.length; h++)
        if (required(work[p].strength[h]) > 0)
          required(wins[p])[h] = required(required(wins[p])[h]) + required(won[h])
    }
  }
  return wins.map((side, p) =>
    Float64Array.from(side, (w, h) => {
      const mass = required(required(masses[p])[h])
      return mass > 0 ? Math.min(1, Math.max(0, w / (990 * mass))) : 0
    }),
  ) as [Float64Array, Float64Array]
}

/** riverValues already returns CFV / compatible opponent mass, at flop-entry origin. */
export function solverCalibrationRows(
  solution: RiverSolution,
  terminal: Pick<CalibrationTerminal, 'depth' | 'paid' | 'id' | 'stratum'>,
  handId: string,
  policyId: string,
): RealisationObservation[] {
  const root = riverValues(solution)
  const equity = flopRangeEquities(solution.spot, root.hands)
  const potBb = solution.spot.pot / CHIPS_PER_BB
  const context = flopContext(terminal.paid, terminal.depth)
  const rows: RealisationObservation[] = []
  for (const p of [0, 1] as const) {
    for (let h = 0; h < root.hands[p].combos.length; h++) {
      const holding = required(root.hands[p].combos[h])
      const compatibleMass = required(root.masses[p][h])
      if (!(compatibleMass > 0)) continue
      const valueChips = required(root.values[p][h])
      const e = required(equity[p][h])
      const valuePots = valueChips / solution.spot.pot
      const contribution = required(terminal.paid[p === 0 ? 1 : 0])
      rows.push({
        schema: 'river-realisation-observation-v1',
        valueSource: 'flop-solver',
        handId,
        postflopPolicyId: policyId,
        opponentPolicyId: policyId,
        equityTableHash: SOLVER_EQUITY_HASH,
        nodeId: terminal.id,
        stratum: `${terminal.depth}:${terminal.stratum}`,
        holdingId: holding.hole
          .map(cardKey)
          .sort((a, b) => a - b)
          .join('-'),
        board: solution.spot.board.map(cardToString),
        handClass: preflopClass(holding.hole),
        position: p === 0 ? 'oop' : 'ip',
        potType: context.potType,
        effectiveStackBb: terminal.depth,
        potBb,
        ownPreflopContributionBb: contribution,
        spr: context.spr,
        equityVsOpponentRange: e,
        netFromHandStartBb: valueChips / CHIPS_PER_BB - contribution,
        rootValuePots: valuePots,
        rootCFVChips: valueChips * compatibleMass,
        compatibleMass,
        chipsPerBb: CHIPS_PER_BB,
        realisedFraction: e > 0 ? valuePots / e : null,
        weight: holding.weight,
      })
    }
  }
  return rows
}

export function recordSolverFlop(
  sample: ReturnType<typeof sampleCalibrationSpot>,
  network: RiverValueNetwork | TurnLeafEvaluator,
  policyId: string,
) {
  const showdown = perTurnShowdown(sample.spot, network)
  const solution = solveRiver(sample.spot, 40, undefined, showdown, undefined, undefined, {
    scheme: 'dcfr',
  })
  return solverCalibrationRows(solution, sample.terminal, sample.key, policyId)
}

/** Only a checksum-verified complete shard can be skipped; partial shards replay exactly. */
export function writeSolverShard(
  path: string,
  first: number,
  count: number,
  record: (index: number) => RealisationObservation[],
) {
  if (existsSync(path)) {
    const stats = JSON.parse(readFileSync(`${path}.stats.json`, 'utf8')) as {
      sha256: string
      first: number
      flops: number
    }
    if (stats.sha256 !== hash(readFileSync(path)) || stats.first !== first || stats.flops !== count)
      throw new Error('corrupt or mismatched solver shard')
    return false
  }
  const started = performance.now()
  const rows = Array.from({ length: count }, (_, i) => record(first + i)).flat()
  const content = `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`
  const stats = {
    first,
    flops: count,
    observations: rows.length,
    elapsedSeconds: (performance.now() - started) / 1000,
    sha256: hash(content),
  }
  writeFileSync(`${path}.part`, content)
  writeFileSync(`${path}.stats.json.part`, `${JSON.stringify(stats)}\n`)
  renameSync(`${path}.stats.json.part`, `${path}.stats.json`)
  renameSync(`${path}.part`, path)
  return stats
}

function inside(path: string) {
  const absolute = resolve(path),
    rel = relative(process.cwd(), absolute)
  if (rel === '..' || rel.startsWith('..\\') || rel.startsWith('../') || isAbsolute(rel))
    throw new Error('writes must stay inside the worktree')
  return absolute
}

export function solverCalibrationMain(args = process.argv.slice(2)) {
  const { values: v } = parseArgs({
    args,
    options: {
      seed: { type: 'string', default: 'solver-realisation-v1' },
      worker: { type: 'string', default: '0' },
      shards: { type: 'string', default: '60' },
      'flops-per-shard': { type: 'string', default: '1' },
      seconds: { type: 'string', default: '480' },
      out: { type: 'string', default: 'out/realisation-solver' },
      fit: { type: 'boolean' },
      input: { type: 'string' },
      'heldout-worker': { type: 'string', default: '1' },
    },
  })
  const out = inside(required(v.out))
  if (v.fit) {
    if (!v.input) throw new Error('--fit requires --input shard directory')
    const files = readdirSync(v.input)
      .filter((f) => f.endsWith('.jsonl'))
      .sort()
    const training: RealisationObservation[] = [],
      heldout: RealisationObservation[] = []
    for (const f of files) {
      const path = join(v.input, f)
      if (
        JSON.parse(readFileSync(`${path}.stats.json`, 'utf8')).sha256 !== hash(readFileSync(path))
      )
        throw new Error('corrupt fit input')
      const target = f.startsWith(
        `solver-w${String(Number(v['heldout-worker'])).padStart(3, '0')}-`,
      )
        ? heldout
        : training
      target.push(
        ...readFileSync(path, 'utf8')
          .trim()
          .split(/\r?\n/)
          .filter(Boolean)
          .map((l) => JSON.parse(l) as RealisationObservation),
      )
    }
    if (!heldout.length) throw new Error('need independent --heldout-worker shards')
    // Also validate held-out identities, units and duplicate keys through the existing fitter.
    fitRealisation(heldout)
    const result = fitRealisation(training)
    const error = (data: RealisationObservation[]) => ({
      prior: realisationError(data, DEFAULT_HAND_REALISATION),
      fitted: realisationError(data, result.config),
    })
    const report = {
      ...result,
      training: error(training),
      heldout: error(heldout),
      heldoutByStratum: Object.fromEntries(
        [...new Set(heldout.map((o) => o.stratum))].map((s) => [
          s,
          error(heldout.filter((o) => o.stratum === s)),
        ]),
      ),
      targetNote:
        'Fitted to flop-conditional equity and solver values. Preflop packs use pre-board equity; the nonlinear transport is not validated by this fit.',
    }
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, `${JSON.stringify(result.config, null, 2)}\n`)
    writeFileSync(`${out}.fit.json`, `${JSON.stringify(report, null, 2)}\n`)
    console.log(JSON.stringify(report, null, 2))
    return
  }
  const worker = Number(v.worker),
    shards = Number(v.shards),
    perShard = Number(v['flops-per-shard']),
    seconds = Number(v.seconds)
  if (
    ![worker, shards, perShard, seconds].every(Number.isSafeInteger) ||
    worker < 0 ||
    worker > 65535 ||
    shards < 1 ||
    perShard < 1 ||
    seconds < 1 ||
    seconds > 540
  )
    throw new Error('invalid bounded calibration arguments')
  process.env.RIVER_VALUE_BACKEND = 'wasm'
  process.env.RIVER_VALUE_THREADS ??= '1'
  const threads = Number(process.env.RIVER_VALUE_THREADS)
  if (!Number.isSafeInteger(threads) || threads < 1 || threads > 4)
    throw new Error('threads must be 1..4')
  const stem = process.env.RIVER_TURN_START_NETWORK
  if (!stem) throw new Error('missing RIVER_TURN_START_NETWORK')
  const modelHash = hash(Buffer.concat([readFileSync(`${stem}.json`), readFileSync(`${stem}.bin`)]))
  const tables = [100, 200].map((d) => hash(readFileSync(preflopPackFile('v3', d))))
  const sources = [
    'bot-realisation-solver-calibrate',
    'bot-preflop-tables',
    'bot-river-solver',
    'bot-flop-turn-leaves',
    'bot-turn-river-leaves',
    'bot-flop-solver',
    'bot-turn-solver',
    'bot-turn-end-data',
    'bot-river-value-data',
    'bot-value-network',
    'bot-value-simd',
  ]
  const sourceHash = hash(
    Buffer.concat(sources.map((s) => readFileSync(new URL(`./${s}.ts`, import.meta.url)))),
  )
  const policyId = `v9gp-flop:${hash(JSON.stringify({ modelHash, tables, sourceHash }))}`
  const manifest = {
    schema: 'river-realisation-solver-run-v1',
    seed: v.seed,
    perShard,
    modelHash,
    tables,
    sourceHash,
    policyId,
    equityEstimator: SOLVER_EQUITY_HASH,
    backend: 'wasm',
    threads,
    iterations: 40,
    scheme: 'dcfr',
    betSizes: [0.66],
    allIn: true,
    maxRaises: 1,
    sampling:
      'balanced 12 depth/stratum cells; terminal drawn proportional to exact compatible joint reach; uniform public flop; both positions; per-row own raw reach',
    origin:
      'CFV/compatible mass in flop-entry chips; divide by 100 for bb; subtract own preflop contribution for hand-start net',
    valueSemantics:
      'root profile value of exported average DCFR strategy with per-turn network queried on profile reaches; not a CFR-time averaged network value',
  }
  mkdirSync(out, { recursive: true })
  const manifestPath = join(out, 'manifest.json'),
    encoded = `${JSON.stringify(manifest, null, 2)}\n`
  if (existsSync(manifestPath)) {
    if (readFileSync(manifestPath, 'utf8') !== encoded)
      throw new Error('manifest mismatch; choose another output directory')
  } else {
    try {
      writeFileSync(manifestPath, encoded, { flag: 'wx' })
    } catch (e) {
      if (
        (e as NodeJS.ErrnoException).code !== 'EEXIST' ||
        readFileSync(manifestPath, 'utf8') !== encoded
      )
        throw e
    }
  }
  const network = loadValueNetwork(stem)
  const started = performance.now(),
    deadline = started + seconds * 1000
  const terminals = [100, 200].flatMap((d) => calibrationTerminals(loadPreflopPack(d, 'v3')))
  let flops = 0,
    skipped = 0
  for (let shard = 0; shard < shards; shard++) {
    if (performance.now() >= deadline) break
    const path = join(
      out,
      `solver-w${String(worker).padStart(3, '0')}-${String(shard).padStart(5, '0')}.jsonl`,
    )
    const stats = writeSolverShard(path, shard * perShard, perShard, (i) => {
      if (performance.now() >= deadline)
        throw new Error('budget exhausted inside shard; restart will replay it')
      const sample = sampleCalibrationSpot(terminals, required(v.seed), worker, i)
      const rows = recordSolverFlop(sample, network, policyId)
      console.error(
        JSON.stringify({
          worker,
          index: i,
          stratum: `${sample.terminal.depth}:${sample.terminal.stratum}`,
          node: sample.terminal.id,
          board: sample.spot.board.map(cardToString),
          observations: rows.length,
        }),
      )
      return rows
    })
    if (stats) flops += stats.flops
    else skipped++
  }
  const elapsedSeconds = (performance.now() - started) / 1000
  console.log(
    JSON.stringify({
      worker,
      flops,
      skipped,
      elapsedSeconds,
      flopsPerHourPerWorker: (flops * 3600) / elapsedSeconds,
    }),
  )
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('/bot-realisation-solver-calibrate.ts')) {
  // A separate supervisor can interrupt synchronous layout/solve work. Complete shards survive.
  if (process.env.RIVER_CALIBRATION_CHILD === '1') solverCalibrationMain()
  else {
    const result = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
      env: { ...process.env, RIVER_CALIBRATION_CHILD: '1' },
      stdio: 'inherit',
      timeout: 570_000,
    })
    if (result.error) console.error(result.error.message)
    process.exitCode = result.status ?? 1
  }
}

function required<T>(v: T): NonNullable<T> {
  if (v === null || v === undefined) throw new Error('missing solver calibration value')
  return v
}

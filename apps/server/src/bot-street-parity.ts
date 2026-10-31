import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cardKey, makeDeck, mulberry32, parseCard, RANKS, seedFromString } from '@river/engine'
import { perTurnShowdown, type TurnStartLeafOptions } from './bot-flop-turn-leaves.js'
import {
  type RangeCombo,
  type RiverNode,
  type RiverSpot,
  solveRiver,
  strategyRows,
} from './bot-river-solver.js'
import { COMBOS } from './bot-river-value-data.js'
import { loadTurnResidualNetwork, turnResidualLeaf } from './bot-turn-residual.js'
import { perRiverShowdown, type RiverLeafEvaluator } from './bot-turn-river-leaves.js'
import { turnResidualOptionsFromEnvironment } from './bot-v9g-policy.js'
import {
  type RiverValueNetwork,
  riverNetworkFromEnvironment,
  turnStartNetworkFromEnvironment,
} from './bot-value-network.js'

export interface StreetParitySpec {
  readonly n: number
  readonly street: 'flop' | 'turn' | 'river'
  readonly board: readonly string[]
  readonly pot: number
  readonly stack: number
  readonly ranges: readonly [readonly number[], readonly number[]]
  /** Share of the pot; the parity games so far use 0.66, the live spots 0.5. */
  readonly betSize: number
  readonly iterations: number
}

const BOARD_CARDS = { flop: 3, turn: 4, river: 5 } as const
const deck = makeDeck()
// The dump's lexicographic (a,b) order, not showdown-strength order.
const combos = deck.flatMap((a, low) =>
  deck.slice(low + 1).map((b, offset) => {
    const high = low + 1 + offset
    const first = Math.max(low % 13, high % 13)
    const second = Math.min(low % 13, high % 13)
    const handClass = `${RANKS[first]}${RANKS[second]}${
      first === second ? '' : Math.floor(low / 13) === Math.floor(high / 13) ? 's' : 'o'
    }`
    return { hole: [a, b] as const, low, high, handClass }
  }),
)

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('expected a JSON object')
  return value as Record<string, unknown>
}

function positive(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    throw new Error(`${name} must be finite and positive`)
  return value
}

function integer(value: unknown, name: string, minimum = 1): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum)
    throw new Error(`${name} must be a safe integer >= ${minimum}`)
  return value
}

function boardCards(value: unknown, length: number): string[] {
  if (!Array.isArray(value) || value.length !== length || value.some((c) => typeof c !== 'string'))
    throw new Error(`board must contain ${length} card strings`)
  const keys = value.map((c: string) => cardKey(parseCard(c)))
  if (new Set(keys).size !== length) throw new Error('board contains duplicate cards')
  return value as string[]
}

function denseRanges(value: unknown): [number[], number[]] {
  if (!Array.isArray(value) || value.length !== 2) throw new Error('ranges must contain OOP and IP')
  for (const range of value) {
    if (
      !Array.isArray(range) ||
      range.length !== COMBOS ||
      Array.from(range).some((w) => typeof w !== 'number' || !Number.isFinite(w) || w < 0)
    )
      throw new Error('each range must contain 1326 finite nonnegative weights')
  }
  return value as [number[], number[]]
}

function liveCombos(board: readonly string[]) {
  const blocked = new Set(board.map((c) => cardKey(parseCard(c))))
  return combos.map((combo) => !blocked.has(combo.low) && !blocked.has(combo.high))
}

/** Includes zero-weight members: a single positive suit is not a uniform class. */
export function classWeights(range: readonly number[], board: readonly string[]) {
  const live = liveCombos(board)
  const classes = new Map<string, number>()
  combos.forEach((combo, index) => {
    if (!live[index]) return
    const weight = range[index] as number
    const previous = classes.get(combo.handClass)
    if (previous !== undefined && Math.abs(previous - weight) > 1e-10 * Math.max(previous, weight))
      throw new Error(`range is not class-uniform: ${combo.handClass}, combo ${index}`)
    classes.set(combo.handClass, previous ?? weight)
  })
  return classes
}

/** Blocked entries may be nonzero; both solvers ignore them. No range conditioning. */
export function validateStreetSpec(value: unknown): StreetParitySpec {
  const row = object(value)
  integer(row.n, 'n', 0)
  if (row.street !== 'flop' && row.street !== 'turn' && row.street !== 'river')
    throw new Error('street must be flop, turn or river')
  const board = boardCards(row.board, BOARD_CARDS[row.street])
  positive(row.pot, 'pot')
  positive(row.stack, 'stack')
  if (!Number.isFinite((row.pot as number) + 2 * (row.stack as number)))
    throw new Error('pot plus both stacks must be finite')
  if (typeof row.betSize !== 'number' || !(row.betSize > 0 && row.betSize <= 1))
    throw new Error('betSize must be a share of the pot in (0, 1]')
  integer(row.iterations, 'iterations')
  const ranges = denseRanges(row.ranges)
  const live = liveCombos(board)
  for (const range of ranges) {
    classWeights(range, board)
    const mass = range.reduce((sum, w, i) => sum + (live[i] ? w : 0), 0)
    positive(mass, 'unblocked range mass')
  }
  const first = combos.filter((_, i) => live[i] && (ranges[0][i] as number) > 0)
  const second = combos.filter((_, i) => live[i] && (ranges[1][i] as number) > 0)
  if (
    !first.some((a) =>
      second.some(
        (b) => a.low !== b.low && a.low !== b.high && a.high !== b.low && a.high !== b.high,
      ),
    )
  )
    throw new Error('ranges have no compatible joint deal')
  return row as unknown as StreetParitySpec
}

export function streetParitySpot(spec: StreetParitySpec, sizedRaises = false): RiverSpot {
  const live = liveCombos(spec.board)
  const range = (weights: readonly number[]): RangeCombo[] =>
    combos.flatMap((combo, i) =>
      live[i] && (weights[i] as number) > 0
        ? [{ hole: combo.hole, weight: weights[i] as number }]
        : [],
    )
  return {
    board: spec.board.map(parseCard),
    pot: spec.pot,
    stack: spec.stack,
    ranges: [range(spec.ranges[0]), range(spec.ranges[1])],
    betSizes: [spec.betSize],
    allIn: true,
    maxRaises: 1,
    allInRaisesOnly: !sizedRaises,
    allInThreshold: 0.67,
    fractionalBets: true,
  }
}

type Decision = Extract<RiverNode, { kind: 'action' }>

function decision(node: RiverNode | undefined): Decision {
  if (node?.kind !== 'action') throw new Error('missing parity decision')
  return node
}

export function solveStreetParity(
  value: unknown,
  multiplier = 1,
  network?: RiverValueNetwork | RiverLeafEvaluator,
  flopLeaf?: TurnStartLeafOptions,
  sizedRaises = false,
) {
  const spec = validateStreetSpec(value)
  positive(multiplier, 'iterations-multiplier')
  const iterations = integer(spec.iterations * multiplier, 'scaled iterations')
  const spot = streetParitySpot(spec, sizedRaises)
  const start = performance.now()
  // v9g's initial flop/turn solve uses this core with per-card leaves, not the
  // solveFlop wrapper (which uses flop-end values). Both accept the restricted
  // RiverSpot tree unchanged. Omit records, gadget, reads and fixed prefixes;
  // perTurnShowdown retains production's seeded flop all-in runouts. flopLeaf
  // swaps in production's turn-start leaf (the residual network) when given.
  const showdown =
    spec.street === 'flop'
      ? perTurnShowdown(
          spot,
          network ?? turnStartNetworkFromEnvironment(),
          undefined,
          undefined,
          flopLeaf === undefined ? undefined : { ...flopLeaf, iterations },
        )
      : spec.street === 'turn'
        ? perRiverShowdown(spot, network ?? riverNetworkFromEnvironment())
        : undefined
  const solution = solveRiver(spot, iterations, undefined, showdown, undefined, undefined, {
    scheme: 'dcfr',
  })
  const ms = performance.now() - start
  const root = decision(solution.tree)
  const checked = decision(root.children[root.actions.indexOf('k')])
  const bet = checked.actions.findIndex((label) => label.startsWith('b'))
  // When the threshold collapses 66% to all-in, report ka rather than invent kb.
  const facing = decision(checked.children[bet >= 0 ? bet : checked.actions.indexOf('a')])
  const live = liveCombos(spec.board)
  const indices = spec.ranges.map((range) =>
    combos.flatMap((_, i) => (live[i] && (range[i] as number) > 0 ? [i] : [])),
  )
  const nodes = [root, checked, facing].map((node) => {
    const rows = strategyRows(solution, node.history)
    if (!rows) throw new Error('missing parity strategy')
    return {
      history: node.history,
      player: node.player,
      actions: node.actions,
      strategy: rows.map((row, h) => ({
        combo: indices[node.player]?.[h] as number,
        probabilities: Array.from(row),
      })),
    }
  })
  const rootRows = strategyRows(solution, '')
  const facingRows = strategyRows(solution, facing.history)
  if (!rootRows || !facingRows) throw new Error('missing OOP strategies')
  const sums = { fold: 0, call: 0, allIn: 0 }
  let reachWeight = 0
  for (let h = 0; h < facingRows.length; h += 1) {
    const index = indices[0]?.[h] as number
    const reach =
      (spec.ranges[0][index] as number) * (rootRows[h]?.[root.actions.indexOf('k')] as number)
    reachWeight += reach
    for (const [label, key] of [
      ['f', 'fold'],
      ['c', 'call'],
      ['a', 'allIn'],
    ] as const) {
      const action = facing.actions.indexOf(label)
      if (action >= 0) sums[key] += reach * (facingRows[h]?.[action] as number)
    }
  }
  return {
    n: spec.n,
    street: spec.street,
    board: spec.board,
    iterations,
    ms,
    nodes,
    facingBet: {
      history: facing.history,
      reachWeight,
      fold: reachWeight > 0 ? sums.fold / reachWeight : null,
      call: reachWeight > 0 ? sums.call / reachWeight : null,
      allIn: reachWeight > 0 ? sums.allIn / reachWeight : null,
    },
  }
}

/** Plain decimal notation for TexasSolver's float parser, including tiny weights. */
function decimal(value: number): string {
  const text = String(value)
  if (!text.includes('e')) return text
  const [coefficient = '', exponent = '0'] = text.split('e')
  const digits = coefficient.replace('.', '')
  const point = (coefficient.split('.')[0]?.length ?? 0) + Number(exponent)
  if (point <= 0) return `0.${'0'.repeat(-point)}${digits}`
  return point >= digits.length
    ? digits + '0'.repeat(point - digits.length)
    : `${digits.slice(0, point)}.${digits.slice(point)}`
}

function texasRange(range: readonly number[], board: readonly string[]) {
  const classes = [...classWeights(range, board)].filter(([, weight]) => weight > 0)
  // TexasSolver's converter drops weights <= .005. Global rescaling preserves
  // the range distribution, including classes whose raw reach is very small.
  const minimum = Math.min(...classes.map(([, weight]) => weight))
  return classes
    .map(([name, weight]) => {
      const scaled = weight / minimum
      if (!Number.isFinite(Math.fround(scaled)))
        throw new Error('TexasSolver class weights overflow float32')
      return `${name}:${decimal(scaled)}`
    })
    .join(',')
}

export function texasInput(value: unknown, dumpPath: string, threads = 8): string {
  const spec = validateStreetSpec(value)
  integer(threads, 'threads')
  if (!dumpPath || /\s/.test(dumpPath))
    throw new Error('TexasSolver dump path must contain no whitespace')
  const lines = [
    `set_pot ${decimal(spec.pot)}`,
    `set_effective_stack ${decimal(spec.stack)}`,
    `set_board ${spec.board.join(',')}`,
    `set_range_oop ${texasRange(spec.ranges[0], spec.board)}`,
    `set_range_ip ${texasRange(spec.ranges[1], spec.board)}`,
  ]
  const streets = (['flop', 'turn', 'river'] as const).slice(
    ['flop', 'turn', 'river'].indexOf(spec.street),
  )
  for (const street of streets) {
    for (const player of ['oop', 'ip']) {
      lines.push(
        `set_bet_sizes ${player},${street},bet,${Math.round(spec.betSize * 100)}`,
        `set_bet_sizes ${player},${street},allin`,
      )
    }
    if (street !== spec.street)
      lines.push(`set_bet_sizes oop,${street},donk,${Math.round(spec.betSize * 100)}`)
  }
  lines.push(
    'set_allin_threshold 0.67',
    'build_tree',
    `set_thread_num ${threads}`,
    'set_accuracy 0.3',
    'set_max_iteration 1000',
    'set_print_interval 50',
    'set_use_isomorphism 1',
    'start_solve',
    'set_dump_rounds 2',
    `dump_result ${dumpPath.replaceAll('\\', '/')}`,
  )
  return `${lines.join('\n')}\n`
}

export interface FlopRoot {
  readonly board: readonly string[]
  readonly ranges: readonly [readonly number[], readonly number[]]
}

/** Average over every unblocked member, including absent (zero) root combos. */
export function uniformClassRange(range: readonly number[], board: readonly string[]): number[] {
  const live = liveCombos(board)
  const totals = new Map<string, { sum: number; count: number }>()
  combos.forEach((combo, i) => {
    if (!live[i]) return
    const total = totals.get(combo.handClass) ?? { sum: 0, count: 0 }
    total.sum += range[i] as number
    total.count += 1
    totals.set(combo.handClass, total)
  })
  return combos.map((combo, i) => {
    const total = totals.get(combo.handClass)
    return live[i] && total ? total.sum / total.count : 0
  })
}

export function makeStreetSpecs(
  roots: readonly FlopRoot[],
  options: {
    count: number
    seed: string
    street: StreetParitySpec['street']
    pot: number
    stack: number
    iterations?: number
  },
): StreetParitySpec[] {
  integer(options.count, 'count')
  if (options.count > roots.length) throw new Error('count exceeds available dump spots')
  if (options.street !== 'flop' && options.street !== 'turn' && options.street !== 'river')
    throw new Error('street must be flop, turn or river')
  const random = mulberry32(seedFromString(options.seed))
  const order = Array.from(roots.keys())
  return Array.from({ length: options.count }, (_, n) => {
    const selected = n + Math.floor(random() * (order.length - n))
    ;[order[n], order[selected]] = [order[selected] as number, order[n] as number]
    const root = roots[order[n] as number] as FlopRoot
    const board = [...boardCards(root.board, 3)]
    denseRanges(root.ranges)
    const available = deck.map((c) => `${c.rank}${c.suit}`).filter((c) => !board.includes(c))
    while (board.length < BOARD_CARDS[options.street]) {
      const at = Math.floor(random() * available.length)
      board.push(available.splice(at, 1)[0] as string)
    }
    return validateStreetSpec({
      n,
      street: options.street,
      board,
      pot: options.pot,
      stack: options.stack,
      ranges: root.ranges.map((range) => uniformClassRange(range, board)),
      betSize: 0.66,
      iterations: options.iterations ?? 40,
    })
  })
}

function readJsonl(file: string): unknown[] {
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .flatMap((line, index) => {
      if (!line.trim()) return []
      try {
        return [JSON.parse(line) as unknown]
      } catch {
        throw new Error(`${file}:${index + 1}: invalid JSON`)
      }
    })
}

function readFlopRoots(files: readonly string[]): FlopRoot[] {
  return files.flatMap((file) => {
    const rows = readJsonl(file).map(object)
    if (rows[0]?.type !== 'header' || rows[0]?.schema !== 'river-flop-root-v1')
      throw new Error(`${file}: expected river-flop-root-v1 header`)
    return rows.slice(1).map((row) => {
      if (row.type !== 'spot') throw new Error(`${file}: expected spot row`)
      return { board: boardCards(row.board, 3), ranges: denseRanges(object(row.root).ranges) }
    })
  })
}

export const STREET_PARITY_USAGE = `Usage (from repository root):
npx tsx apps/server/src/bot-street-parity.ts --spec <spec.jsonl> --out <result.jsonl> [--iterations-multiplier N] [--texas-dir <dir>] [--threads 8] [--flop-leaf turnstart|residual] [--raises allin|sized]
npx tsx apps/server/src/bot-street-parity.ts --make-spec --dumps <dump.jsonl ...> --count N --seed S --street flop|turn|river --pot P --stack S --out <spec.jsonl> [--iterations 40]
Flop solves use RIVER_TURN_START_NETWORK (export stem without .bin), as v9g's per-turn leaves.
--raises sized lets the bot raise to the bet size as well as all-in (bot side only; Texas inputs stay all-in).
--flop-leaf residual adds production's RIVER_TURN_RESIDUAL leaf on top, as v9g configures it.
Flop all-ins use production's seeded runouts (60; RIVER_DIAG_ALLIN_RUNOUTS override).
Turn solves use RIVER_RIVER_NETWORK (export stem without .bin), as v9g's per-river leaves.
Texas inputs are <n>-<street>.txt; run each with TexasSolver's cwd set to --texas-dir.
`

export function streetParityMain(args: readonly string[]) {
  if (args.length === 1 && args[0] === '--help') {
    console.log(STREET_PARITY_USAGE)
    return
  }
  const values = new Map<string, string[]>()
  const generating = args.includes('--make-spec')
  const allowed = generating
    ? [
        '--make-spec',
        '--dumps',
        '--count',
        '--seed',
        '--street',
        '--pot',
        '--stack',
        '--out',
        '--iterations',
      ]
    : [
        '--spec',
        '--out',
        '--iterations-multiplier',
        '--texas-dir',
        '--threads',
        '--flop-leaf',
        '--raises',
      ]
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i] as string
    if (!allowed.includes(flag) || values.has(flag))
      throw new Error(`unknown or duplicate option: ${flag}`)
    const items: string[] = []
    if (flag !== '--make-spec') {
      while (i + 1 < args.length && !args[i + 1]?.startsWith('--')) {
        items.push(args[++i] as string)
        if (flag !== '--dumps') break
      }
      if (!items.length) throw new Error(`missing value for ${flag}`)
    }
    values.set(flag, items)
  }
  const required = (flag: string) => {
    const value = values.get(flag)?.[0]
    if (value === undefined || value === '') throw new Error(`missing ${flag}`)
    return value
  }
  const output = required('--out')
  if (generating) {
    required('--dumps')
    const specs = makeStreetSpecs(readFlopRoots(values.get('--dumps') as string[]), {
      count: Number(required('--count')),
      seed: required('--seed'),
      street: required('--street') as StreetParitySpec['street'],
      pot: Number(required('--pot')),
      stack: Number(required('--stack')),
      iterations: Number(values.get('--iterations')?.[0] ?? 40),
    })
    writeFileSync(output, `${specs.map((row) => JSON.stringify(row)).join('\n')}\n`)
    return
  }
  const input = required('--spec')
  if (resolve(input) === resolve(output)) throw new Error('spec and output must be different files')
  const specs = readJsonl(input).map((row, i) => {
    try {
      return validateStreetSpec(row)
    } catch (error) {
      throw new Error(
        `spec row ${i + 1}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  })
  if (!specs.length) throw new Error('spec must contain at least one game')
  if (new Set(specs.map((spec) => spec.n)).size !== specs.length)
    throw new Error('duplicate spec n')
  const multiplier = positive(
    Number(values.get('--iterations-multiplier')?.[0] ?? 1),
    'iterations-multiplier',
  )
  for (const spec of specs) integer(spec.iterations * multiplier, 'scaled iterations')
  const threads = integer(Number(values.get('--threads')?.[0] ?? 8), 'threads')
  const texasDir = values.get('--texas-dir')?.[0]
  // Validate all exports and load weights before opening any output.
  const texas =
    texasDir === undefined
      ? []
      : specs.map((spec) => ({
          file: join(texasDir, `${spec.n}-${spec.street}.txt`),
          text: texasInput(spec, `${spec.n}-${spec.street}.json`, threads),
        }))
  const networks = {
    flop: specs.some((spec) => spec.street === 'flop')
      ? turnStartNetworkFromEnvironment()
      : undefined,
    turn: specs.some((spec) => spec.street === 'turn') ? riverNetworkFromEnvironment() : undefined,
    river: undefined,
  }
  const leafKind = values.get('--flop-leaf')?.[0] ?? 'turnstart'
  if (leafKind !== 'turnstart' && leafKind !== 'residual')
    throw new Error('--flop-leaf must be turnstart or residual')
  const residual = leafKind === 'residual' ? turnResidualOptionsFromEnvironment() : undefined
  if (leafKind === 'residual' && residual === undefined)
    throw new Error('--flop-leaf residual needs RIVER_TURN_RESIDUAL')
  const flopLeaf =
    residual === undefined
      ? undefined
      : {
          network: turnResidualLeaf(loadTurnResidualNetwork(residual.stem), {
            refreshIterations: residual.refreshIterations,
          }),
        }
  const raises = values.get('--raises')?.[0] ?? 'allin'
  if (raises !== 'allin' && raises !== 'sized') throw new Error('--raises must be allin or sized')
  const results = specs.map((spec) =>
    solveStreetParity(spec, multiplier, networks[spec.street], flopLeaf, raises === 'sized'),
  )
  if (texasDir !== undefined) mkdirSync(texasDir, { recursive: true })
  for (const item of texas) writeFileSync(item.file, item.text)
  writeFileSync(output, `${results.map((row) => JSON.stringify(row)).join('\n')}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    streetParityMain(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

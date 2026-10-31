import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { cardKey, parseCard } from '@river/engine'
import {
  type flopDumpSpot,
  jsonLines,
  type ReplayHand,
  replayOutputPath,
  replaySpot,
} from './bot-flop-defence-replay.js'
import { type FlopResolveDiagnostic, flopDecisionReach } from './bot-flop-diagnostics.js'
import { prepare, type RiverNode, type RiverSolution } from './bot-river-solver.js'
import { comboIndex52 } from './bot-river-value-data.js'
import { SLUMBOT_STAKE } from './bot-slumbot.js'

export type LockMode = 'none' | 'ip' | 'both'
export interface TexasNode {
  actions: string[]
  strategy: { strategy: Record<string, number[]> }
  childrens?: Record<string, TexasNode>
}
export interface SpotIndex {
  n: number
  file: string
  hand: number
  /** Big blinds. */
  bet: number
  history: string
}
type DumpSpot = ReturnType<typeof flopDumpSpot>
type ActionNode = Extract<RiverNode, { kind: 'action' }>
const bb = SLUMBOT_STAKE.bigBlind

/** TexasSolver hand keys are unordered pairs, in the dump's 1,326-combo order. */
export function parseHandKey(key: string): [number, number] {
  if (!/^(?:[2-9TJQKA][shdc]){2}$/.test(key)) throw new Error(`invalid hand key ${key}`)
  const a = cardKey(parseCard(key.slice(0, 2)))
  const b = cardKey(parseCard(key.slice(2)))
  if (a === b) throw new Error(`duplicate card in ${key}`)
  return a < b ? [a, b] : [b, a]
}

function handClass(a: number, b: number) {
  const ranks = [a % 13, b % 13].sort((x, y) => y - x)
  return `${ranks.join(',')}:${a % 13 === b % 13 ? 'p' : Math.floor(a / 13) === Math.floor(b / 13) ? 's' : 'o'}`
}

/** Only suit permutations preserving the board as a set are valid isomorphisms. */
function boardSymmetries(board: readonly string[]) {
  const keys = new Set(board.map((c) => cardKey(parseCard(c))))
  const permutations: number[][] = []
  const visit = (prefix: number[]) => {
    if (prefix.length === 4) {
      if ([...keys].every((c) => keys.has((prefix[Math.floor(c / 13)] as number) * 13 + (c % 13))))
        permutations.push(prefix)
      return
    }
    for (let suit = 0; suit < 4; suit++) if (!prefix.includes(suit)) visit([...prefix, suit])
  }
  visit([])
  return permutations
}

export function texasLookup(node: TexasNode, board: readonly string[]) {
  if (!node.actions.length || new Set(node.actions).size !== node.actions.length)
    throw new Error('invalid TexasSolver actions')
  const blocked = new Set(board.map((c) => cardKey(parseCard(c))))
  const present = new Map<number, number[]>()
  const classes = new Map<string, number[][]>()
  for (const [key, row] of Object.entries(node.strategy.strategy)) {
    const [a, b] = parseHandKey(key)
    if (blocked.has(a) || blocked.has(b)) continue
    const total = row.reduce((s, p) => s + p, 0)
    if (
      row.length !== node.actions.length ||
      row.some((p) => !Number.isFinite(p) || p < 0 || p > 1) ||
      Math.abs(total - 1) > 0.0001
    )
      throw new Error(`invalid TexasSolver probabilities for ${key}`)
    const index = comboIndex52(a, b)
    if (present.has(index)) throw new Error(`duplicate TexasSolver combo ${key}`)
    // Preserve the requested lock probability exactly; normalize only residual bot actions.
    const probabilities = row.slice()
    present.set(index, probabilities)
    const kind = handClass(a, b)
    classes.set(kind, [...(classes.get(kind) ?? []), probabilities])
  }
  const symmetries = boardSymmetries(board)
  const counts = { direct: 0, isomorphism: 0, class: 0 }
  return {
    counts,
    row(a: number, b: number) {
      const direct = present.get(comboIndex52(a, b))
      if (direct) {
        counts.direct++
        return direct
      }
      for (const suits of symmetries) {
        const mapped = present.get(
          comboIndex52(
            (suits[Math.floor(a / 13)] as number) * 13 + (a % 13),
            (suits[Math.floor(b / 13)] as number) * 13 + (b % 13),
          ),
        )
        if (mapped) {
          counts.isomorphism++
          return mapped
        }
      }
      const rows = classes.get(handClass(a, b))
      if (!rows?.length)
        throw new Error(`no TexasSolver hand-class support for combo ${comboIndex52(a, b)}`)
      counts.class++
      return node.actions.map(
        (_, action) => rows.reduce((s, r) => s + (r[action] as number), 0) / rows.length,
      )
    },
  }
}

function actionNode(tree: RiverNode, history: string): ActionNode {
  const find = (node: RiverNode): ActionNode | undefined => {
    if (node.kind !== 'action') return undefined
    if (node.history === history) return node
    for (const child of node.children) {
      const found = find(child)
      if (found) return found
    }
    return undefined
  }
  const found = find(tree)
  if (found) return found
  throw new Error(`missing action node ${history}`)
}

/** Keep one probability exact, then normalize only the other actions. */
export function lockedRow(fixed: number, probability: number, weights: readonly number[]) {
  if (fixed < 0 || fixed >= weights.length || probability < 0 || probability > 1)
    throw new Error('invalid lock')
  const total = weights.reduce((sum, weight, a) => sum + (a === fixed ? 0 : weight), 0)
  const fallback = weights.findIndex((_, a) => a !== fixed)
  if (fallback < 0 && probability !== 1) throw new Error('no alternative lock action')
  return weights.map((weight, a) =>
    a === fixed
      ? probability
      : (1 - probability) * (total > 0 ? weight / total : a === fallback ? 1 : 0),
  )
}

function texasLabelMatches(label: string, action: string) {
  if (label === 'CHECK') return action === 'k'
  if (label === 'ALLIN') return action === 'a'
  const match = /^BET ([0-9]+(?:\.[0-9]+)?)$/.exec(label)
  return (
    match !== null &&
    action.startsWith('b') &&
    Math.abs(Number(match[1]) - Number(action.slice(1)) / bb) < 1e-8
  )
}

export function buildMatchedLocks(
  mode: LockMode,
  baseline: RiverSolution,
  frozen: ReadonlyMap<string, Float64Array>,
  texas: TexasNode,
  observedBet: number,
) {
  const fixedStrategies = new Map<string, Float64Array>()
  const counts = {
    oop: { direct: 0, isomorphism: 0, class: 0 },
    ip: { direct: 0, isomorphism: 0, class: 0 },
  }
  if (mode === 'none') return { fixedStrategies, counts }
  const root = actionNode(baseline.tree, '')
  const ip = actionNode(baseline.tree, 'k')
  if (root.player !== 0 || ip.player !== 1) throw new Error('expected OOP root and IP check node')
  const rootFrozen = frozen.get('')
  if (!rootFrozen) throw new Error('missing production frozen OOP root')
  fixedStrategies.set('', rootFrozen.slice())
  const board = baseline.spot.board.map((c) => `${c.rank}${c.suit}`)
  if (mode === 'both') {
    const lookup = texasLookup(texas, board)
    const check = texas.actions.indexOf('CHECK')
    if (check < 0) throw new Error('TexasSolver root has no CHECK')
    const table = prepare(baseline.spot.ranges[0], baseline.spot.board).combos.flatMap((combo, h) =>
      lockedRow(
        root.actions.indexOf('k'),
        lookup.row(cardKey(combo.hole[0]), cardKey(combo.hole[1]))[check] as number,
        Array.from(rootFrozen.subarray(h * root.actions.length, (h + 1) * root.actions.length)),
      ),
    )
    fixedStrategies.set('', Float64Array.from(table))
    counts.oop = lookup.counts
  }
  const source = texas.childrens?.CHECK
  if (!source) throw new Error('TexasSolver has no childrens.CHECK')
  const candidates = source.actions
    .flatMap((label, index) => {
      const match = /^BET ([0-9]+(?:\.[0-9]+)?)$/.exec(label)
      return match ? [{ index, distance: Math.abs(Number(match[1]) - observedBet) }] : []
    })
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
  const selected = candidates[0]?.index
  if (selected === undefined) throw new Error('TexasSolver IP has no BET child')
  const exact = ip.actions.findIndex(
    (label) => label.startsWith('b') && Math.abs(Number(label.slice(1)) / bb - observedBet) < 1e-8,
  )
  if (exact < 0) throw new Error('missing observed exact-size IP bet')
  const own = baseline.strategy.get('k')
  if (!own) throw new Error('missing bot IP strategy')
  const lookup = texasLookup(source, board)
  const table = prepare(baseline.spot.ranges[1], baseline.spot.board).combos.flatMap((combo, h) => {
    const probabilities = lookup.row(cardKey(combo.hole[0]), cardKey(combo.hole[1]))
    const weights = ip.actions.map((label, action) => {
      // The selected Texas BET supplies the observed bet; only other Texas actions supply residual weights.
      const match = source.actions.findIndex(
        (s, a) => a !== selected && texasLabelMatches(s, label),
      )
      return match < 0
        ? (own[h * ip.actions.length + action] as number)
        : (probabilities[match] as number)
    })
    return lockedRow(exact, probabilities[selected] as number, weights)
  })
  fixedStrategies.set('k', Float64Array.from(table))
  counts.ip = lookup.counts
  return { fixedStrategies, counts }
}

export function matchedDecision(solution: RiverSolution, history: string) {
  const node = actionNode(solution.tree, history)
  if (node.player !== 0) throw new Error('decision must belong to OOP')
  const table = solution.strategy.get(history)
  if (!table) throw new Error('missing OOP decision strategy')
  const { reach, ipBetReach } = flopDecisionReach(solution, history)
  const strategy = prepare(solution.spot.ranges[0], solution.spot.board).combos.map((combo, h) => {
    const index = comboIndex52(cardKey(combo.hole[0]), cardKey(combo.hole[1]))
    return {
      combo: index,
      reach: reach[index] as number,
      probabilities: Array.from(
        table.subarray(h * node.actions.length, (h + 1) * node.actions.length),
      ),
    }
  })
  const mass = strategy.reduce((sum, row) => sum + row.reach, 0)
  const average = (accept: (action: string) => boolean) =>
    mass > 0
      ? strategy.reduce(
          (sum, row) =>
            sum +
            row.reach *
              row.probabilities.reduce(
                (s, p, a) => s + (accept(node.actions[a] as string) ? p : 0),
                0,
              ),
          0,
        ) / mass
      : null
  return {
    actions: node.actions,
    strategy,
    oopDecisionMass: mass,
    ipBetReach,
    botFold: average((a) => a === 'f'),
    botRaise: average((a) => a === 'a' || a.startsWith('b')),
  }
}

export function matchedResolve(
  mode: LockMode,
  texas: TexasNode | undefined,
  observedBet: number,
  capture: (
    solution: RiverSolution,
    counts: ReturnType<typeof buildMatchedLocks>['counts'],
  ) => void,
): FlopResolveDiagnostic {
  return (request) => {
    if (mode === 'none') {
      const solution = request.solve(new Map())
      capture(solution, {
        oop: { direct: 0, isomorphism: 0, class: 0 },
        ip: { direct: 0, isomorphism: 0, class: 0 },
      })
      return solution
    }
    if (!texas) throw new Error('missing TexasSolver input')
    const baseline = request.solve(request.fixedStrategies)
    const locks = buildMatchedLocks(mode, baseline, request.fixedStrategies, texas, observedBet)
    const solution = request.solve(locks.fixedStrategies)
    capture(solution, locks.counts)
    return solution
  }
}

const basename = (file: string) => file.replaceAll('\\', '/').split('/').at(-1) as string
export const matchedSpotKey = (file: string, hand: number) => JSON.stringify([basename(file), hand])

export function parseMatchedArgs(args: readonly string[]) {
  const values = new Map<string, string[]>()
  const allowed = [
    '--spots',
    '--index',
    '--solver',
    '--logs',
    '--mode',
    '--lock',
    '--out',
    '--shard',
  ]
  for (let i = 0; i < args.length; ) {
    const key = args[i++] as string
    if (!allowed.includes(key) || values.has(key)) throw new Error(`invalid option ${key}`)
    const parts: string[] = []
    while (i < args.length && !args[i]?.startsWith('--')) parts.push(args[i++] as string)
    if (!parts.length || (!['--spots', '--logs'].includes(key) && parts.length !== 1))
      throw new Error(`invalid value for ${key}`)
    values.set(key, parts)
  }
  const one = (key: string) => values.get(key)?.[0]
  const mode = one('--mode') ?? one('--lock') ?? 'both'
  if (values.has('--mode') && values.has('--lock'))
    throw new Error('use --mode or --lock, not both')
  if (mode !== 'none' && mode !== 'ip' && mode !== 'both')
    throw new Error('--mode must be none|ip|both')
  const index = one('--index')
  const solver = one('--solver')
  const out = one('--out')
  const spots = values.get('--spots')
  const logs = values.get('--logs')
  if (!index || !solver || !out || !spots || !logs)
    throw new Error(
      'usage: --spots <dump.jsonl ...> --index <index.jsonl> --solver <dir> --logs <log.jsonl ...> --mode none|ip|both --out <file.jsonl> [--shard k/K]',
    )
  const shard = /^(\d+)\/(\d+)$/.exec(one('--shard') ?? '1/1')
  const k = Number(shard?.[1])
  const total = Number(shard?.[2])
  if (!Number.isSafeInteger(k) || !Number.isSafeInteger(total) || k < 1 || k > total)
    throw new Error('--shard must be k/K, with 1 <= k <= K')
  return { mode: mode as LockMode, index, solver, out, spots, logs, k, total }
}

/** Dump.decision contains strategy data, so locate its numeric replay index in the log. */
export function replaySpotForDump(log: ReplayHand, dump: DumpSpot) {
  const candidates = log.aivatDecisions.flatMap(({ observation: o }, decision) => {
    const actionLine = (o.actions ?? [])
      .filter((move) => move.street === 'flop')
      .map((move) => ({
        player: dump.players.indexOf(
          o.seats.find((seat) => seat.seat === move.seat)?.playerId ?? '',
        ),
        action: move.action,
      }))
    return o.street === 'flop' &&
      o.actor.playerId === dump.players[0] &&
      o.amountToCall === dump.decision.toCall &&
      isDeepStrictEqual(
        o.board.map((c) => `${c.rank}${c.suit}`),
        dump.board,
      ) &&
      isDeepStrictEqual(actionLine, dump.actionLine)
      ? [decision]
      : []
  })
  if (candidates.length !== 1) throw new Error('missing or ambiguous logged flop decision')
  return {
    file: dump.file,
    line: dump.line,
    hand: dump.hand,
    fraction: dump.fraction,
    decision: candidates[0] as number,
  }
}

export async function main(args: string[]) {
  const options = parseMatchedArgs(args)
  const destination = replayOutputPath(options.out)
  const inputs = [options.index, ...options.spots, ...options.logs]
  if (inputs.some((file) => resolve(file) === destination))
    throw new Error('output must differ from inputs')
  const indices: SpotIndex[] = []
  const ids = new Set<number>()
  for await (const { value } of jsonLines<SpotIndex>(options.index)) {
    if (
      !Number.isSafeInteger(value.n) ||
      value.n < 0 ||
      ids.has(value.n) ||
      !Number.isFinite(value.bet) ||
      value.bet <= 0 ||
      !/^kb\d+$/.test(value.history)
    )
      throw new Error('invalid or duplicate spot index')
    if (Math.abs(Number(value.history.slice(2)) - value.bet * bb) > 1e-8)
      throw new Error('index bet/history units differ')
    ids.add(value.n)
    indices.push(value)
  }
  const selected = indices.filter((_, i) => i % options.total === options.k - 1)
  const wanted = new Set(selected.map((s) => matchedSpotKey(s.file, s.hand)))
  const dumps = new Map<string, DumpSpot>()
  for (const file of options.spots) {
    for await (const { value } of jsonLines<DumpSpot>(file)) {
      if (value.type !== 'spot') continue
      const key = matchedSpotKey(value.file, value.hand)
      if (!wanted.has(key)) continue
      if (dumps.has(key)) throw new Error(`ambiguous dump spot ${key}`)
      dumps.set(key, value)
    }
  }
  const logs = new Map<string, ReplayHand>()
  for (const file of options.logs) {
    for await (const { value } of jsonLines<ReplayHand>(file)) {
      const key = matchedSpotKey(file, value.hand)
      if (!wanted.has(key)) continue
      if (logs.has(key)) throw new Error(`ambiguous log hand ${key}`)
      logs.set(key, value)
    }
  }
  // Validate joins and solver inputs before truncating output or starting any solve.
  const jobs = selected.map((index) => {
    const key = matchedSpotKey(index.file, index.hand)
    const dump = dumps.get(key)
    const log = logs.get(key)
    if (!dump || !log) throw new Error(`missing dump/log ${key}`)
    if (
      dump.self !== 0 ||
      log.clientPos !== 0 ||
      dump.board.length !== 3 ||
      dump.decision.history !== index.history
    )
      throw new Error(`spot perspective/history mismatch ${key}`)
    const solverFile = resolve(options.solver, `spot-${String(index.n).padStart(2, '0')}.json`)
    if (solverFile === destination) throw new Error('output must differ from solver input')
    const texas =
      options.mode === 'none'
        ? undefined
        : (JSON.parse(readFileSync(solverFile, 'utf8')) as TexasNode)
    return { index, dump, log, texas }
  })
  writeFileSync(destination, '')
  for (const { index, dump, log, texas } of jobs) {
    const started = performance.now()
    let solved: RiverSolution | undefined
    let counts: ReturnType<typeof buildMatchedLocks>['counts'] | undefined
    const diagnostic = matchedResolve(options.mode, texas, index.bet, (solution, mappings) => {
      solved = solution
      counts = mappings
    })
    replaySpot(
      log,
      replaySpotForDump(log, dump),
      'prod',
      'matched-range',
      (actual) => {
        if (
          !isDeepStrictEqual(actual.root, dump.root) ||
          !isDeepStrictEqual(actual.board, dump.board) ||
          actual.decision.history !== index.history ||
          !isDeepStrictEqual(actual.actionLine, dump.actionLine)
        )
          throw new Error(
            'replayed root/tree/history differs from dump; check network/environment inputs',
          )
      },
      { flopResolveDiagnostic: diagnostic },
    )
    if (!solved || !counts)
      throw new Error(`no exact-size off-tree solve intercepted for spot ${index.n}`)
    appendFileSync(
      destination,
      `${JSON.stringify({
        n: index.n,
        file: index.file,
        hand: index.hand,
        board: dump.board,
        mode: options.mode,
        ...matchedDecision(solved, index.history),
        counts,
        isomorphismMappedCombos: counts.oop.isomorphism + counts.ip.isomorphism,
        classMappedCombos: counts.oop.class + counts.ip.class,
        ms: performance.now() - started,
      })}\n`,
    )
    console.error(
      JSON.stringify({ n: index.n, mode: options.mode, ms: performance.now() - started }),
    )
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })

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
import {
  type BotPolicy,
  type Card,
  cardKey,
  championPersonality,
  DEFAULT_STAKE,
  mulberry32,
  seedFromString,
} from '@river/engine'
import { releasePolicyHand } from './bot-policy-hand.js'
import { type Hole, sampleEquity } from './bot-preflop-solve-equity.js'
import { flopContext } from './bot-preflop-solve-realisation.js'
import { exactPreflopRanges, preflopClass, tracePreflop } from './bot-preflop-tables.js'
import { publicDecisions } from './bot-public-replay.js'
import { fitRealisation, type RealisationObservation } from './bot-realisation-fit.js'
import { actionFor, observationFor } from './bot-service.js'
import { v9gPolicy } from './bot-v9g-policy.js'
import { defaultRoomConfig, Room } from './room.js'

const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')
export const EQUITY_ESTIMATOR = hash(
  'exactPreflopRanges(board=[]), hero blockers, inverse-CDF opponent, sampleEquity(2), v1',
)
export interface CalibrationOptions {
  seed: string
  worker: number
  depth: number
  equitySamples: number
  policyId: string
}
export function handSeed(seed: string, worker: number, hand: number): string {
  return `${seed}:${worker}:${hand}`
}
/** Payouts, including uncalled returns, minus ALL investments: final stack - buy-in. */
export function handStartNet(finalStack: number, buyIn: number, bb: number): number {
  return (finalStack - buyIn) / bb
}
/** Exact table reach, conditioned only on hero cards; boards sampled before seeing the flop. */
export function rangeEquity(
  hole: readonly Card[],
  range: ReturnType<typeof exactPreflopRanges>[0],
  samples: number,
  seed: string,
): number {
  if (!Number.isSafeInteger(samples) || samples < 2) throw new Error('invalid equity samples')
  const hero = hole.map(cardKey) as unknown as Hole
  const compatible = range.filter(
    (r) => r.weight > 0 && !r.hole.some((c) => hero.includes(cardKey(c))),
  )
  const cumulative: number[] = []
  let total = 0
  for (const r of compatible) {
    total += r.weight
    cumulative.push(total)
  }
  if (!(total > 0)) throw new Error('zero compatible table reach')
  const rng = mulberry32(seedFromString(seed))
  let equity = 0
  for (let i = 0; i < samples; i++) {
    const draw = rng() * total
    let lo = 0,
      hi = cumulative.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (draw < required(cumulative[mid])) hi = mid
      else lo = mid + 1
    }
    const other = required(compatible[lo]).hole.map(cardKey) as unknown as Hole
    equity += sampleEquity(hero, other, 2, Math.floor(rng() * 4294967296)).equity
  }
  return equity / samples
}
export function recordCalibrationHand(
  options: CalibrationOptions,
  index: number,
  policies: readonly [BotPolicy, BotPolicy],
) {
  const key = handSeed(options.seed, options.worker, index)
  const rng = mulberry32(seedFromString(`${key}:deck`))
  const bb = 100
  const buyIn = options.depth * bb
  const ids = ['calibration-a', 'calibration-b'] as const
  const room = new Room(
    `realisation-${key}`,
    defaultRoomConfig({
      seed: key,
      maxSeats: 2,
      inviteCode: 'RIVER2',
      seedCollectionMs: 0,
      nowMs: () => 0,
      randomBytes: (size) => Uint8Array.from({ length: size }, () => Math.floor(rng() * 256)),
      stake: {
        ...DEFAULT_STAKE,
        smallBlind: bb / 2,
        bigBlind: bb,
        minBuyIn: buyIn,
        maxBuyIn: buyIn,
        defaultBuyIn: buyIn,
      },
    }),
  )
  const accepted = (r: { ok: boolean }) => {
    if (!r.ok) throw new Error('room rejected calibration action')
  }
  ids.forEach((playerId, seat) => {
    accepted(room.submit({ kind: 'join', playerId, name: playerId }))
    accepted(room.submit({ kind: 'sit', playerId, seat: (seat + index) % 2, buyIn }))
  })
  accepted(room.submit({ kind: 'startHand' }))
  const holes = ids.map((id) =>
    required(required(room.viewFor(id).seats.find((s) => s.playerId === id)).hole),
  )
  const actionRng = ids.map((_, i) => mulberry32(seedFromString(`${key}:action:${i}`)))
  let pending: Omit<RealisationObservation, 'netFromHandStartBb'>[] = []
  let postflopFold = false
  let reached = false
  try {
    for (let step = 0; step < 1000; step++) {
      const view = room.viewFor('')
      if (view.phase === 'between') {
        if (room.totalChips() !== 2 * buyIn) throw new Error('calibration chip conservation failed')
        const observations: RealisationObservation[] = pending.map((o, i) => ({
          ...o,
          netFromHandStartBb: handStartNet(
            required(view.seats.find((s) => s.playerId === ids[i])).stack,
            buyIn,
            bb,
          ),
        }))
        return { observations, postflopFold, reachedFlopLeaf: reached, preflopTerminal: !reached }
      }
      const id = view.currentActor?.playerId
      if (!id) throw new Error('missing calibration actor')
      const seat = ids.indexOf(id as (typeof ids)[number])
      if (seat < 0) throw new Error('unknown calibration actor')
      const ownView = room.viewFor(id)
      const obs = observationFor(ownView, id, undefined, room.id, room.currentActions())
      if (!obs) throw new Error('missing calibration observation')
      if (!reached && obs.street === 'flop') {
        const history = publicDecisions(obs)
        if (!history) throw new Error('missing calibration history')
        const trace = tracePreflop(obs, history)
        if (typeof trace === 'string' || trace.node.kind !== 'flop' || trace.offTree.length)
          throw new Error('calibration must reach an on-table flop leaf')
        const ranges = exactPreflopRanges(trace, [], ids)
        const paid = ids.map(
          (p) => required(obs.seats.find((s) => s.playerId === p)).betHand / bb,
        ) as [number, number]
        const potBb = paid[0] + paid[1]
        const context = flopContext(paid, options.depth)
        const last = required(trace.line.at(-1))
        const lastAction = required(last.node.actions[required(last.indices[0])])
        pending = ids.map((p, i) => ({
          schema: 'river-realisation-observation-v1',
          handId: key,
          postflopPolicyId: options.policyId,
          opponentPolicyId: options.policyId,
          equityTableHash: EQUITY_ESTIMATOR,
          nodeId: `${last.node.id}/${lastAction.label}`,
          handClass: preflopClass(required(holes[i])),
          position: trace.players[0] === p ? 'ip' : 'oop',
          potType: context.potType,
          effectiveStackBb: options.depth,
          potBb,
          ownPreflopContributionBb: required(paid[i]),
          spr: context.spr,
          equityVsOpponentRange: rangeEquity(
            required(holes[i]),
            required(ranges[1 - i]),
            options.equitySamples,
            `${key}:equity:${i}`,
          ),
          weight: 1,
        }))
        reached = true
      }
      let fallback: string | null = null
      const action = actionFor(ownView, id, championPersonality(), required(actionRng[seat]), {
        policy: required(policies[seat]),
        roomId: room.id,
        publicActions: room.currentActions(),
        trace: (event) => {
          fallback = event.fallbackReason ?? null
        },
      })
      if (fallback) throw new Error(`policy fallback: ${fallback}`)
      if (!action) throw new Error('missing calibration action')
      if (reached && action.kind === 'fold') postflopFold = true
      accepted(room.submit({ kind: 'act', playerId: id, action }))
    }
    throw new Error('calibration exceeded action limit')
  } finally {
    for (const policy of policies) releasePolicyHand(policy, room.id, room.viewFor('').handNumber)
  }
}
/** Publish only complete shards. A restart never consumes a .part file. */
export function writeCalibrationShard(
  path: string,
  first: number,
  count: number,
  play: (index: number) => ReturnType<typeof recordCalibrationHand>,
) {
  if (existsSync(path)) {
    const stats = JSON.parse(readFileSync(`${path}.stats.json`, 'utf8')) as { sha256?: string }
    if (stats.sha256 !== hash(readFileSync(path)))
      throw new Error(`corrupt calibration shard ${path}`)
    return false
  }
  const lines: string[] = []
  const stats = { hands: count, flopHands: 0, postflopFolds: 0, observations: 0 }
  for (let i = first; i < first + count; i++) {
    const hand = play(i)
    stats.flopHands += Number(hand.reachedFlopLeaf)
    stats.postflopFolds += Number(hand.postflopFold)
    stats.observations += hand.observations.length
    for (const o of hand.observations) lines.push(JSON.stringify(o))
  }
  const content = lines.length ? `${lines.join('\n')}\n` : ''
  writeFileSync(
    `${path}.stats.json.part`,
    `${JSON.stringify({ ...stats, sha256: hash(content) })}\n`,
  )
  writeFileSync(`${path}.part`, content)
  renameSync(`${path}.stats.json.part`, `${path}.stats.json`)
  renameSync(`${path}.part`, path)
  return stats
}
function inside(path: string): string {
  const absolute = resolve(path)
  const rel = relative(process.cwd(), absolute)
  if (rel === '..' || rel.startsWith('..\\') || rel.startsWith('../') || isAbsolute(rel))
    throw new Error('writes must stay inside the worktree')
  return absolute
}
function sourceHash(dir: string): string {
  const digest = createHash('sha256')
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (e.isDirectory()) digest.update(sourceHash(join(dir, e.name)))
    else if (/\.(ts|js|json)$/.test(e.name))
      digest.update(e.name).update(readFileSync(join(dir, e.name)))
  }
  return digest.digest('hex')
}
export function main(args = process.argv.slice(2)) {
  const { values: v } = parseArgs({
    args,
    options: {
      fit: { type: 'boolean' },
      input: { type: 'string' },
      out: { type: 'string' },
      seed: { type: 'string', default: 'realisation-v1' },
      worker: { type: 'string', default: '0' },
      shards: { type: 'string', default: '1' },
      'hands-per-shard': { type: 'string', default: '50' },
      depth: { type: 'string', default: '100' },
      'equity-samples': { type: 'string', default: '8192' },
      seconds: { type: 'string', default: '540' },
    },
  })
  const out = inside(v.out ?? (v.fit ? 'out/realisation/realisation.json' : 'out/realisation'))
  if (v.fit) {
    if (!v.input) throw new Error('--fit requires --input JSONL file or shard directory')
    const files = v.input.endsWith('.jsonl')
      ? [v.input]
      : readdirSync(v.input)
          .filter((f) => f.endsWith('.jsonl'))
          .sort()
          .map((f) => join(required(v.input), f))
    const observations = files.flatMap((f) =>
      readFileSync(f, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .map((l) => JSON.parse(l) as RealisationObservation),
    )
    const result = fitRealisation(observations)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, `${JSON.stringify(result.config, null, 2)}\n`)
    writeFileSync(`${out}.fit.json`, `${JSON.stringify(result, null, 2)}\n`)
    console.log(JSON.stringify(result, null, 2))
    return
  }
  const worker = Number(v.worker),
    shards = Number(v.shards),
    perShard = Number(v['hands-per-shard'])
  const depth = Number(v.depth),
    samples = Number(v['equity-samples']),
    seconds = Number(v.seconds)
  if (
    ![worker, shards, perShard, depth, samples, seconds].every(Number.isSafeInteger) ||
    worker < 0 ||
    worker > 65535 ||
    shards < 1 ||
    perShard < 1 ||
    ![100, 200].includes(depth) ||
    samples < 2 ||
    seconds < 1 ||
    seconds > 600
  )
    throw new Error('invalid calibration arguments')
  process.env.RIVER_VALUE_BACKEND = 'wasm'
  process.env.RIVER_VALUE_THREADS ??= '1'
  const threads = Number(process.env.RIVER_VALUE_THREADS)
  if (!Number.isSafeInteger(threads) || threads < 1 || threads > 4)
    throw new Error('value threads must be an integer from 1 to 4')
  const modelHashes: Record<string, string> = {}
  for (const env of [
    'RIVER_TURN_NETWORK',
    'RIVER_FLOP_NETWORK',
    'RIVER_TURN_START_NETWORK',
    'RIVER_RIVER_NETWORK',
  ]) {
    const stem = process.env[env]
    if (!stem) throw new Error(`missing ${env}`)
    modelHashes[env] = hash(
      Buffer.concat([readFileSync(`${stem}.json`), readFileSync(`${stem}.bin`)]),
    )
  }
  const tables = [100, 200].map((d) =>
    hash(readFileSync(new URL(`../preflop/v2/${d}bb.json`, import.meta.url))),
  )
  const policyId = `v9gp:${hash(JSON.stringify({ modelHashes, tables, source: sourceHash('apps/server/src'), engine: sourceHash('packages/engine/src') }))}`
  const manifest = {
    schema: 'river-realisation-run-v1',
    seed: required(v.seed),
    depth,
    perShard,
    equitySamples: samples,
    policyId,
    opponent: 'v9gp self-play; fresh hands, no session reads',
    tables,
    modelHashes,
    equityEstimator: EQUITY_ESTIMATOR,
    equityNote:
      'exact physical table reach; seeded MC equity, 2 runouts per sample; no observed board/opponent hole conditioning',
    backend: 'wasm',
    threads: process.env.RIVER_VALUE_THREADS,
    shardSeed: '<seed>:<worker>:<shard * handsPerShard + offset>',
  }
  mkdirSync(out, { recursive: true })
  const manifestPath = join(out, 'manifest.json')
  const encoded = `${JSON.stringify(manifest, null, 2)}\n`
  if (existsSync(manifestPath)) {
    if (readFileSync(manifestPath, 'utf8') !== encoded)
      throw new Error('manifest mismatch; use another output directory')
  } else {
    // Another worker may publish the identical manifest between exists and open.
    try {
      writeFileSync(manifestPath, encoded, { flag: 'wx' })
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== 'EEXIST' ||
        readFileSync(manifestPath, 'utf8') !== encoded
      )
        throw error
    }
  }
  const policies = [
    v9gPolicy({ offTree: 'resolve', preflopTables: true }).policy,
    v9gPolicy({ offTree: 'resolve', preflopTables: true }).policy,
  ] as const
  const started = performance.now(),
    deadline = started + seconds * 1000
  let hands = 0
  let interrupted = false
  const budgetExhausted = new Error('time budget exhausted')
  for (let shard = 0; shard < shards; shard++) {
    if (performance.now() >= deadline) break
    const path = join(
      out,
      `realisation-w${String(worker).padStart(3, '0')}-${String(shard).padStart(5, '0')}.jsonl`,
    )
    let stats: ReturnType<typeof writeCalibrationShard>
    try {
      stats = writeCalibrationShard(path, shard * perShard, perShard, (i) => {
        if (performance.now() >= deadline) throw budgetExhausted
        const result = recordCalibrationHand(
          { seed: required(v.seed), worker, depth, equitySamples: samples, policyId },
          i,
          policies,
        )
        console.error(`worker ${worker} hand ${i}: ${result.observations.length} observations`)
        return result
      })
    } catch (error) {
      if (error !== budgetExhausted) throw error
      interrupted = true
      break
    }
    if (stats) {
      hands += stats.hands
      console.error(JSON.stringify({ shard, ...stats }))
    }
  }
  const elapsedSeconds = (performance.now() - started) / 1000
  console.log(
    JSON.stringify({
      hands,
      interrupted,
      elapsedSeconds,
      handsPerHourPerWorker: (hands * 3600) / elapsedSeconds,
    }),
  )
}
if (process.argv[1]?.replace(/\\/g, '/').endsWith('/bot-realisation-calibrate.ts')) main()

function required<T>(value: T): NonNullable<T> {
  if (value === null || value === undefined) throw new Error('missing required calibration value')
  return value
}

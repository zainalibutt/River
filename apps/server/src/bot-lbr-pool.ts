import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { clusteredEstimate } from './bot-session-evaluation.js'

// Usage: tsx bot-lbr-pool.ts <directory> <file prefix>
// Pools local best response shards: what the probe won from each focal policy,
// split by the focal seat's position and stack depth, the paired difference
// between focal policies dealt the same seeds, and where the probe bet. Shards
// that carry all-in adjusted chips are also reported that way, with the
// adjusted-minus-raw difference as a check that the adjustment adds no bias.
const [directory, prefix] = process.argv.slice(2)
if (!directory || !prefix) throw new Error('usage: <directory> <file prefix>')

type HandRow = [
  session: number,
  focalChips: number,
  position: string,
  depth: string,
  adjustedChips?: number,
]
interface Shard {
  readonly focal: string
  readonly seed: string
  readonly sessions: number
  readonly choices: Record<string, { count: number; foldShare: number }>
  readonly hands: HandRow[]
}
const shards = readdirSync(directory)
  .filter((name) => name.startsWith(prefix) && name.endsWith('.json'))
  .map((name) => JSON.parse(readFileSync(join(directory, name), 'utf8')) as Shard)
const focals = [...new Set(shards.map((shard) => shard.focal))].sort()
const seeds = [...new Set(shards.map((shard) => shard.seed))].sort()
const round = (value: number) => Math.round(value * 10) / 10
const describe = (rows: { session: number; value: number }[], clusters: number) => {
  if (rows.length === 0 || clusters < 2) return 'no hands'
  const estimate = clusteredEstimate(rows, clusters)
  const [low, high] = estimate.interval95
  return `${round(estimate.bigBlindsPer100)} (${round(low)} to ${round(high)}) bb/100, ${estimate.hands} hands`
}

/** Probe winnings per hand for one focal policy, keyed by seed, session and hand. */
function probeRows(
  focal: string,
  keep: (row: HandRow) => boolean = () => true,
  value: (row: HandRow) => number = (row) => -row[1],
) {
  const rows: { session: number; value: number; key: string }[] = []
  let clusters = 0
  for (const seed of seeds) {
    const shard = shards.find((entry) => entry.focal === focal && entry.seed === seed)
    if (shard === undefined) continue
    const counters = new Map<number, number>()
    for (const row of shard.hands) {
      const index = counters.get(row[0]) ?? 0
      counters.set(row[0], index + 1)
      if (keep(row)) {
        rows.push({
          session: clusters + row[0],
          value: value(row),
          key: `${seed}:${row[0]}:${index}`,
        })
      }
    }
    clusters += shard.sessions
  }
  return { rows, clusters }
}

for (const focal of focals) {
  const all = probeRows(focal)
  process.stdout.write(`${focal}: probe wins ${describe(all.rows, all.clusters)}\n`)
  const adjustable = (row: HandRow) => row[4] !== undefined
  const adjusted = probeRows(focal, adjustable, (row) => -(row[4] as number))
  if (adjusted.rows.length > 0) {
    const raw = probeRows(focal, adjustable)
    const bias = probeRows(focal, adjustable, (row) => row[1] - (row[4] as number))
    const spread = (rows: { value: number }[]) => {
      const mean = rows.reduce((sum, row) => sum + row.value, 0) / rows.length
      return Math.sqrt(rows.reduce((sum, row) => sum + (row.value - mean) ** 2, 0) / rows.length)
    }
    process.stdout.write(
      `  all-in adjusted: ${describe(adjusted.rows, adjusted.clusters)}; adjusted minus raw ${describe(bias.rows, bias.clusters)}; spread per hand ${Math.round(spread(raw.rows))} raw, ${Math.round(spread(adjusted.rows))} adjusted chips\n`,
    )
  }
  for (const position of ['button', 'big-blind']) {
    const slice = probeRows(focal, (row) => row[2] === position)
    process.stdout.write(`  focal on the ${position}: ${describe(slice.rows, slice.clusters)}\n`)
  }
  for (const depth of ['short', 'standard', 'deep']) {
    const slice = probeRows(focal, (row) => row[3] === depth)
    process.stdout.write(`  ${depth} stacks: ${describe(slice.rows, slice.clusters)}\n`)
  }
  const tallies: Record<string, { count: number; foldShare: number }> = {}
  for (const shard of shards.filter((entry) => entry.focal === focal)) {
    for (const [key, tally] of Object.entries(shard.choices)) {
      const sum = tallies[key] ?? { count: 0, foldShare: 0 }
      sum.count += tally.count
      sum.foldShare += tally.foldShare
      tallies[key] = sum
    }
  }
  const choiceText = Object.entries(tallies)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, tally]) =>
      tally.foldShare > 0
        ? `${key} ${tally.count} (expects ${Math.round((100 * tally.foldShare) / tally.count)}% folds)`
        : `${key} ${tally.count}`,
    )
    .join(', ')
  process.stdout.write(`  probe choices: ${choiceText}\n`)
}

const adjustedValue = (row: HandRow) => -(row[4] ?? row[1])
for (const [index, first] of focals.entries()) {
  for (const second of focals.slice(index + 1)) {
    for (const [label, value] of [
      ['', undefined],
      [', all-in adjusted', adjustedValue],
    ] as const) {
      const a = probeRows(first, () => true, value)
      const b = new Map(
        probeRows(second, () => true, value).rows.map((row) => [row.key, row.value]),
      )
      const paired = a.rows
        .filter((row) => b.has(row.key))
        .map((row) => ({ session: row.session, value: row.value - (b.get(row.key) as number) }))
      process.stdout.write(
        `${first} minus ${second}, same deals${label}: ${describe(paired, a.clusters)}\n`,
      )
    }
  }
}

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { clusteredEstimate } from './bot-session-evaluation.js'

// Usage: tsx bot-compare-pool.ts <directory> <file prefix> [table lower bound, default -2]
const [directory, prefix, boundText] = process.argv.slice(2)
if (!directory || !prefix) throw new Error('usage: <directory> <file prefix> [lower bound]')
const tableBound = boundText === undefined ? -2 : Number(boundText)
const files = readdirSync(directory).filter(
  (name) => name.startsWith(prefix) && name.endsWith('.json'),
)
interface TableResult {
  readonly table: string
  readonly first?: number
  readonly sessions: number
  readonly perSession: [number, number][]
  readonly estimate: { bigBlindsPer100: number; interval95: [number, number] }
}
/** Rows that give the clustered estimator each session's own sum and hand count. */
function rowsOf(perSession: readonly [number, number][], offset: number) {
  const rows: { session: number; value: number }[] = []
  perSession.forEach(([sum, count], session) => {
    for (let hand = 0; hand < count; hand += 1) {
      rows.push({ session: offset + session, value: sum / count })
    }
  })
  return rows
}
// Pieces of one table, run as separate processes, are joined in session order first.
const pieces = new Map<string, TableResult[]>()
for (const name of files) {
  const result = JSON.parse(readFileSync(join(directory, name), 'utf8')) as TableResult
  pieces.set(result.table, [...(pieces.get(result.table) ?? []), result])
}
const tables = [...pieces.entries()].map(([table, parts]) => {
  const ordered = [...parts].sort((a, b) => (a.first ?? 0) - (b.first ?? 0))
  let next = ordered[0]?.first ?? 0
  for (const part of ordered) {
    if ((part.first ?? 0) !== next) throw new Error(`${table}: pieces overlap or leave a gap`)
    next += part.sessions
  }
  if (ordered.length === 1) return ordered[0] as TableResult
  const perSession = ordered.flatMap((part) => part.perSession)
  return {
    table,
    sessions: perSession.length,
    perSession,
    estimate: clusteredEstimate(rowsOf(perSession, 0), perSession.length),
  }
})
const rows: { session: number; value: number }[] = []
let clusters = 0
for (const table of tables) {
  rows.push(...rowsOf(table.perSession, clusters))
  clusters += table.sessions
}
const pooled = clusteredEstimate(rows, clusters)
const round = (value: number) => Math.round(value * 10) / 10
for (const table of tables) {
  const [low, high] = table.estimate.interval95
  const flag = high < 0 ? 'CLEAR LOSS' : low < tableBound ? 'wide' : 'ok'
  process.stdout.write(
    `${table.table.padEnd(42)} ${round(table.estimate.bigBlindsPer100)} (${round(low)} to ${round(high)}) ${flag}\n`,
  )
}
process.stdout.write(
  `pooled ${round(pooled.bigBlindsPer100)} (${round(pooled.interval95[0])} to ${round(pooled.interval95[1])}) over ${tables.length} tables; pooled gate ${pooled.interval95[0] > 0 ? 'PASS' : 'FAIL'}; clear losses ${tables.filter((t) => t.estimate.interval95[1] < 0).length}; wide ${
    tables
      .filter((t) => t.estimate.interval95[0] < tableBound && t.estimate.interval95[1] >= 0)
      .map((t) => t.table)
      .join(', ') || 'none'
  }\n`,
)

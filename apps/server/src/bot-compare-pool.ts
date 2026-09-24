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
const rows: { session: number; value: number }[] = []
let clusters = 0
const tables = files.map((name) => {
  const result = JSON.parse(readFileSync(join(directory, name), 'utf8')) as {
    table: string
    sessions: number
    perSession: [number, number][]
    estimate: { bigBlindsPer100: number; interval95: [number, number] }
  }
  result.perSession.forEach(([sum, count], session) => {
    if (count === 0) return
    rows.push({ session: clusters + session, value: sum / count })
    for (let extra = 1; extra < count; extra += 1) {
      rows.push({ session: clusters + session, value: sum / count })
    }
  })
  clusters += result.sessions
  return result
})
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

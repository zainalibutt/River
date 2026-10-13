import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { clusteredEstimate } from './bot-session-evaluation.js'

// Usage: tsx bot-head-to-head-pool.ts <directory> <file prefix>
// Joins bot-head-to-head.ts pieces into one duplicate estimate for A against B, clustering by
// session across every piece; pieces must be the same pair and must not repeat a session.
const [directory, filePrefix] = process.argv.slice(2)
if (!directory || !filePrefix) throw new Error('usage: <directory> <file prefix>')

interface Piece {
  readonly a: string
  readonly b: string
  readonly scores: readonly { readonly session: number; readonly value: number }[]
}

const pieces = readdirSync(directory)
  .filter((file) => file.startsWith(filePrefix) && file.endsWith('.json'))
  .map((file) => JSON.parse(readFileSync(join(directory, file), 'utf8')) as Piece)
if (pieces.length === 0) throw new Error(`no ${filePrefix}*.json pieces in ${directory}`)
const [{ a, b }] = pieces as [Piece, ...Piece[]]
if (pieces.some((piece) => piece.a !== a || piece.b !== b)) {
  throw new Error('the pieces are not all the same pair')
}
const rows = pieces.flatMap((piece) => piece.scores)
const sessions = [...new Set(rows.map((row) => row.session))].sort((x, y) => x - y)
const index = new Map(sessions.map((session, at) => [session, at]))
const estimate = clusteredEstimate(
  rows.map((row) => ({ session: index.get(row.session) as number, value: row.value })),
  sessions.length,
)
process.stdout.write(
  `${a} vs ${b}: ${estimate.bigBlindsPer100.toFixed(1)} bb/100 (${estimate.interval95.map((v) => v.toFixed(1)).join(' to ')}), ${rows.length} hand pairs over ${sessions.length} sessions in ${pieces.length} pieces\n`,
)

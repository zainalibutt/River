import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { benchmarkProvenance } from './bot-benchmark-provenance.js'
import { clusteredEstimate } from './bot-session-evaluation.js'

// Usage: tsx bot-head-to-head-pool.ts <directory> <file prefix>
// Joins bot-head-to-head.ts pieces into one duplicate estimate for A against B, clustering by
// session across every piece; pieces must be the same pair and must not repeat a session.
// Reports the all-in valued estimate and, where pieces carry them, the same with the cards'
// luck taken out (bot-chance-luck.ts).
const [directory, filePrefix] = process.argv.slice(2)
if (!directory || !filePrefix) throw new Error('usage: <directory> <file prefix>')

interface Piece {
  readonly a: string
  readonly b: string
  readonly prefix: string
  readonly scores: readonly {
    readonly session: number
    readonly value: number
    readonly corrected?: number
    readonly raw?: number
    readonly aivat?: number
  }[]
}

const pieces = readdirSync(directory)
  .filter(
    (file) =>
      file.startsWith(filePrefix) && file.endsWith('.json') && !file.endsWith('.provenance.json'),
  )
  .map((file) => JSON.parse(readFileSync(join(directory, file), 'utf8')) as Piece)
if (pieces.length === 0) throw new Error(`no ${filePrefix}*.json pieces in ${directory}`)
const [{ a, b }] = pieces as [Piece, ...Piece[]]
if (pieces.some((piece) => piece.a !== a || piece.b !== b)) {
  throw new Error('the pieces are not all the same pair')
}
const occupied = new Set<string>()
const rows = pieces.flatMap((piece) => {
  for (const session of new Set(piece.scores.map((row) => row.session))) {
    const key = `${piece.prefix}:${session}`
    if (occupied.has(key)) throw new Error('duplicate pieces overlap sessions')
    occupied.add(key)
  }
  return piece.scores.map((row) => ({ ...row, key: `${piece.prefix}:${row.session}` }))
})
const sessions = [...new Set(rows.map((row) => row.key))].sort()
const index = new Map(sessions.map((session, at) => [session, at]))
const pooled = (value: (row: (typeof rows)[number]) => number) =>
  clusteredEstimate(
    rows.map((row) => ({ session: index.get(row.key) as number, value: value(row) })),
    sessions.length,
  )
const estimate = pooled((row) => row.value)
const corrected = pooled((row) => row.corrected ?? row.value)
const line = (name: string, e: typeof estimate) =>
  `${name}: ${e.bigBlindsPer100.toFixed(1)} bb/100 (${e.interval95.map((v) => v.toFixed(1)).join(' to ')})`
const correctedCount = rows.filter((row) => row.corrected !== undefined).length
process.stdout.write(
  `${a} vs ${b}, ${rows.length} hand pairs over ${sessions.length} sessions in ${pieces.length} pieces\n  ${line('all-in valued', estimate)}\n  ${line("cards' luck out", corrected)} (${correctedCount} hand pairs corrected)\n`,
)
process.stdout.write(
  rows.every((row) => row.raw !== undefined)
    ? `${line(
        'raw',
        pooled((row) => row.raw as number),
      )}\n`
    : 'raw: unavailable in historical pieces\n',
)
process.stdout.write(
  rows.every((row) => row.aivat !== undefined)
    ? `${line(
        'AIVAT',
        pooled((row) => row.aivat as number),
      )}\n`
    : 'AIVAT: unavailable in historical pieces\n',
)
process.stdout.write(
  `${JSON.stringify({
    provenance: benchmarkProvenance('duplicate-pool', {
      policies: [a, b],
      seeds: [...new Set(pieces.map((piece) => piece.prefix))],
      plannedHands: rows.length,
    }),
    hands: rows.length,
    failures: 0,
  })}\n`,
)

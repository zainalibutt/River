import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_STAKE } from '@river/engine'

// Usage: tsx bot-compare-check.ts <directory> <file prefix> <mark> [raw|adjusted]
// An interim look at a table comparison still running. Every finished piece counts, wherever
// it falls in its table. The run should stop when the tables pooled sit more than <mark>
// standard errors below zero; with looks after a third and two thirds of the pieces, the
// O'Brien-Fleming marks 3.47 and 2.45 keep the chance of stopping a candidate that is truly
// level under one in a hundred. Each table is printed for information only; the
// declared per-table rule is judged on the full run. Prints STOP or CONTINUE and exits 3 on
// STOP, so a run script can act on it.
const [directory, prefix, markText, valueText = 'raw'] = process.argv.slice(2)
const mark = Number(markText)
if (!directory || !prefix || !(mark > 0) || (valueText !== 'raw' && valueText !== 'adjusted')) {
  throw new Error('usage: <directory> <file prefix> <mark> [raw|adjusted]')
}
interface Piece {
  readonly table: string
  readonly perSession: [number, number][]
  readonly perSessionAdjusted?: [number, number][]
}
const tables = new Map<string, [number, number][]>()
let pieces = 0
for (const name of readdirSync(directory).filter(
  (file) => file.startsWith(prefix) && file.endsWith('.json'),
)) {
  const piece = JSON.parse(readFileSync(join(directory, name), 'utf8')) as Piece
  const sessions = valueText === 'adjusted' ? piece.perSessionAdjusted : piece.perSession
  if (sessions === undefined) throw new Error(`${name} reports no all-in valued differences`)
  tables.set(piece.table, [...(tables.get(piece.table) ?? []), ...sessions])
  pieces += 1
}
/**
 * The mean in big blinds per 100 hands and its standard error, clustered by session: the same
 * quantities `clusteredEstimate` builds its interval from.
 */
function meanAndError(sessions: readonly [number, number][]) {
  const hands = sessions.reduce((sum, [, count]) => sum + count, 0)
  const total = sessions.reduce((sum, [chips]) => sum + chips, 0)
  const mean = total / hands
  const residual = sessions.reduce((sum, [chips, count]) => sum + (chips - mean * count) ** 2, 0)
  const error = Math.sqrt((sessions.length / (sessions.length - 1)) * residual) / hands
  const scale = 100 / DEFAULT_STAKE.bigBlind
  return { mean: mean * scale, error: error * scale, sessions: sessions.length }
}
const round = (value: number) => Math.round(value * 10) / 10
let stop = false
const rows: [string, [number, number][]][] = [
  ...[...tables.entries()].sort(([a], [b]) => a.localeCompare(b)),
  ['pooled', [...tables.values()].flat()],
]
for (const [label, sessions] of rows) {
  if (sessions.length < 2) continue
  const { mean, error, sessions: count } = meanAndError(sessions)
  const below = mean + mark * error < 0
  if (label === 'pooled') stop = below
  process.stdout.write(
    `${label.padEnd(26)} ${round(mean)} (95%: ${round(mean - 1.96 * error)} to ${round(mean + 1.96 * error)}), ${round(mean / error)} standard errors, ${count} sessions${below ? ' BELOW THE MARK' : ''}\n`,
  )
}
process.stdout.write(`${stop ? 'STOP' : 'CONTINUE'} after ${pieces} pieces, mark ${mark}\n`)
process.exitCode = stop ? 3 : 0

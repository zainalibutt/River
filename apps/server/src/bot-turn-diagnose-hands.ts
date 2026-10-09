import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Usage: tsx bot-turn-diagnose-hands.ts <directory> <file prefix> <table> [count] [worst|best]
// Prints the hands of bot-turn-diagnose.ts pieces where the candidate did worst (or best)
// against v8z, all-in valued, as both policies played them: the OG's cards, the board, and
// each line with N for the OG and O for the opponent, amounts in big blinds.
const [directory, filePrefix, tableName, countText = '10', order = 'worst'] = process.argv.slice(2)
if (!directory || !filePrefix || !tableName) {
  throw new Error('usage: <directory> <file prefix> <table> [count] [worst|best]')
}

interface Seen {
  readonly seat: number
  readonly hole: string
  readonly board: string
  readonly actions: readonly {
    readonly seat: number
    readonly street: string
    readonly action: { readonly kind: string; readonly to?: number }
  }[]
  readonly final: string
}
interface Side {
  readonly session: number
  readonly hand: number
  readonly adjusted: number
  readonly seen?: Seen
}
interface Piece {
  readonly table: string
  readonly candidate?: string
  readonly bigBlind: number
  readonly hands: readonly { readonly v8z: Side; readonly v9a?: Side; readonly candidate?: Side }[]
}

const pieces = readdirSync(directory)
  .filter((file) => file.startsWith(filePrefix) && file.endsWith('.json'))
  .map((file) => JSON.parse(readFileSync(join(directory, file), 'utf8')) as Piece)
  .filter((piece) => piece.table === tableName)
const name = pieces[0]?.candidate ?? 'v9a'
const bigBlind = pieces[0]?.bigBlind ?? 1
const hands = pieces.flatMap((piece) =>
  piece.hands.map((hand) => ({ v8z: hand.v8z, next: (hand.candidate ?? hand.v9a) as Side })),
)
const bb = (chips: number) => (chips / bigBlind).toFixed(1)

function line(seen: Seen | undefined): string {
  if (seen === undefined) return '(did not act)'
  const streets: string[] = []
  let street = ''
  let parts: string[] = []
  for (const entry of seen.actions) {
    if (entry.street !== street) {
      if (parts.length > 0) streets.push(`${street}: ${parts.join(', ')}`)
      street = entry.street
      parts = []
    }
    const who = entry.seat === seen.seat ? 'N' : 'O'
    const { kind, to } = entry.action
    parts.push(`${who} ${kind === 'raiseTo' ? `to ${bb(to ?? 0)}` : kind}`)
  }
  if (parts.length > 0) streets.push(`${street}: ${parts.join(', ')}`)
  return `${streets.join(' | ')} || N then ${seen.final}`
}

const sorted = [...hands].sort((a, b) =>
  order === 'best'
    ? b.next.adjusted - b.v8z.adjusted - (a.next.adjusted - a.v8z.adjusted)
    : a.next.adjusted - a.v8z.adjusted - (b.next.adjusted - b.v8z.adjusted),
)
for (const { v8z, next } of sorted.slice(0, Number(countText))) {
  const seen = next.seen ?? v8z.seen
  const board = [v8z.seen?.board ?? '', next.seen?.board ?? ''].sort(
    (a, b) => b.length - a.length,
  )[0]
  process.stdout.write(
    `session ${v8z.session} hand ${v8z.hand}: OG ${seen?.hole ?? '?'}, board ${board}; ${name} ${bb(next.adjusted)} bb, v8z ${bb(v8z.adjusted)} bb\n` +
      `  v8z:  ${line(v8z.seen)}\n  ${name}: ${line(next.seen)}\n`,
  )
}

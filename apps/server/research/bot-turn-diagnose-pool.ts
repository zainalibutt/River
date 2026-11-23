import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Usage: tsx bot-turn-diagnose-pool.ts <directory> <file prefix>
// Joins bot-turn-diagnose.ts pieces per table and shows where the candidate's chips differ from
// v8z's (the candidate is shown under v9a's name in the move counts):
// by whether the turn solver acted, by the street the hand ended on, by the pair of first
// two-player turn moves, and how often each policy makes each turn move. Every share is in
// big blinds per 100 of all the table's hands, all-in valued, so the parts add to the whole.
const [directory, filePrefix] = process.argv.slice(2)
if (!directory || !filePrefix) throw new Error('usage: <directory> <file prefix>')

interface Side {
  readonly chips: number
  readonly adjusted: number
  readonly turn: readonly string[]
  readonly last: string
}
interface Piece {
  readonly table: string
  readonly bigBlind: number
  readonly fallbacks: Record<string, number>
  readonly candidate?: string
  readonly hands: readonly { readonly v8z: Side; readonly v9a?: Side; readonly candidate?: Side }[]
}

const byTable = new Map<string, Piece[]>()
for (const name of readdirSync(directory).filter(
  (file) => file.startsWith(filePrefix) && file.endsWith('.json'),
)) {
  const piece = JSON.parse(readFileSync(join(directory, name), 'utf8')) as Piece
  byTable.set(piece.table, [...(byTable.get(piece.table) ?? []), piece])
}

const plain = (move: string) => move.replace('*', '')
function report(table: string, pieces: readonly Piece[]) {
  const hands = pieces.flatMap((piece) =>
    piece.hands.map((hand) => ({ v8z: hand.v8z, v9a: (hand.candidate ?? hand.v9a) as Side })),
  )
  const name = pieces[0]?.candidate ?? 'v9a'
  const bigBlind = pieces[0]?.bigBlind ?? 1
  const share = (sum: number) => ((sum / bigBlind / hands.length) * 100).toFixed(1)
  const groups = new Map<string, { count: number; sum: number }>()
  const add = (key: string, delta: number) => {
    const entry = groups.get(key) ?? { count: 0, sum: 0 }
    entry.count += 1
    entry.sum += delta
    groups.set(key, entry)
  }
  const moves = { v8z: new Map<string, number>(), v9a: new Map<string, number>() }
  let total = 0
  for (const { v8z, v9a } of hands) {
    const delta = v9a.adjusted - v8z.adjusted
    total += delta
    const solved = v9a.turn.some((entry) => entry.endsWith('*'))
    add(`solver ${solved ? 'acted' : 'did not act'}`, delta)
    add(`v9a ended on ${v9a.last}`, delta)
    if (v8z.turn.length > 0 && v9a.turn.length > 0) {
      add(
        `first turn move ${plain(v8z.turn[0] as string)} -> ${plain(v9a.turn[0] as string)}`,
        delta,
      )
    } else if (v8z.turn.length + v9a.turn.length > 0) {
      add('first turn move: only one policy reached a two-player turn', delta)
    }
    for (const [side, tags] of [
      ['v8z', v8z.turn],
      ['v9a', v9a.turn],
    ] as const) {
      for (const entry of tags) {
        const key = plain(entry)
        moves[side].set(key, (moves[side].get(key) ?? 0) + 1)
      }
    }
  }
  const fallbacks: Record<string, number> = {}
  for (const piece of pieces) {
    for (const [reason, count] of Object.entries(piece.fallbacks)) {
      fallbacks[reason] = (fallbacks[reason] ?? 0) + count
    }
  }
  const lines = [
    `${table}: ${hands.length} hands, ${name} minus v8z ${share(total)} bb/100 all-in valued; fallbacks ${JSON.stringify(fallbacks)}`,
  ]
  const sorted = [...groups.entries()].sort((a, b) => a[1].sum - b[1].sum)
  for (const [key, { count, sum }] of sorted) {
    if (!key.startsWith('first turn move ') || count >= 20) {
      lines.push(`  ${key.padEnd(52)} ${String(count).padStart(5)} hands ${share(sum).padStart(7)}`)
    }
  }
  for (const facing of ['O', 'F']) {
    lines.push(`  turn moves ${facing === 'O' ? 'unbet' : 'facing a bet'}:`)
    const keys = new Set(
      [...moves.v8z.keys(), ...moves.v9a.keys()].filter((key) => key.startsWith(`${facing}:`)),
    )
    for (const side of ['v8z', 'v9a'] as const) {
      const counts = [...keys].map((key) => [key.slice(2), moves[side].get(key) ?? 0] as const)
      const sum = counts.reduce((acc, [, count]) => acc + count, 0)
      lines.push(
        `    ${side}: ${counts
          .filter(([, count]) => count > 0)
          .sort((a, b) => b[1] - a[1])
          .map(([key, count]) => `${key} ${((count / Math.max(1, sum)) * 100).toFixed(0)}%`)
          .join(', ')} (${sum})`,
      )
    }
  }
  return lines.join('\n')
}

for (const [table, pieces] of [...byTable.entries()].sort()) {
  process.stdout.write(`${report(table, pieces)}\n`)
}

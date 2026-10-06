export interface DialRange {
  id: string
  label: string
  amount: number
  legal: boolean
}

export interface DialInput {
  pot: number
  toCall: number
  minRaiseTo: number
  maxRaiseTo: number
  stack: number
}

const POT_MULTIPLIERS: readonly { multiplier: number; label: string }[] = [
  { multiplier: 0.5, label: '1/2 POT' },
  { multiplier: 0.75, label: '3/4 POT' },
  { multiplier: 1, label: 'POT' },
  { multiplier: 1.5, label: '1.5 POT' },
  { multiplier: 2, label: '2 POT' },
  { multiplier: 3, label: '3 POT' },
]

interface Candidate {
  id: string
  label: string
  amount: number
  rank: number
}

export function dialRanges(input: DialInput): readonly DialRange[] {
  const potAfterCall = input.pot + input.toCall
  const candidates: Candidate[] = [
    { id: 'min', label: 'MIN', amount: Math.round(input.minRaiseTo), rank: 1 },
    ...POT_MULTIPLIERS.map((m) => ({
      id: `fraction:${m.label}`,
      label: m.label,
      amount: Math.round(input.toCall + m.multiplier * potAfterCall),
      rank: 0,
    })),
    { id: 'allin', label: 'ALL IN', amount: Math.round(input.maxRaiseTo), rank: 2 },
  ]
  candidates.sort((a, b) => a.amount - b.amount)
  const byAmount = new Map<number, Candidate>()
  for (const candidate of candidates) {
    const current = byAmount.get(candidate.amount)
    if (current === undefined || candidate.rank > current.rank) {
      byAmount.set(candidate.amount, candidate)
    }
  }
  const unique = [...byAmount.values()].sort((a, b) => a.amount - b.amount)
  return unique.map((candidate) => ({
    id: candidate.id,
    label: candidate.label,
    amount: candidate.amount,
    legal: candidate.amount >= input.minRaiseTo && candidate.amount <= input.maxRaiseTo,
  }))
}

export function nearestRange(ranges: readonly DialRange[], amount: number): DialRange | null {
  let best: DialRange | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const range of ranges) {
    const distance = Math.abs(range.amount - amount)
    if (best === null || distance < bestDistance) {
      best = range
      bestDistance = distance
    }
  }
  return best
}

export function stepRange(
  ranges: readonly DialRange[],
  fromId: string,
  direction: 1 | -1,
): DialRange {
  if (ranges.length === 0) {
    throw new Error('cannot step an empty dial')
  }
  const index = ranges.findIndex((range) => range.id === fromId)
  const base = index === -1 ? 0 : index
  const target = Math.max(0, Math.min(ranges.length - 1, base + direction))
  for (const range of ranges) {
    if (ranges.indexOf(range) === target) return range
  }
  throw new Error('unreachable')
}

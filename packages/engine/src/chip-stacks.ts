export interface Denomination {
  value: number
  label: string
  colour: string
}

export interface ChipStack {
  denomination: Denomination
  count: number
}

const DENOMINATIONS: readonly Denomination[] = [
  { value: 1, label: '1', colour: 'f8f8f8' },
  { value: 5, label: '5', colour: 'c62828' },
  { value: 25, label: '25', colour: '2e7d32' },
  { value: 100, label: '100', colour: '263238' },
  { value: 500, label: '500', colour: '7b1fa2' },
  { value: 1000, label: '1K', colour: '1565c0' },
  { value: 5000, label: '5K', colour: 'ef6c00' },
  { value: 25000, label: '25K', colour: '9e9e9e' },
  { value: 100000, label: '100K', colour: 'c9a227' },
]

const DEFAULT_MAX_STACK = 40

export function denominations(): readonly Denomination[] {
  return DENOMINATIONS
}

export function breakStack(
  amount: number,
  maxPerStack: number = DEFAULT_MAX_STACK,
): readonly ChipStack[] {
  if (amount <= 0) return []
  const cap = Math.max(1, Math.floor(maxPerStack))
  const stacks: ChipStack[] = []
  let remaining = amount
  for (let i = DENOMINATIONS.length - 1; i >= 0; i -= 1) {
    const denomination = DENOMINATIONS[i] as Denomination
    if (remaining <= 0) break
    const totalChips = Math.floor(remaining / denomination.value)
    if (totalChips === 0) continue
    let chipsLeft = totalChips
    while (chipsLeft > 0) {
      const pushed = Math.min(cap, chipsLeft)
      stacks.push({ denomination, count: pushed })
      chipsLeft -= pushed
    }
    remaining -= totalChips * denomination.value
  }
  return stacks
}

export function stackCount(stacks: readonly ChipStack[]): number {
  let total = 0
  for (const stack of stacks) {
    total += stack.count
  }
  return total
}

export function stackValue(stacks: readonly ChipStack[]): number {
  let total = 0
  for (const stack of stacks) {
    total += stack.denomination.value * stack.count
  }
  return total
}

export function readableStacks(amount: number, maxChips: number): readonly ChipStack[] {
  if (amount <= 0 || maxChips <= 0) return []
  const stacks: ChipStack[] = []
  let remaining = amount
  let chipsUsed = 0
  for (let i = DENOMINATIONS.length - 1; i >= 0; i -= 1) {
    if (chipsUsed >= maxChips) break
    const denomination = DENOMINATIONS[i] as Denomination
    const wanted = Math.floor(remaining / denomination.value)
    const budget = Math.floor(maxChips) - chipsUsed
    const taken = Math.min(wanted, budget)
    if (taken > 0) {
      stacks.push({ denomination, count: taken })
      chipsUsed += taken
      remaining -= taken * denomination.value
    }
  }
  return stacks
}

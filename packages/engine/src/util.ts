export function at<T>(items: readonly T[], index: number): T {
  const value = items[index]
  if (value === undefined) {
    throw new Error(`no element at index ${index} in array of length ${items.length}`)
  }
  return value
}

export function combinations<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = []
  const indexes: number[] = []
  const visit = (start: number): void => {
    if (indexes.length === size) {
      result.push(indexes.map((i) => at(items, i)))
      return
    }
    for (let i = start; i <= items.length - (size - indexes.length); i++) {
      indexes.push(i)
      visit(i + 1)
      indexes.pop()
    }
  }
  visit(0)
  return result
}

/** A seed and an index mixed into a well-spread 32-bit integer. */
export function hashMix(seed: number, index: number): number {
  let value = (((seed + index * 0x9e3779b9) ^ (seed >>> 16)) >>> 0) + 0x85ebca6b
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35)
  value = value ^ (value >>> 16)
  return value >>> 0
}

export function clamp01(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

/** A whole number of chips with its thousands grouped: 12,345. */
export function groupThousands(amount: number): string {
  const sign = amount < 0 ? '-' : ''
  const digits = String(Math.abs(Math.trunc(amount)))
  return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
}

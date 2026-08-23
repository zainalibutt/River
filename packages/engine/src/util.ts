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

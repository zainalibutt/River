import { breakStack } from './chip-stacks.js'

export interface StackColumn {
  denomination: number
  count: number
  offsetX: number
  offsetZ: number
}

export interface StackLayoutOptions {
  maxColumnHeight?: number
  spacing?: number
  chipDiameter?: number
}

const DEFAULT_MAX_COLUMN_HEIGHT = 20
const DEFAULT_SPACING = 0.042
export const DEFAULT_CHIP_DIAMETER = 0.039

export function stackLayout(amount: number, options?: StackLayoutOptions): StackColumn[] {
  if (!Number.isFinite(amount) || amount <= 0) return []
  const maxColumnHeight = Math.max(
    1,
    Math.floor(options?.maxColumnHeight ?? DEFAULT_MAX_COLUMN_HEIGHT),
  )
  const spacing = options?.spacing ?? DEFAULT_SPACING
  const diameter = options?.chipDiameter ?? DEFAULT_CHIP_DIAMETER
  const usableSpacing = Math.max(diameter, spacing)

  const breakdown = breakStack(amount, maxColumnHeight)
  const columns: StackColumn[] = []
  let order = 0
  for (const stack of breakdown) {
    columns.push({
      denomination: stack.denomination.value,
      count: stack.count,
      offsetX: order * usableSpacing,
      offsetZ: 0,
    })
    order += 1
  }
  return columns
}

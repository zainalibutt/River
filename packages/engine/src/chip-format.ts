export interface ChipFormatOptions {
  approximate?: boolean
  precision?: number
}

const FULL_THRESHOLD = 10_000

const SCALES: readonly { unit: number; suffix: string }[] = [
  { unit: 1e12, suffix: 'T' },
  { unit: 1e9, suffix: 'B' },
  { unit: 1e6, suffix: 'M' },
  { unit: 1e3, suffix: 'K' },
]

export function formatChips(amount: number, options?: ChipFormatOptions): string {
  if (!Number.isFinite(amount) || amount === 0) return '0'
  const sign = amount < 0 ? '-' : ''
  const magnitude = Math.floor(Math.abs(amount))

  if (magnitude < FULL_THRESHOLD) {
    return `${sign}${addSeparators(magnitude)}`
  }

  const approximate = options?.approximate === true
  const precision = options?.precision ?? 2

  const { unit, suffix } = scaleFor(magnitude, approximate)
  let value = magnitude / unit
  if (approximate) {
    value = Math.round(value * 10) / 10
    const rounded = trimTrailing(value.toFixed(1))
    return `${sign}~${rounded}${suffix}`
  }
  const fixed = trimTrailing(value.toFixed(precision))
  return `${sign}${fixed}${suffix}`
}

function scaleFor(magnitude: number, approximate: boolean): { unit: number; suffix: string } {
  for (let index = 0; index < SCALES.length; index += 1) {
    const scale = SCALES[index] as { unit: number; suffix: string }
    if (magnitude < scale.unit) continue
    if (approximate) {
      const value = magnitude / scale.unit
      const rounded = Math.round(value * 10) / 10
      const next = SCALES[index - 1]
      if (next !== undefined && rounded >= 1000) return next
    }
    return scale
  }
  return SCALES[SCALES.length - 1] ?? { unit: 1e3, suffix: 'K' }
}

function trimTrailing(value: string): string {
  if (value.includes('.')) {
    return value.replace(/\.?0+$/, '')
  }
  return value
}

function addSeparators(value: number): string {
  const digits = String(value)
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

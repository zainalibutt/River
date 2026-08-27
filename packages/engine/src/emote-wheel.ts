export interface WheelSelection {
  index: number | null
  reach: number
}

export interface WheelOptions {
  /** Dead zone radius as a fraction of the wheel. Default 0.25. */
  deadZoneRadius?: number
}

const TAU = Math.PI * 2

export function wheelSelection(
  x: number,
  y: number,
  count: number,
  options?: WheelOptions,
): WheelSelection {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(count)) {
    return { index: null, reach: 0 }
  }
  const deadZone = options?.deadZoneRadius ?? 0.25
  const reach = clamp01(Math.hypot(x, y))

  if (!Number.isInteger(count) || count <= 0) {
    return { index: null, reach }
  }
  if (count === 1) {
    return { index: reach >= deadZone ? 0 : null, reach }
  }
  if (reach < deadZone) {
    return { index: null, reach }
  }

  const step = TAU / count
  let angle = Math.atan2(x, -y)
  if (angle < 0) angle += TAU
  const bucket = Math.floor(angle / step)
  const raw = ((bucket % count) + count) % count
  return { index: raw, reach }
}

function clamp01(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

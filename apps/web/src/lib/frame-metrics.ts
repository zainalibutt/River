/**
 * What the player actually sees, as numbers.
 *
 * `venue-palette` asks whether the biggest surface in a venue is also the
 * brightest, and answers it from base colours in the asset. That is worth
 * knowing and it is not the same question, because a base colour becomes a
 * pixel only after a lighting rig, a tone curve and a camera have had their
 * turn. Two separate wrong answers this project has produced - reading glTF's
 * linear base colours as sRGB, and comparing rect-area nits against spot
 * candela - were both inferences about a frame nobody had measured.
 *
 * This measures the frame. The maths lives here, away from any renderer, so it
 * can be tested against pixels rather than against a running browser.
 */

export interface Region {
  name: string
  /** Fractions of the frame, 0 to 1, from the top left. */
  x: number
  y: number
  width: number
  height: number
}

export interface RegionLuminance {
  name: string
  mean: number
  peak: number
  /** Share of the frame's total light this region emits, 0 to 1. */
  lightShare: number
  /** Share of the frame's area this region covers, 0 to 1. */
  areaShare: number
}

export interface FrameMetrics {
  mean: number
  median: number
  /** The luminance below which 95 percent of pixels sit. */
  p95: number
  /** Share of pixels within 2 percent of pure black. */
  crushed: number
  /** Share of pixels within 2 percent of pure white. */
  blown: number
  regions: RegionLuminance[]
  /** The region emitting the most light, which is where the eye goes. */
  brightest: string | null
}

function toLinear(channel: number): number {
  const v = channel / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

/**
 * Relative luminance of one pixel, from sRGB bytes.
 *
 * Same coefficients as `venue-palette.relativeLuminance`, deliberately: a
 * number from this module and a number from that one have to be comparable or
 * there is no way to ask whether the room the art authored is the room that
 * reached the screen.
 */
export function pixelLuminance(r: number, g: number, b: number): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
}

function clampIndex(value: number, limit: number): number {
  if (value < 0) return 0
  return value > limit ? limit : value
}

/**
 * Luminance statistics for a frame and the named parts of it.
 *
 * `pixels` is RGBA bytes, row-major from the top left, as `getImageData` gives
 * them. Regions may overlap and need not cover the frame.
 */
export function frameMetrics(
  pixels: Uint8ClampedArray | readonly number[],
  width: number,
  height: number,
  regions: readonly Region[] = [],
): FrameMetrics {
  const count = width * height
  if (count <= 0 || pixels.length < count * 4) {
    return { mean: 0, median: 0, p95: 0, crushed: 0, blown: 0, regions: [], brightest: null }
  }
  const luminance = new Float64Array(count)
  let total = 0
  let crushed = 0
  let blown = 0
  for (let i = 0; i < count; i += 1) {
    const at = i * 4
    const value = pixelLuminance(pixels[at] ?? 0, pixels[at + 1] ?? 0, pixels[at + 2] ?? 0)
    luminance[i] = value
    total += value
    if (value <= 0.02) crushed += 1
    if (value >= 0.98) blown += 1
  }
  const sorted = Float64Array.from(luminance).sort()
  const at = (fraction: number): number =>
    sorted[clampIndex(Math.floor(fraction * (count - 1)), count - 1)] ?? 0

  const measured: RegionLuminance[] = []
  for (const region of regions) {
    const x0 = clampIndex(Math.floor(region.x * width), width - 1)
    const y0 = clampIndex(Math.floor(region.y * height), height - 1)
    const x1 = clampIndex(Math.ceil((region.x + region.width) * width), width)
    const y1 = clampIndex(Math.ceil((region.y + region.height) * height), height)
    let sum = 0
    let peak = 0
    let pixelsSeen = 0
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const value = luminance[y * width + x] ?? 0
        sum += value
        if (value > peak) peak = value
        pixelsSeen += 1
      }
    }
    measured.push({
      name: region.name,
      mean: pixelsSeen === 0 ? 0 : sum / pixelsSeen,
      peak,
      lightShare: total === 0 ? 0 : sum / total,
      areaShare: pixelsSeen / count,
    })
  }

  let brightest: string | null = null
  let best = -1
  for (const region of measured) {
    if (region.lightShare > best) {
      best = region.lightShare
      brightest = region.name
    }
  }

  return {
    mean: total / count,
    median: at(0.5),
    p95: at(0.95),
    crushed: crushed / count,
    blown: blown / count,
    regions: measured,
    brightest,
  }
}

/**
 * Where the parts of a poker table land on screen, as fractions of the frame.
 *
 * Deliberately coarse. The question these answer is "does the eye go to the
 * felt or to the floor", and that does not need pixel accuracy - it needs the
 * same bands measured the same way every time so two builds can be compared.
 */
export const TABLE_REGIONS: readonly Region[] = [
  { name: 'table', x: 0.3, y: 0.38, width: 0.4, height: 0.28 },
  { name: 'seats', x: 0.16, y: 0.28, width: 0.68, height: 0.46 },
  { name: 'floor-near', x: 0.0, y: 0.74, width: 1.0, height: 0.26 },
  { name: 'floor-far', x: 0.0, y: 0.12, width: 1.0, height: 0.16 },
  { name: 'backdrop', x: 0.0, y: 0.0, width: 1.0, height: 0.12 },
]

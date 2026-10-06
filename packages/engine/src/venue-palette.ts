export interface Rgb {
  r: number
  g: number
  b: number
}

export interface Surface {
  colour: Rgb
  area: number
}

export function parseHex(hex: string): Rgb | null {
  const match = hex.match(/^#?([0-9a-fA-F]{6})$/)
  if (match === null) return null
  const value = match[1] as string
  return {
    r: parseInt(value.slice(0, 2), 16) / 255,
    g: parseInt(value.slice(2, 4), 16) / 255,
    b: parseInt(value.slice(4, 6), 16) / 255,
  }
}

function linearise(channel: number): number {
  const value = channel / 1
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance(colour: Rgb): number {
  return 0.2126 * linearise(colour.r) + 0.7152 * linearise(colour.g) + 0.0722 * linearise(colour.b)
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const aL = relativeLuminance(a)
  const bL = relativeLuminance(b)
  const lighter = Math.max(aL, bL)
  const darker = Math.min(aL, bL)
  return (lighter + 0.05) / (darker + 0.05)
}

export function valueSpread(colours: readonly Rgb[]): number {
  if (colours.length === 0) return 0
  let highest = 0
  let lowest = Number.POSITIVE_INFINITY
  for (const colour of colours) {
    const luminance = relativeLuminance(colour)
    if (luminance > highest) highest = luminance
    if (luminance < lowest) lowest = luminance
  }
  return highest - lowest
}

export function dominantIsBrightest(surfaces: readonly Surface[]): boolean {
  if (surfaces.length === 0) return false
  let largest: Surface | null = null
  for (const surface of surfaces) {
    if (largest === null || surface.area > largest.area) {
      largest = surface
    }
  }
  if (largest === null) return false
  for (const surface of surfaces) {
    if (relativeLuminance(surface.colour) > relativeLuminance(largest.colour)) {
      return false
    }
  }
  return true
}

export function checkPalette(surfaces: readonly Surface[]): string[] {
  const problems: string[] = []
  const colours = surfaces.map((surface) => surface.colour)

  if (valueSpread(colours) < 0.35) {
    problems.push('the value spread is too narrow under 0.35, so the room reads flat')
  }

  if (dominantIsBrightest(surfaces)) {
    const biggest = nameSurface(surfaces, largestSurface(surfaces))
    problems.push(`${biggest} is the biggest surface and the brightest, so it pulls the eye`)
  }

  const big = surfaces.filter((surface) => surface.area > 12)
  for (let i = 0; i < big.length; i += 1) {
    for (let j = i + 1; j < big.length; j += 1) {
      const a = big[i] as Surface
      const b = big[j] as Surface
      if (contrastRatio(a.colour, b.colour) < 1.4) {
        problems.push(
          `${nameSurface(surfaces, a)} and ${nameSurface(surfaces, b)} both exceed 12 percent area with contrast under 1.4, so they read as one shape`,
        )
      }
    }
  }
  return problems
}

function largestSurface(surfaces: readonly Surface[]): Surface | null {
  let largest: Surface | null = null
  for (const surface of surfaces) {
    if (largest === null || surface.area > largest.area) largest = surface
  }
  return largest
}

function nameSurface(surfaces: readonly Surface[], surface: Surface | null): string {
  if (surface === null) return 'a surface'
  const index = surfaces.indexOf(surface)
  return index === -1 ? 'a surface' : `surface ${index}`
}

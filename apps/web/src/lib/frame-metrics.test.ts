import { describe, expect, it } from 'vitest'
import { frameMetrics, pixelLuminance, type Region, TABLE_REGIONS } from './frame-metrics.js'

function solid(width: number, height: number, r: number, g: number, b: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i += 1) {
    pixels[i * 4] = r
    pixels[i * 4 + 1] = g
    pixels[i * 4 + 2] = b
    pixels[i * 4 + 3] = 255
  }
  return pixels
}

/** A frame that is black except for one bright band, given as fractions. */
function banded(width: number, height: number, band: Region, value: number): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4)
  const y0 = Math.floor(band.y * height)
  const y1 = Math.ceil((band.y + band.height) * height)
  const x0 = Math.floor(band.x * width)
  const x1 = Math.ceil((band.x + band.width) * width)
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const at = (y * width + x) * 4
      pixels[at] = value
      pixels[at + 1] = value
      pixels[at + 2] = value
      pixels[at + 3] = 255
    }
  }
  return pixels
}

describe('pixelLuminance', () => {
  it('puts black at zero and white at one', () => {
    expect(pixelLuminance(0, 0, 0)).toBe(0)
    expect(pixelLuminance(255, 255, 255)).toBeCloseTo(1, 6)
  })

  it('weights green above red above blue', () => {
    const red = pixelLuminance(255, 0, 0)
    const green = pixelLuminance(0, 255, 0)
    const blue = pixelLuminance(0, 0, 255)
    expect(green).toBeGreaterThan(red)
    expect(red).toBeGreaterThan(blue)
  })

  it('is not linear in the byte value, because sRGB is not', () => {
    // Mid grey is a little under a fifth of white, not half of it. A frame
    // metric that got this wrong would call an evenly lit room blown out.
    expect(pixelLuminance(128, 128, 128)).toBeLessThan(0.25)
    expect(pixelLuminance(128, 128, 128)).toBeGreaterThan(0.15)
  })
})

describe('frameMetrics', () => {
  it('reports a black frame as crushed and a white frame as blown', () => {
    const black = frameMetrics(solid(16, 16, 0, 0, 0), 16, 16)
    expect(black.mean).toBe(0)
    expect(black.crushed).toBe(1)
    expect(black.blown).toBe(0)

    const white = frameMetrics(solid(16, 16, 255, 255, 255), 16, 16)
    expect(white.mean).toBeCloseTo(1, 6)
    expect(white.blown).toBe(1)
    expect(white.crushed).toBe(0)
  })

  it('names the region emitting the most light, not the largest one', () => {
    // The floor band is more than twice the table's area and is left black;
    // the table is small and lit. A metric that ranked by area rather than by
    // emitted light would answer "floor-near" here, which is exactly the
    // mistake the palette gate makes by construction.
    const table = TABLE_REGIONS.find((region) => region.name === 'table') as Region
    const pixels = banded(64, 64, table, 220)
    const metrics = frameMetrics(pixels, 64, 64, TABLE_REGIONS)
    expect(metrics.brightest).toBe('table')

    const floor = metrics.regions.find((region) => region.name === 'floor-near')
    const measured = metrics.regions.find((region) => region.name === 'table')
    expect(floor?.areaShare ?? 0).toBeGreaterThan(measured?.areaShare ?? 1)
    expect(floor?.lightShare ?? 1).toBeLessThan(measured?.lightShare ?? 0)
  })

  it('catches the room this project actually shipped', () => {
    // A bright floor and a dim table is the Rooftop complaint stated as pixels.
    const floorBand = TABLE_REGIONS.find((region) => region.name === 'floor-near') as Region
    const pixels = banded(64, 64, floorBand, 200)
    const metrics = frameMetrics(pixels, 64, 64, TABLE_REGIONS)
    expect(metrics.brightest).toBe('floor-near')
  })

  it('survives a frame smaller than its regions and a malformed buffer', () => {
    expect(frameMetrics(new Uint8ClampedArray(4), 1, 1, TABLE_REGIONS).mean).toBe(0)
    expect(frameMetrics(new Uint8ClampedArray(0), 0, 0).brightest).toBeNull()
    // Fewer bytes than the dimensions claim: report nothing rather than read
    // past the end and invent light.
    expect(frameMetrics(new Uint8ClampedArray(8), 16, 16).mean).toBe(0)
  })

  it('orders percentiles and keeps the median inside the range', () => {
    const half = solid(32, 32, 128, 128, 128)
    const metrics = frameMetrics(half, 32, 32)
    expect(metrics.median).toBeCloseTo(metrics.mean, 6)
    expect(metrics.p95).toBeGreaterThanOrEqual(metrics.median)
  })
})

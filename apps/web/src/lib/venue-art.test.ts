import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { checkPalette, type Rgb, type Surface } from '@river/engine'
import { describe, expect, it } from 'vitest'
import { VENUE_ORDER, venueOf } from './venue.js'

/**
 * The room ends and the backdrop begins at twelve metres.
 *
 * Measured rather than chosen: on the Rooftop the furthest room surface is the
 * terrace at 4.0m and the nearest backdrop is the lit edge at 34.1m, with the
 * skyline at 37.2m and the mountains at 127.2m. Nothing sits between.
 *
 * The split has to exist because raw surface area is not what fills the frame.
 * The mountains are 83.9 percent of the Rooftop's triangles and a few hundred
 * pixels of sky; the terrace is 0.06 percent and most of what a player looks
 * at. Judging the palette on unweighted area would grade the backdrop and
 * ignore the room.
 */
const ROOM_RADIUS_METRES = 12

const COMPONENT_BYTES: Record<number, number> = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
}
const COMPONENT_COUNT: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }

interface Glb {
  gltf: {
    accessors?: {
      bufferView: number
      byteOffset?: number
      componentType: number
      count: number
      type: string
    }[]
    bufferViews?: { byteOffset?: number; byteStride?: number }[]
    materials?: { name?: string; pbrMetallicRoughness?: { baseColorFactor?: number[] } }[]
    meshes?: {
      primitives: {
        attributes?: Record<string, number>
        indices?: number
        material?: number
        mode?: number
      }[]
    }[]
    nodes?: { mesh?: number }[]
  }
  bin: Buffer
}

function readGlb(path: string): Glb {
  const raw = readFileSync(path)
  let offset = 12
  let gltf: Glb['gltf'] | null = null
  const chunks: Buffer[] = []
  while (offset < raw.length) {
    const length = raw.readUInt32LE(offset)
    const kind = raw.readUInt32LE(offset + 4)
    offset += 8
    const chunk = raw.subarray(offset, offset + length)
    offset += length
    if (kind === 0x4e4f534a) gltf = JSON.parse(chunk.toString('utf8'))
    else if (kind === 0x004e4942) chunks.push(chunk)
  }
  if (gltf === null) throw new Error(`${path} has no glTF JSON chunk`)
  return { gltf, bin: Buffer.concat(chunks) }
}

function readNumbers(glb: Glb, index: number): number[][] {
  const accessor = glb.gltf.accessors?.[index]
  const view = accessor === undefined ? undefined : glb.gltf.bufferViews?.[accessor.bufferView]
  if (accessor === undefined || view === undefined) return []
  const width = COMPONENT_COUNT[accessor.type] ?? 1
  const bytes = COMPONENT_BYTES[accessor.componentType] ?? 4
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  const stride = view.byteStride ?? width * bytes
  const rows: number[][] = []
  for (let i = 0; i < accessor.count; i += 1) {
    const at = base + i * stride
    const row: number[] = []
    for (let c = 0; c < width; c += 1) {
      const p = at + c * bytes
      if (accessor.componentType === 5126) row.push(glb.bin.readFloatLE(p))
      else if (accessor.componentType === 5125) row.push(glb.bin.readUInt32LE(p))
      else if (accessor.componentType === 5123) row.push(glb.bin.readUInt16LE(p))
      else if (accessor.componentType === 5121) row.push(glb.bin.readUInt8(p))
      else if (accessor.componentType === 5122) row.push(glb.bin.readInt16LE(p))
      else row.push(glb.bin.readInt8(p))
    }
    rows.push(row)
  }
  return rows
}

interface NamedSurface extends Surface {
  name: string
  radius: number
}

/**
 * Every material in a venue, weighted by the triangle area that carries it.
 *
 * Instancing counts: a chip mesh referenced by forty nodes covers forty times
 * the area of one chip, and the palette a player sees is the sum.
 */
function surfacesOf(path: string): NamedSurface[] {
  const glb = readGlb(path)
  const uses = new Map<number, number>()
  for (const node of glb.gltf.nodes ?? []) {
    if (node.mesh === undefined) continue
    uses.set(node.mesh, (uses.get(node.mesh) ?? 0) + 1)
  }
  const totals = new Map<number, { area: number; radiusWeighted: number }>()
  glb.gltf.meshes?.forEach((mesh, meshIndex) => {
    const instances = uses.get(meshIndex) ?? 1
    for (const primitive of mesh.primitives) {
      const positionIndex = primitive.attributes?.POSITION
      if (positionIndex === undefined) continue
      if (primitive.mode !== undefined && primitive.mode !== 4) continue
      const positions = readNumbers(glb, positionIndex)
      const indices =
        primitive.indices === undefined
          ? positions.map((_, i) => [i])
          : readNumbers(glb, primitive.indices)
      let area = 0
      for (let i = 0; i + 2 < indices.length; i += 3) {
        const a = positions[indices[i]?.[0] ?? -1]
        const b = positions[indices[i + 1]?.[0] ?? -1]
        const c = positions[indices[i + 2]?.[0] ?? -1]
        if (a === undefined || b === undefined || c === undefined) continue
        const ux = (b[0] ?? 0) - (a[0] ?? 0)
        const uy = (b[1] ?? 0) - (a[1] ?? 0)
        const uz = (b[2] ?? 0) - (a[2] ?? 0)
        const vx = (c[0] ?? 0) - (a[0] ?? 0)
        const vy = (c[1] ?? 0) - (a[1] ?? 0)
        const vz = (c[2] ?? 0) - (a[2] ?? 0)
        const cx = uy * vz - uz * vy
        const cy = uz * vx - ux * vz
        const cz = ux * vy - uy * vx
        area += Math.sqrt(cx * cx + cy * cy + cz * cz) / 2
      }
      let distance = 0
      for (const vertex of positions) {
        distance += Math.hypot(vertex[0] ?? 0, vertex[1] ?? 0, vertex[2] ?? 0)
      }
      const meanRadius = positions.length === 0 ? 0 : distance / positions.length
      const key = primitive.material ?? -1
      const held = totals.get(key) ?? { area: 0, radiusWeighted: 0 }
      totals.set(key, {
        area: held.area + area * instances,
        radiusWeighted: held.radiusWeighted + meanRadius * area * instances,
      })
    }
  })
  const surfaces: NamedSurface[] = []
  for (const [index, held] of totals) {
    const material = index === -1 ? undefined : glb.gltf.materials?.[index]
    const factor = material?.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1]
    surfaces.push({
      name: material?.name ?? 'default',
      colour: { r: factor[0] ?? 1, g: factor[1] ?? 1, b: factor[2] ?? 1 } satisfies Rgb,
      area: held.area,
      radius: held.radiusWeighted / Math.max(held.area, 1e-9),
    })
  }
  return surfaces
}

function roomSurfaces(path: string): NamedSurface[] {
  const room = surfacesOf(path).filter((surface) => surface.radius <= ROOM_RADIUS_METRES)
  const total = room.reduce((sum, surface) => sum + surface.area, 0)
  if (total <= 0) return []
  return room
    .map((surface) => ({ ...surface, area: (surface.area / total) * 100 }))
    .sort((left, right) => right.area - left.area)
}

/**
 * The venue file this judges, which is the one the application serves.
 *
 * `RIVER_ASSET_DIR` points it at a build instead. The pipeline needs that to
 * answer "is this venue publishable" before publishing it, rather than after -
 * and it is also how this gate was proven to both fail and pass, against the
 * same code, on two builds that differ only in their base colours.
 */
function assetPath(asset: string): string {
  const override = process.env.RIVER_ASSET_DIR
  const root = override ?? fileURLToPath(new URL('../../public', import.meta.url))
  const name = asset.slice(asset.lastIndexOf('/') + 1)
  return override === undefined
    ? `${root}${asset.startsWith('/') ? '' : '/'}${asset}`
    : `${root}/${name}`
}

describe('shipped venue palettes', () => {
  it('splits the room from the backdrop by a wide margin', () => {
    const surfaces = surfacesOf(assetPath(venueOf('rooftop').asset))
    const room = surfaces.filter((surface) => surface.radius <= ROOM_RADIUS_METRES)
    const backdrop = surfaces.filter((surface) => surface.radius > ROOM_RADIUS_METRES)
    expect(room.length).toBeGreaterThan(0)
    expect(backdrop.length).toBeGreaterThan(0)
    const furthestRoom = Math.max(...room.map((surface) => surface.radius))
    const nearestBackdrop = Math.min(...backdrop.map((surface) => surface.radius))
    // A threshold sitting inside a cluster would move the answer with any small
    // geometry change. This asserts the gap it sits in is real.
    expect(nearestBackdrop / furthestRoom).toBeGreaterThan(3)
  })

  for (const venueId of VENUE_ORDER) {
    const venue = venueOf(venueId)
    it(`${venue.name} reads as a room rather than a flat wash`, () => {
      const surfaces = roomSurfaces(assetPath(venue.asset))
      expect(surfaces.length).toBeGreaterThan(3)
      const problems = checkPalette(surfaces)
      const named = problems.map((problem) =>
        problem.replace(/surface (\d+)/g, (_, index: string) => {
          const surface = surfaces[Number(index)]
          return surface === undefined ? `surface ${index}` : surface.name
        }),
      )
      expect(named).toEqual([])
    })
  }
})

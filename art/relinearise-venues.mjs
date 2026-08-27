/**
 * Put the venues back into the colour space they were authored in.
 *
 * The pipeline wrote sRGB hex values straight into Blender's colour inputs and
 * glTF's baseColorFactor, both of which are linear. The sRGB transfer curve is
 * steep in the shadows, so this did not brighten evenly - it lifted dark values
 * by up to thirteen times and light ones by almost nothing, which pulled every
 * surface in a venue toward one middle grey. The Rooftop's felt was authored as
 * a near-black navy and shipped reading #384b60, darker than nothing else in
 * the room including the floor underneath it.
 *
 * `buildkit.hex_to_rgb` is fixed, so a rebuild produces correct assets. This
 * corrects the GLBs already published, because rebuilding needs Blender running
 * and the shipped files are what the game actually loads.
 *
 * Only baseColorFactor is touched. Emissive colours went through the same wrong
 * conversion but were then multiplied by a strength this file cannot recover,
 * so correcting them here would be guesswork; they are small, bright and few,
 * and the next rebuild fixes them properly.
 *
 * Usage: node art/relinearise-venues.mjs [--write]
 * Without --write it only reports, which is how it should be read first.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const TARGETS = [
  'apps/web/public/assets/rooftop_assets.glb',
  'apps/web/public/assets/basement_assets.glb',
  'apps/web/public/assets/suite_assets.glb',
]

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)
const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b
const hex = (f) =>
  `#${[0, 1, 2]
    .map((i) =>
      Math.round(255 * toSrgb(f[i]))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`

/** Split a GLB into its header, JSON chunk and everything after it. */
function readGlb(path) {
  const buffer = readFileSync(path)
  let offset = 12
  while (offset < buffer.length) {
    const length = buffer.readUInt32LE(offset)
    const type = buffer.readUInt32LE(offset + 4)
    if (type === 0x4e4f534a) {
      return {
        buffer,
        jsonStart: offset,
        jsonEnd: offset + 8 + length,
        json: JSON.parse(buffer.subarray(offset + 8, offset + 8 + length).toString('utf8')),
      }
    }
    offset += 8 + length
  }
  throw new Error(`${path} has no JSON chunk`)
}

/**
 * Rewrite the JSON chunk in place.
 *
 * The chunk is length-prefixed and the whole file carries a total length, so
 * both have to move together, and glTF requires the JSON chunk to be padded to
 * four bytes with spaces rather than nulls.
 */
function writeGlb(path, glb) {
  const text = Buffer.from(JSON.stringify(glb.json), 'utf8')
  const padding = (4 - (text.length % 4)) % 4
  const chunk = Buffer.concat([text, Buffer.alloc(padding, 0x20)])
  const header = Buffer.alloc(8)
  header.writeUInt32LE(chunk.length, 0)
  header.writeUInt32LE(0x4e4f534a, 4)
  const out = Buffer.concat([
    glb.buffer.subarray(0, glb.jsonStart),
    header,
    chunk,
    glb.buffer.subarray(glb.jsonEnd),
  ])
  out.writeUInt32LE(out.length, 8)
  writeFileSync(path, out)
  return out.length
}

/** Triangle area per material, so the report weights what is actually on screen. */
function areaByMaterial(json, buffer) {
  const binChunk = (() => {
    let offset = 12
    while (offset < buffer.length) {
      const length = buffer.readUInt32LE(offset)
      const type = buffer.readUInt32LE(offset + 4)
      if (type === 0x004e4942) return buffer.subarray(offset + 8, offset + 8 + length)
      offset += 8 + length
    }
    return null
  })()
  const areas = new Map()
  if (binChunk === null) return areas
  const read = (accessorIndex) => {
    const accessor = json.accessors[accessorIndex]
    const view = json.bufferViews[accessor.bufferView]
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
    return { accessor, start }
  }
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      if (primitive.material === undefined || primitive.attributes?.POSITION === undefined) continue
      const { accessor, start } = read(primitive.attributes.POSITION)
      const positions = new Float32Array(
        binChunk.buffer.slice(
          binChunk.byteOffset + start,
          binChunk.byteOffset + start + accessor.count * 12,
        ),
      )
      let indices = null
      if (primitive.indices !== undefined) {
        const idx = read(primitive.indices)
        const bytes = { 5121: 1, 5123: 2, 5125: 4 }[idx.accessor.componentType]
        const slice = binChunk.buffer.slice(
          binChunk.byteOffset + idx.start,
          binChunk.byteOffset + idx.start + idx.accessor.count * bytes,
        )
        indices =
          bytes === 4
            ? new Uint32Array(slice)
            : bytes === 2
              ? new Uint16Array(slice)
              : new Uint8Array(slice)
      }
      const count = indices === null ? accessor.count : indices.length
      let total = 0
      for (let i = 0; i + 2 < count; i += 3) {
        const [a, b, c] = [0, 1, 2].map((k) => (indices === null ? i + k : indices[i + k]) * 3)
        const ux = positions[b] - positions[a]
        const uy = positions[b + 1] - positions[a + 1]
        const uz = positions[b + 2] - positions[a + 2]
        const vx = positions[c] - positions[a]
        const vy = positions[c + 1] - positions[a + 1]
        const vz = positions[c + 2] - positions[a + 2]
        total += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)
      }
      areas.set(primitive.material, (areas.get(primitive.material) ?? 0) + total)
    }
  }
  return areas
}

const write = process.argv.includes('--write')
let weightedBefore = 0
let weightedAfter = 0
let weightTotal = 0

for (const path of TARGETS) {
  const glb = readGlb(path)
  const areas = areaByMaterial(glb.json, glb.buffer)
  console.log(`\n${path}`)
  glb.json.materials?.forEach((material, index) => {
    const pbr = material.pbrMetallicRoughness
    if (pbr?.baseColorFactor === undefined) return
    const before = pbr.baseColorFactor.slice(0, 3)
    const after = before.map(toLinear)
    const area = areas.get(index) ?? 0
    weightTotal += area
    weightedBefore += area * luminance(before)
    weightedAfter += area * luminance(after)
    if (Math.abs(luminance(before) - luminance(after)) > 0.001) {
      console.log(
        `  ${(material.name ?? '?').padEnd(30)} ${hex(before)} -> ${hex(after)}` +
          `   lum ${luminance(before).toFixed(4)} -> ${luminance(after).toFixed(4)}` +
          `   area ${area.toFixed(1)}m2`,
      )
    }
    if (write) pbr.baseColorFactor = [...after, pbr.baseColorFactor[3] ?? 1]
  })
  if (write) console.log(`  written, ${writeGlb(path, glb)} bytes`)
}

const ratio = weightedBefore / weightedAfter
console.log(
  `\narea-weighted mean albedo luminance ${(weightedBefore / weightTotal).toFixed(4)}` +
    ` -> ${(weightedAfter / weightTotal).toFixed(4)}`,
)
console.log(`the frame loses ${ratio.toFixed(2)}x of its brightness to this correction,`)
console.log(`so ENERGY_TO_INTENSITY 0.008 becomes ${(0.008 * ratio).toFixed(4)} to hold exposure.`)

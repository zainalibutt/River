import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The shipped venues are structurally valid glTF.
 *
 * Not what they look like - `venue-art.test.ts` grades that. This asks the
 * blunter question of whether a browser can open the file at all, and it exists
 * because the published GLBs have now been edited by a script rather than only
 * ever written by Blender. A GLB is a length-prefixed container: the file
 * carries a total length, each chunk carries its own, and every bufferView
 * indexes into the binary chunk by offset. Change the JSON chunk by one byte
 * without moving the other three numbers and the file is silently corrupt.
 *
 * Silently is the problem. A truncated or misaligned GLB does not throw
 * something legible - it loads as an empty scene, or as geometry with the
 * vertices read from the wrong place, and every existing gate here reads the
 * JSON chunk only and would pass a file whose geometry is unreachable.
 */

const VENUES = ['rooftop', 'basement', 'suite'] as const
const JSON_CHUNK = 0x4e4f534a
const BIN_CHUNK = 0x004e4942

interface Chunk {
  type: number
  start: number
  length: number
}

function chunksOf(buffer: Buffer): Chunk[] {
  const chunks: Chunk[] = []
  let offset = 12
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32LE(offset)
    const type = buffer.readUInt32LE(offset + 4)
    chunks.push({ type, start: offset + 8, length })
    offset += 8 + length
  }
  return chunks
}

describe.each(VENUES)('%s_assets.glb', (venue) => {
  const buffer = readFileSync(`apps/web/public/assets/${venue}_assets.glb`)

  it('has a glTF header whose declared length matches the file on disk', () => {
    expect(buffer.readUInt32LE(0)).toBe(0x46546c67)
    expect(buffer.readUInt32LE(4)).toBe(2)
    // The one a hand-edit gets wrong: the JSON chunk grows and this does not.
    expect(buffer.readUInt32LE(8)).toBe(buffer.length)
  })

  it('has chunks that tile the file exactly, with no overrun or trailing slack', () => {
    const chunks = chunksOf(buffer)
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    for (const chunk of chunks) {
      expect(chunk.start + chunk.length).toBeLessThanOrEqual(buffer.length)
      // glTF requires every chunk to be four-byte aligned.
      expect(chunk.length % 4).toBe(0)
    }
    const last = chunks[chunks.length - 1] as Chunk
    expect(last.start + last.length).toBe(buffer.length)
  })

  it('parses as JSON and declares the materials the art gates read', () => {
    const chunks = chunksOf(buffer)
    const json = chunks.find((chunk) => chunk.type === JSON_CHUNK)
    expect(json).toBeDefined()
    const parsed = JSON.parse(
      buffer
        .subarray((json as Chunk).start, (json as Chunk).start + (json as Chunk).length)
        .toString('utf8'),
    ) as { materials?: unknown[]; meshes?: unknown[]; bufferViews?: unknown[] }
    expect(parsed.materials?.length).toBeGreaterThan(0)
    expect(parsed.meshes?.length).toBeGreaterThan(0)
  })

  it('keeps every bufferView inside the binary chunk it indexes into', () => {
    // This is the assertion that catches a JSON chunk resized without the
    // binary chunk moving with it. Geometry would still be there; it would
    // just be read from the wrong offset, or off the end.
    const chunks = chunksOf(buffer)
    const json = chunks.find((chunk) => chunk.type === JSON_CHUNK) as Chunk
    const bin = chunks.find((chunk) => chunk.type === BIN_CHUNK) as Chunk
    expect(bin).toBeDefined()
    const parsed = JSON.parse(
      buffer.subarray(json.start, json.start + json.length).toString('utf8'),
    ) as {
      bufferViews?: { byteOffset?: number; byteLength: number }[]
      buffers?: { byteLength: number }[]
    }
    const views = parsed.bufferViews ?? []
    expect(views.length).toBeGreaterThan(0)
    for (const view of views) {
      const end = (view.byteOffset ?? 0) + view.byteLength
      expect(end).toBeLessThanOrEqual(bin.length)
    }
    // The declared buffer must fit in the chunk that holds it. Padding means
    // the chunk can be up to three bytes longer, never shorter.
    const declared = parsed.buffers?.[0]?.byteLength ?? 0
    expect(declared).toBeLessThanOrEqual(bin.length)
    expect(bin.length - declared).toBeLessThan(4)
  })
})

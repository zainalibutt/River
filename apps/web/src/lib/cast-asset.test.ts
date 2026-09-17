import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CLIPS } from './animation.js'
import { ACCENT_MATERIAL, PLAYER_SEATS } from './seat-accents.js'
import { venueOf } from './venue.js'

/**
 * What the scene assumes about the two files it loads.
 *
 * The Rooftop no longer carries bodies: it carries eight seat anchors, and the scene
 * instances the character file into them, one skeleton and one mixer each. Every one of
 * those assumptions is a name or a count in a built file - the clip names, the material the
 * lapels are coloured through, the anchors, the chair each anchor belongs to - and a name
 * that quietly stops matching leaves eight identical men sitting perfectly still with no
 * error anywhere. This reads the files and says so instead.
 *
 * It needs the built assets in place: run the pipeline's publish step if it fails on a
 * missing file.
 */
function assetPath(url: string): string {
  return fileURLToPath(new URL(`../../public${url}`, import.meta.url))
}

function readGlbJson(path: string): Record<string, unknown> {
  const raw = readFileSync(path)
  expect(raw.subarray(0, 4).toString('ascii')).toBe('glTF')
  let offset = 12
  while (offset < raw.length) {
    const length = raw.readUInt32LE(offset)
    const kind = raw.readUInt32LE(offset + 4)
    const chunk = raw.subarray(offset + 8, offset + 8 + length)
    offset += 8 + length
    if (kind === 0x4e4f534a) return JSON.parse(chunk.toString('utf8')) as Record<string, unknown>
  }
  throw new Error(`${path} has no JSON chunk`)
}

interface Node {
  name?: string
  mesh?: number
  skin?: number
  extras?: { seatIndex?: number; riverCast?: string }
}

const rooftop = venueOf('rooftop')

describe('the Rooftop and its cast, as built', () => {
  it('has a cast file, and a venue that expects one', () => {
    expect(rooftop.cast).toBeDefined()
    for (const url of [rooftop.asset, rooftop.cast as string]) {
      expect(
        existsSync(assetPath(url)),
        `${url} is not published; run the pipeline publish step`,
      ).toBe(true)
    }
  })

  it('carries exactly the clips the contract names, once each', () => {
    const document = readGlbJson(assetPath(rooftop.cast as string))
    const animations = (document.animations as { name?: string }[]) ?? []
    const names = animations.map((animation) => animation.name)
    expect([...names].sort()).toEqual([...CLIPS].sort())
  })

  it('colours the lapels through a material that exists, on one skeleton with unique bone names', () => {
    const document = readGlbJson(assetPath(rooftop.cast as string))
    const materials = (document.materials as { name?: string }[]) ?? []
    expect(materials.map((material) => material.name)).toContain(ACCENT_MATERIAL)

    // One skin, and no two joints sharing a name: a mixer rooted at a clone binds its
    // tracks by name, so a duplicate would let one seat drive another's bones.
    const skins = (document.skins as { joints: number[] }[]) ?? []
    expect(skins.length).toBe(1)
    const nodes = (document.nodes as Node[]) ?? []
    const joints = (skins[0]?.joints ?? []).map((index) => nodes[index]?.name)
    expect(new Set(joints).size).toBe(joints.length)
  })

  it('seats the cast on eight anchors, each with the chair it belongs to', () => {
    const document = readGlbJson(assetPath(rooftop.asset))
    const nodes = (document.nodes as Node[]) ?? []
    const anchors = nodes.filter((node) => node.extras?.riverCast === 'native_silver')
    expect(
      anchors.map((node) => node.extras?.seatIndex).sort((a, b) => Number(a) - Number(b)),
    ).toEqual(Array.from({ length: PLAYER_SEATS }, (_, seat) => seat))
    const names = new Set(nodes.map((node) => node.name))
    for (const anchor of anchors) {
      const seat = anchor.extras?.seatIndex as number
      expect(names.has(`rooftop_chair_${seat + 1}`), `seat ${seat} has no chair`).toBe(true)
    }
  })

  it('carries no bodies of its own, so nothing is drawn twice', () => {
    const document = readGlbJson(assetPath(rooftop.asset))
    expect(document.skins ?? []).toEqual([])
    expect(document.animations ?? []).toEqual([])
  })
})

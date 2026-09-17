import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CLIPS } from './animation.js'
import { ACCENT_MATERIAL, PLAYER_SEATS } from './seat-accents.js'
import { AUTHORED_FELT_Y, CHIP_STACK_PLACE, HOLE_CARD_PEEK } from './seat-props.js'
import { TABLE_SURFACE_HEIGHT, venueOf } from './venue.js'

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
  translation?: [number, number, number]
  rotation?: [number, number, number, number]
  scale?: [number, number, number]
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

  it('seats him so the felt he was authored on is the felt he is sitting at', () => {
    // Every prop place in seat-props is measured on the proof stage's felt, and they are
    // used unchanged because the venue's scale is chosen to land that height exactly on
    // this table. If that stops being true the cards float above the felt or sink into it,
    // and nothing else in the build would say so.
    const document = readGlbJson(assetPath(rooftop.asset))
    const nodes = (document.nodes as Node[]) ?? []
    const anchors = nodes.filter((node) => node.extras?.riverCast === 'native_silver')
    expect(anchors.length).toBe(PLAYER_SEATS)
    for (const anchor of anchors) {
      const lift = anchor.translation?.[1] ?? 0
      const scale = anchor.scale?.[0] ?? 1
      expect(lift + scale * AUTHORED_FELT_Y).toBeCloseTo(TABLE_SURFACE_HEIGHT, 3)
      expect(anchor.scale?.[0]).toBeCloseTo(anchor.scale?.[2] ?? 0, 6)
    }
  })

  it('turns every anchor to face the felt, so a stack lands in front of a player', () => {
    // The chips go through the anchor's own matrix: his +Z is where his hands reach. An
    // anchor turned the wrong way would put a player's stack on the floor behind him, and
    // the only way to tell is to ask which way it points.
    const document = readGlbJson(assetPath(rooftop.asset))
    const nodes = (document.nodes as Node[]) ?? []
    for (const anchor of nodes.filter((node) => node.extras?.riverCast === 'native_silver')) {
      const [x = 0, y = 0, z = 0, w = 1] = anchor.rotation ?? [0, 0, 0, 1]
      // The local +Z axis, turned by the anchor's quaternion.
      const forward = {
        x: 2 * (x * z + w * y),
        z: 1 - 2 * (x * x + y * y),
      }
      const place = anchor.translation ?? [0, 0, 0]
      const outward = { x: place[0], z: place[2] }
      // Facing the middle of the felt: his forward and the way out from the table oppose.
      expect(forward.x * outward.x + forward.z * outward.z).toBeLessThan(0)
      // And the stack he was authored to reach lands inside the ring he sits on.
      const reach = Math.hypot(
        place[0] + forward.x * CHIP_STACK_PLACE.rest[2],
        place[2] + forward.z * CHIP_STACK_PLACE.rest[2],
      )
      expect(reach).toBeLessThan(Math.hypot(outward.x, outward.z))
    }
  })

  it('carries a peek track as long as the peek clip it belongs to', () => {
    const document = readGlbJson(assetPath(rooftop.cast as string))
    const animations = (document.animations as { name?: string }[]) ?? []
    expect(animations.map((animation) => animation.name)).toContain('PEEK_card')
    for (const track of HOLE_CARD_PEEK) expect(track.length / 7).toBe(49)
  })

  it('carries no bodies of its own, so nothing is drawn twice', () => {
    const document = readGlbJson(assetPath(rooftop.asset))
    expect(document.skins ?? []).toEqual([])
    expect(document.animations ?? []).toEqual([])
  })
})

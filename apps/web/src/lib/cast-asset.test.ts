import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CLIPS } from './animation.js'
import { CAST, type CastId, castFit } from './cast.js'
import { SEAT_HEIGHT, TABLE_SURFACE_HEIGHT, venueOf } from './venue.js'

/**
 * The seats the venue file carries, which is not the number the table seats.
 *
 * The 2D table seats nine and draws its dealer itself. The venue lays nine
 * places on the felt with the dealer standing in one of them, so it anchors
 * eight bodies - and it is behind a developer switch rather than in v1. This
 * checks the file that exists rather than the table that is played on.
 */
const VENUE_ANCHORS = 8

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
  extras?: { seatIndex?: number; riverCast?: string; castChairBack?: string }
}

const rooftop = venueOf('rooftop')
const casting: readonly CastId[] = rooftop.cast ?? []

function anchorsOf(): Node[] {
  const document = readGlbJson(assetPath(rooftop.asset))
  const nodes = (document.nodes as Node[]) ?? []
  return nodes.filter((node) => node.extras?.riverCast === 'native_silver')
}

describe('the Rooftop and its cast, as built', () => {
  it('has a file for everyone in the cast, and a venue that expects them', () => {
    expect(casting.length).toBeGreaterThan(1)
    for (const url of [rooftop.asset, ...casting.map((id) => CAST[id].asset)]) {
      expect(
        existsSync(assetPath(url)),
        `${url} is not published; run the pipeline publish step`,
      ).toBe(true)
    }
  })

  it.each(casting)('%s carries exactly the clips the contract names, once each', (id) => {
    const document = readGlbJson(assetPath(CAST[id].asset))
    const animations = (document.animations as { name?: string }[]) ?? []
    const names = animations.map((animation) => animation.name)
    expect([...names].sort()).toEqual([...CLIPS].sort())
  })

  it.each(casting)(
    '%s has the material a seat colour is painted on, on one skeleton with unique bones',
    (id) => {
      const document = readGlbJson(assetPath(CAST[id].asset))
      const materials = (document.materials as { name?: string }[]) ?? []
      expect(materials.map((material) => material.name)).toContain(CAST[id].accent.material)

      // One skin, and no two joints sharing a name: a mixer rooted at a clone binds its
      // tracks by name, so a duplicate would let one seat drive another's bones.
      const skins = (document.skins as { joints: number[] }[]) ?? []
      expect(skins.length).toBe(1)
      const nodes = (document.nodes as Node[]) ?? []
      const joints = (skins[0]?.joints ?? []).map((index) => nodes[index]?.name)
      expect(new Set(joints).size).toBe(joints.length)
    },
  )

  it('seats the cast on eight anchors, each with the chair it belongs to', () => {
    const document = readGlbJson(assetPath(rooftop.asset))
    const nodes = (document.nodes as Node[]) ?? []
    const anchors = nodes.filter((node) => node.extras?.riverCast === 'native_silver')
    expect(
      anchors.map((node) => node.extras?.seatIndex).sort((a, b) => Number(a) - Number(b)),
    ).toEqual(Array.from({ length: VENUE_ANCHORS }, (_, seat) => seat))
    const names = new Set(nodes.map((node) => node.name))
    for (const anchor of anchors) {
      const seat = anchor.extras?.seatIndex as number
      expect(names.has(`rooftop_chair_${seat + 1}`), `seat ${seat} has no chair`).toBe(true)
    }
  })

  it('seats each of them so the stage they were authored on is the table they sit at', () => {
    // Every prop place is measured on the stage its character was authored on, and they are
    // used unchanged because the seat is fitted to land that stage's seat height and felt
    // height exactly on this chair and this table. If that stops being true the cards float
    // above the felt or sink into it, and nothing else in the build would say so.
    const anchors = anchorsOf()
    expect(anchors.length).toBe(VENUE_ANCHORS)
    for (const anchor of anchors) {
      const lift = anchor.translation?.[1] ?? 0
      const scale = anchor.scale?.[0] ?? 1
      expect(anchor.scale?.[0]).toBeCloseTo(anchor.scale?.[2] ?? 0, 6)
      for (const id of casting) {
        const character = CAST[id]
        const fit = castFit(character, scale, lift)
        const world = scale * fit.scale
        const under = lift + scale * fit.lift
        expect(under + world * character.props.stage.felt).toBeCloseTo(TABLE_SURFACE_HEIGHT, 4)
        expect(under + world * character.props.stage.pan).toBeCloseTo(SEAT_HEIGHT, 4)
      }
    }
  })

  it('tells the browser how much further out a chair stands for the rest of the cast', () => {
    // The venue tucks every chair to Silver's back. Gold's dress spreads further behind her
    // than his jacket does, so a chair left where his is stands inside it, and the amount is
    // the venue's to measure: it is that chair's geometry, not hers.
    const backs = anchorsOf().map(
      (anchor) => (JSON.parse(anchor.extras?.castChairBack ?? '{}') as Record<string, number>).gold,
    )
    expect(backs.length).toBe(VENUE_ANCHORS)
    for (const back of backs) {
      expect(typeof back, 'the venue carries no Gold chair offset; rebuild it').toBe('number')
      expect(back as number).toBeGreaterThan(0.02)
      expect(back as number).toBeLessThan(0.2)
    }
    // One body against one chair: every seat gets the same answer, and a seat that drifted
    // would be an anchor out of place rather than a character.
    expect(new Set(backs.map((back) => Math.round((back as number) * 1000))).size).toBe(1)
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
      for (const id of casting) {
        const rest = CAST[id].props.chipStack.rest[2] ?? 0
        const reach = Math.hypot(place[0] + forward.x * rest, place[2] + forward.z * rest)
        expect(reach).toBeLessThan(Math.hypot(outward.x, outward.z))
      }
    }
  })

  it.each(casting)('%s carries a peek track as long as the peek clip it belongs to', (id) => {
    const document = readGlbJson(assetPath(CAST[id].asset))
    const animations = (document.animations as { name?: string }[]) ?? []
    expect(animations.map((animation) => animation.name)).toContain('PEEK_card')
    for (const track of CAST[id].props.peek) {
      expect(track.length / 7).toBe(CAST[id].props.peekLastFrame + 1)
    }
  })

  it('carries no bodies of its own, so nothing is drawn twice', () => {
    const document = readGlbJson(assetPath(rooftop.asset))
    expect(document.skins ?? []).toEqual([])
    expect(document.animations ?? []).toEqual([])
  })
})

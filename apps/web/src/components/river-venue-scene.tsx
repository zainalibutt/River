'use client'

import { OrbitControls, useGLTF } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import {
  denominations,
  layOutPlaques,
  projectToScreen,
  type ScreenCamera,
  stackLayout,
} from '@river/engine'
import {
  type RefObject,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import * as THREE from 'three'
import { type OrbitControls as OrbitControlsImpl, RectAreaLightUniformsLib } from 'three-stdlib'
import { type AnimationCue, idleCueFor, missingClips } from '@/lib/animation'
import { frameMetrics, TABLE_REGIONS } from '@/lib/frame-metrics'
import {
  ambientFor,
  type LightingSidecar,
  loadLightingSidecar,
  type SceneLight,
  toSceneLights,
  worldColourOf,
} from '@/lib/lighting'
import {
  cameraPlacement,
  FELT_LIGHT_REACH,
  ORBIT_POLAR_DEGREES,
  seatCameraAzimuth,
  TABLE_SURFACE_HEIGHT,
  VENUE_ORDER,
  type VenueId,
  venueOf,
  verticalFov,
  worldSeats,
} from '@/lib/venue'

/** One seat's chips, already placed in the world by the seat ring. */
export interface SeatChips {
  seat: number
  amount: number
  x: number
  z: number
}

type SceneProps = {
  seatIds: string[]
  seatRefs: RefObject<Map<string, HTMLElement>>
  venueId: VenueId
  /** Latest gestures to play, one per seat. Never gates the hand. */
  cues?: readonly AnimationCue[] | undefined
  /**
   * Seat indexes with a player or a bot in them.
   *
   * The venue GLB bakes nine characters in as geometry, so without this every
   * seat shows a body whatever the room says - a table of nine strangers that
   * never empties. The reference leaves chairs empty and uses them as
   * foreground set dressing; the negative space is what makes it read as a
   * room rather than a ring of people.
   *
   * Undefined means "show everyone", which keeps the venue previewable with no
   * room attached.
   */
  occupiedSeats?: readonly number[] | undefined
  /** What each occupied seat has in front of it, for the chip stacks. */
  seatChips?: readonly SeatChips[] | undefined
  /** The local player's seat. The opening camera starts behind it. */
  heroSeat?: number | null | undefined
  /** Dev-review seat framed from inside the table for a face-side close read. */
  reviewSeat?: number | null | undefined
}

function Seats({ seatIds, seatRefs, venueId }: SceneProps) {
  const venue = venueOf(venueId)
  const seats = useMemo(() => worldSeats(seatIds, venue.seatRing), [seatIds, venue.seatRing])
  const { camera, controls } = useThree()
  const focus = useMemo(() => new THREE.Vector3(), [])

  useFrame(() => {
    const orbit = controls as OrbitControlsImpl | null
    if (orbit === null) return
    focus.copy(orbit.target)
    const perspective = camera as THREE.PerspectiveCamera
    const spec: ScreenCamera = {
      position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      target: { x: focus.x, y: focus.y, z: focus.z },
      verticalFovDegrees: perspective.fov,
      aspect: perspective.aspect,
      near: perspective.near,
      far: perspective.far,
    }
    const screens = seats.map((seat) => projectToScreen({ x: seat.x, y: seat.y, z: seat.z }, spec))
    // Anchors alone put nine plaques on top of each other and over the board.
    // The table centre is the point they are pushed away from, so a label
    // never crosses to the far side and stops being that player's label.
    const table = projectToScreen({ x: 0, y: focus.y, z: 0 }, spec)
    const laidOut = layOutPlaques(
      screens.map((screen) => ({ xPercent: screen.xPercent, yPercent: screen.yPercent })),
      PLAQUE,
      STAGE,
      { xPercent: table.xPercent, yPercent: table.yPercent },
    )
    seats.forEach((seat, index) => {
      const element = seatRefs.current.get(seat.id)
      const screen = screens[index]
      const placement = laidOut[index]
      if (element === undefined || screen === undefined || placement === undefined) return
      // A seat behind the camera projects to a coordinate that looks perfectly
      // reasonable and is on the wrong side of the screen. Set directly rather
      // than through a custom property: several seat states already own
      // opacity, and a folded player must still look folded while a seat
      // behind the camera stays hidden.
      element.style.visibility = screen.behind ? 'hidden' : 'visible'
      element.style.setProperty('--seat-x', `${placement.xPercent}%`)
      element.style.setProperty('--seat-y', `${placement.yPercent}%`)
    })
  })

  return <group />
}

const seatIndexes = [0, 1, 2, 3, 4, 5, 6, 7, 8]

type SeatRig = { seat: number; boneNames: string[] }

function seatClipKey(seat: number, clip: string): string {
  return `${seat}:${clip}`
}

/**
 * The seated rigs, in seat order.
 *
 * The pipeline stamps `seatIndex` on each character root and the exporter
 * carries it through as glTF extras, so the seat a rig belongs to is read from
 * the asset rather than inferred from position or import order.
 */
function seatRigs(scene: THREE.Object3D): SeatRig[] {
  const rigs: SeatRig[] = []
  scene.traverse((object) => {
    const seat = object.userData?.seatIndex
    if (typeof seat !== 'number') return
    const skinned: THREE.SkinnedMesh[] = []
    object.traverse((child) => {
      if (child instanceof THREE.SkinnedMesh) skinned.push(child)
    })
    const skeleton = skinned[0]?.skeleton
    if (skeleton === undefined) return
    rigs.push({ seat, boneNames: skeleton.bones.map((bone) => bone.name) })
  })
  return rigs.sort((left, right) => left.seat - right.seat)
}

/**
 * One clip, pointed at one rig's bones.
 *
 * Returns how many tracks found a target as well as the clip, because a
 * retarget that matches nothing produces an action that plays, reports no
 * error, and never moves a vertex.
 */
function retargetToRig(
  clip: THREE.AnimationClip,
  from: readonly string[],
  to: readonly string[],
): { clip: THREE.AnimationClip; matched: number } {
  const rename = new Map<string, string>()
  from.forEach((name, index) => {
    const replacement = to[index]
    if (replacement !== undefined) rename.set(name, replacement)
  })
  const cloned = clip.clone()
  let matched = 0
  for (const track of cloned.tracks) {
    const split = track.name.lastIndexOf('.')
    const node = split < 0 ? track.name : track.name.slice(0, split)
    const property = split < 0 ? '' : track.name.slice(split)
    const mapped = rename.get(node)
    if (mapped === undefined) continue
    track.name = mapped + property
    matched += 1
  }
  return { clip: cloned, matched }
}

/** The plaque and the stage, as percentages of the 1920 by 1080 design box. */
const PLAQUE = { widthPercent: (208 / 1920) * 100, heightPercent: (76 / 1080) * 100 }
const STAGE = { widthPercent: 100, heightPercent: 100 }

function VenueAsset({
  venueId,
  cues,
  occupiedSeats,
}: {
  venueId: VenueId
  cues: readonly AnimationCue[]
  occupiedSeats: readonly number[] | undefined
}) {
  const venue = venueOf(venueId)
  const asset = useGLTF(venue.asset)
  const mixers = useRef<THREE.AnimationMixer[]>([])
  const actions = useRef<Map<string, THREE.AnimationAction>>(new Map())

  useLayoutEffect(() => {
    asset.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      // These nodes carry source geometry for the runtime instanced chips and
      // cards. Rendering the source as well parked loose chips and two cards
      // below the table at the GLB origin.
      if (
        object.name === 'board_card_pool' ||
        (object.name.includes('chip') && object.name.includes('pool'))
      ) {
        object.visible = false
        return
      }
      object.castShadow = venue.shadowCasters.test(object.name)
      object.receiveShadow = object.name !== 'river_card'
    })
  }, [asset.scene, venue.shadowCasters])

  useLayoutEffect(() => {
    mixers.current = []
    actions.current = new Map()
    const clips = asset.animations
    if (clips.length === 0) {
      // Say so once. The venues export nine skins and no clips, and a silent
      // absence here is exactly how four earlier modules ended up finished and
      // wired to nothing.
      if (process.env.NODE_ENV !== 'production') {
        console.warn(
          `river: ${venue.name} carries no animation clips; missing ${missingClips([]).join(', ')}`,
        )
      }
      return
    }
    // One mixer on the whole imported scene rather than one per child. A glTF
    // clip's tracks name their target nodes by path from the scene root, so a
    // mixer rooted anywhere else binds nothing and reports no error at all.
    const mixer = new THREE.AnimationMixer(asset.scene)
    mixers.current.push(mixer)
    // The venue carries nine copies of one rig and one clip set authored
    // against a single skeleton. Every copy uses the same bone names, so the
    // loader suffixes the duplicates - spine01, spine01_1 ... spine01_8 - and
    // an unsuffixed track binds to whichever rig imported first. That is one
    // character breathing and eight sitting perfectly still, with no error.
    // Retarget per seat by bone index: the nine skeletons are the same rig, so
    // position in the bone list is the mapping, and no name parsing is needed.
    const rigs = seatRigs(asset.scene)
    const base = rigs[0]?.boneNames ?? []
    let bound = 0
    for (const rig of rigs) {
      for (const clip of clips) {
        const targeted = retargetToRig(clip, base, rig.boneNames)
        bound += targeted.matched
        actions.current.set(seatClipKey(rig.seat, clip.name), mixer.clipAction(targeted.clip))
      }
    }
    if (process.env.NODE_ENV !== 'production') {
      // A retarget that matched nothing plays silently and looks exactly like
      // a rig that carries no clips, which is the failure this scene has
      // already produced twice. Say so rather than let it read as working.
      if (rigs.length > 0 && bound === 0) {
        console.warn(
          `river: ${venue.name} matched no animation tracks to any of its ${rigs.length} rigs; the clips will not move anything`,
        )
      }
      Object.assign(window, {
        riverClips: clips.map((clip) => ({
          name: clip.name,
          tracks: clip.tracks.length,
          seconds: Number(clip.duration.toFixed(2)),
        })),
        riverRigs: { seats: rigs.map((rig) => rig.seat), boundTracks: bound },
      })
    }
    return () => {
      for (const mixer of mixers.current) mixer.stopAllAction()
      mixers.current = []
    }
  }, [asset.animations, asset.scene, venue.name])

  useLayoutEffect(() => {
    // Hide the baked character for any seat nobody is sitting in. The chair
    // stays: an empty chair is set dressing, an empty seat with a body in it is
    // a lie about who is at the table.
    asset.scene.traverse((object) => {
      const seat = object.userData?.seatIndex
      if (typeof seat !== 'number') return
      object.visible = occupiedSeats === undefined || occupiedSeats.includes(seat)
    })
  }, [asset.scene, occupiedSeats])

  const playing = useMemo(() => (cues.length > 0 ? cues : seatIndexes.map(idleCueFor)), [cues])

  useEffect(() => {
    // A cue names a seat, and only that seat's action may answer it. Matching
    // on clip name alone played one shared action nine times over, which is
    // eight no-ops and one character doing everybody's gestures.
    const timers: ReturnType<typeof setTimeout>[] = []
    const start = (cue: AnimationCue) => {
      const action = actions.current.get(seatClipKey(cue.seat, cue.clip))
      if (action === undefined) return
      action.reset()
      action.setLoop(cue.loop ? THREE.LoopRepeat : THREE.LoopOnce, Number.POSITIVE_INFINITY)
      action.clampWhenFinished = !cue.loop
      action.play()
    }
    for (const cue of playing) {
      // The stagger is the whole reason idlePhaseFor exists: nine characters
      // breathing on the same frame reads as a row of clones. It was computed
      // per seat and then thrown away here.
      if (cue.delaySeconds > 0) {
        timers.push(setTimeout(() => start(cue), cue.delaySeconds * 1000))
        continue
      }
      start(cue)
    }
    return () => {
      for (const timer of timers) clearTimeout(timer)
    }
  }, [playing])

  // Advancing the mixers is the only per-frame cost, and it is skipped entirely
  // while there is nothing to advance.
  useFrame((_, delta) => {
    for (const mixer of mixers.current) mixer.update(delta)
  })

  return <primitive object={asset.scene} />
}

/**
 * Table pieces at the size they actually are.
 *
 * A casino chip is 39mm across and 3.3mm thick; a playing card is 63 by 88mm.
 * The client was drawing chips at 240mm - six times over - and cards at 270 by
 * 390, which is what those amber drums round the felt were.
 *
 * The chip is drawn at its real diameter and a thicker slab than a real chip,
 * because a 3mm disc at this camera is a line. The card keeps the cheat scale
 * the art direction asks for: readable beats accurate on the one object a
 * player has to read from across a table.
 *
 * The venue GLB already carries correct chip and card geometry as instancing
 * pools parked at the origin. Instancing those rather than these primitives is
 * the right end state and is not this change.
 */
/** Enough for nine full stacks; anything past the last real chip is parked. */
const MAX_CHIPS = 320

/**
 * Chip colours come from the engine's own denomination ladder.
 *
 * They were briefly a table in this file, which is a second copy of something
 * `chip-stacks.ts` already publishes with each denomination - and a second copy
 * of a colour is how a 5K chip ends up orange on the felt and red in the shop.
 */
const CHIP_COLOURS: ReadonlyMap<number, string> = new Map(
  denominations().map((entry) => [entry.value, `#${entry.colour}`]),
)

/**
 * A casino chip is 39mm across and 3.3mm thick. Both numbers are measured, not
 * chosen, and the second one was wrong by 3.6x: at 12mm a chip was the
 * thickness of four, so a twenty-chip buy-in stood 24cm off the felt - a tower
 * taller than the gap between the table and a seated player's chin. Stacks read
 * as columns of poker chips at 3.3mm and as stacked hockey pucks at 12mm.
 */
const CHIP_RADIUS = 0.0195
const CHIP_HEIGHT = 0.0033

/**
 * The edge spots.
 *
 * A chip without them is a coloured disc, and a stack of coloured discs is one
 * extruded cylinder - which is exactly what the felt has been showing. The
 * bright dashes break the side of the stack up so the eye counts chips.
 *
 * Drawn rather than shipped: it is 128x16 of two colours, and a PNG in the
 * assets folder would be a build step and a network request for something a
 * canvas produces in under a millisecond. Values, not hues - the instance
 * colour supplies the hue, so this multiplies against every denomination.
 */
function chipEdgeTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 16
  const context = canvas.getContext('2d')
  if (context === null) return null
  context.fillStyle = '#8c8c8c'
  context.fillRect(0, 0, 128, 16)
  context.fillStyle = '#ffffff'
  // Six spots around the rim, each about a third of its own arc. Three or four
  // reads as a mistake; twelve turns back into a solid band at this size.
  for (let spot = 0; spot < 6; spot += 1) {
    context.fillRect(spot * (128 / 6) + 128 / 18, 0, 128 / 9, 16)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

/** The face: an inner disc with a ring, which is all that is legible of the top chip. */
function chipFaceTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const context = canvas.getContext('2d')
  if (context === null) return null
  context.fillStyle = '#8c8c8c'
  context.fillRect(0, 0, 64, 64)
  context.strokeStyle = '#ffffff'
  context.lineWidth = 4
  context.beginPath()
  context.arc(32, 32, 19, 0, Math.PI * 2)
  context.stroke()
  context.fillStyle = '#d8d8d8'
  context.beginPath()
  context.arc(32, 32, 11, 0, Math.PI * 2)
  context.fill()
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}
const CARD_WIDTH = 0.126
const CARD_LENGTH = 0.176
const CARD_THICKNESS = 0.004

function InstancedTablePieces({ seatChips }: { seatChips: readonly SeatChips[] }) {
  const chips = useRef<THREE.InstancedMesh>(null)
  const cards = useRef<THREE.InstancedMesh>(null)
  const matrix = useMemo(() => new THREE.Matrix4(), [])
  const tint = useMemo(() => new THREE.Color(), [])
  // Cylinder groups are side, top cap, bottom cap - so the rim and the face get
  // different art off one geometry and one draw call.
  const chipMaterials = useMemo(() => {
    const edge = chipEdgeTexture()
    const face = chipFaceTexture()
    const side = new THREE.MeshStandardMaterial({ metalness: 0.04, roughness: 0.62 })
    if (edge !== null) side.map = edge
    const cap = new THREE.MeshStandardMaterial({ metalness: 0.04, roughness: 0.58 })
    if (face !== null) cap.map = face
    return [side, cap, cap]
  }, [])
  useEffect(
    () => () => {
      for (const material of chipMaterials) {
        material.map?.dispose()
        material.dispose()
      }
    },
    [chipMaterials],
  )

  useLayoutEffect(() => {
    const mesh = chips.current
    if (mesh !== null) {
      let placed = 0
      for (const seat of seatChips) {
        // Chips belong to somebody. They used to be a fixed grid of 36 in one
        // spot on the felt, unrelated to what anybody had - a decal of chips
        // rather than a readout of them.
        const columns = stackLayout(seat.amount)
        // Sit them on the felt between the player and the board, so a stack
        // reads as that player's without covering the cards.
        // The seat ring is wider than the felt. At 0.62 the near-seat stack
        // landed on the rail and projected against the black table apron.
        // Measured in Chrome against the raised near rail, 0.25 keeps even the
        // camera-side stack visible on the felt rather than projecting across
        // the black table apron.
        const inward = 0.25
        const baseX = seat.x * inward
        const baseZ = seat.z * inward
        for (const column of columns) {
          for (let height = 0; height < column.count; height += 1) {
            if (placed >= MAX_CHIPS) break
            // Spin each chip a different way. Without this every spot lines up
            // and the stack grows six vertical seams down its side, which is
            // the one thing a real stack never has. Hashed off the index rather
            // than Math.random so a chip does not jump on re-render.
            matrix.makeRotationY(((placed * 2654435761) % 1024) * (Math.PI / 512))
            matrix.setPosition(
              baseX + column.offsetX,
              TABLE_SURFACE_HEIGHT + CHIP_HEIGHT / 2 + height * CHIP_HEIGHT,
              baseZ + column.offsetZ,
            )
            mesh.setMatrixAt(placed, matrix)
            mesh.setColorAt(placed, tint.set(CHIP_COLOURS.get(column.denomination) ?? '#d8d2c6'))
            placed += 1
          }
        }
      }
      // Anything past the last real chip is parked at zero scale rather than
      // left wherever the previous hand put it.
      const hidden = new THREE.Matrix4().makeScale(0, 0, 0)
      for (let index = placed; index < MAX_CHIPS; index += 1) mesh.setMatrixAt(index, hidden)
      mesh.count = MAX_CHIPS
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true
    }
    if (cards.current !== null) {
      for (let index = 0; index < 5; index += 1) {
        matrix.makeTranslation(
          -(CARD_WIDTH + 0.02) * 2 + index * (CARD_WIDTH + 0.02),
          TABLE_SURFACE_HEIGHT + CARD_THICKNESS / 2,
          0,
        )
        cards.current.setMatrixAt(index, matrix)
      }
      cards.current.instanceMatrix.needsUpdate = true
    }
  }, [matrix, tint, seatChips])

  return (
    <>
      <instancedMesh
        ref={chips}
        args={[undefined, undefined, MAX_CHIPS]}
        material={chipMaterials}
        castShadow={false}
        receiveShadow
      >
        <cylinderGeometry args={[CHIP_RADIUS, CHIP_RADIUS, CHIP_HEIGHT, 24]} />
      </instancedMesh>
      <instancedMesh ref={cards} args={[undefined, undefined, 5]} castShadow={false} receiveShadow>
        <boxGeometry args={[CARD_WIDTH, CARD_THICKNESS, CARD_LENGTH]} />
        <meshStandardMaterial color="#e8ded0" roughness={0.68} />
      </instancedMesh>
    </>
  )
}

function CameraOrbit({
  venueId,
  heroSeat = null,
  reviewSeat = null,
}: {
  venueId: VenueId
  heroSeat?: number | null
  reviewSeat?: number | null
}) {
  const venue = venueOf(venueId)
  const placement = useMemo(() => cameraPlacement(venue), [venue])
  const reviewPlacement = useMemo(() => {
    if (reviewSeat === null) return null
    const seat = worldSeats(
      Array.from({ length: 8 }, (_, index) => String(index)),
      venue.seatRing,
    )[reviewSeat]
    if (seat === undefined) return null
    const radius = Math.hypot(seat.x, seat.z)
    if (radius === 0) return null
    const inwardX = -seat.x / radius
    const inwardZ = -seat.z / radius
    // The source head is about 1.55m, then the venue applies its measured 0.73
    // character scale and 5cm seat lift. Aim below the face so the proof keeps
    // hair, neckline, hands and rail in one frame instead of clipping the chin.
    const target: [number, number, number] = [seat.x, 1.04, seat.z]
    const position: [number, number, number] = [
      seat.x + inwardX * 1.45,
      1.14,
      seat.z + inwardZ * 1.45,
    ]
    return { position, target, distance: 1.453 }
  }, [reviewSeat, venue.seatRing])
  const controls = useRef<OrbitControlsImpl>(null)
  const { camera, size } = useThree()

  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera) || size.height === 0) return
    camera.fov = verticalFov(
      reviewPlacement === null ? venue.camera.fov : 52,
      size.width / size.height,
    )
    camera.updateProjectionMatrix()
  }, [camera, reviewPlacement, size.width, size.height, venue.camera.fov])

  useEffect(() => {
    if (controls.current === null || reviewPlacement === null) return
    camera.position.set(...reviewPlacement.position)
    controls.current.target.set(...reviewPlacement.target)
    controls.current.update()
  }, [camera, reviewPlacement])

  useEffect(() => {
    if (controls.current === null || heroSeat === null) return
    controls.current.setAzimuthalAngle(seatCameraAzimuth(heroSeat, venue.seatRing))
    controls.current.update()
  }, [heroSeat, venue.seatRing])

  useFrame((_, delta) => {
    const gamepad = navigator.getGamepads().find((candidate) => candidate !== null)
    if (gamepad === undefined || controls.current === null) return
    const horizontal = gamepad.axes[2] ?? 0
    const vertical = gamepad.axes[3] ?? 0
    if (Math.abs(horizontal) < 0.14 && Math.abs(vertical) < 0.14) return
    controls.current.setAzimuthalAngle(
      controls.current.getAzimuthalAngle() - horizontal * delta * 2,
    )
    controls.current.setPolarAngle(
      THREE.MathUtils.clamp(
        controls.current.getPolarAngle() + vertical * delta,
        THREE.MathUtils.degToRad(50),
        THREE.MathUtils.degToRad(70),
      ),
    )
    controls.current.update()
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan={false}
      enableZoom={false}
      minDistance={reviewPlacement?.distance ?? placement.distance}
      maxDistance={reviewPlacement?.distance ?? placement.distance}
      minPolarAngle={THREE.MathUtils.degToRad(ORBIT_POLAR_DEGREES.min)}
      maxPolarAngle={THREE.MathUtils.degToRad(ORBIT_POLAR_DEGREES.max)}
      target={reviewPlacement?.target ?? placement.target}
    />
  )
}

function AreaLight({ light }: { light: SceneLight }) {
  const ref = useRef<THREE.RectAreaLight>(null)

  useLayoutEffect(() => {
    // A rect area light emits along its own -Z and nothing in the rig rotates
    // it, so without this every soft source fires sideways at the nearest wall.
    ref.current?.lookAt(light.target[0], light.target[1], light.target[2])
  }, [light.target])

  return (
    <rectAreaLight
      ref={ref}
      color={light.colour}
      height={light.height}
      intensity={light.intensity}
      position={light.position}
      width={light.width}
    />
  )
}

function CasterLight({ light }: { light: SceneLight }) {
  // Derived from the table, not chosen. The cone opens just wide enough to
  // cover the felt and its rail from wherever the rig put the lamp: measured
  // by ablation, the old hardcoded 0.62 threw a 2.24m pool across a 1.24m felt
  // and handed the floor 11.1 points of the frame's light against the table's
  // 4.2 - the one lamp meant to light the table was lighting the room.
  const coneAngle = useMemo(() => {
    const drop = light.position[1] - TABLE_SURFACE_HEIGHT
    if (!(drop > 0.1)) return 0.62
    return Math.atan(FELT_LIGHT_REACH / drop)
  }, [light.position])
  const target = useMemo(() => {
    const object = new THREE.Object3D()
    object.position.set(light.target[0], light.target[1], light.target[2])
    return object
  }, [light.target])

  return (
    <>
      <primitive object={target} />
      <spotLight
        castShadow
        angle={coneAngle}
        color={light.colour}
        distance={0}
        // The caster carries the pool of light on the felt, so it is scaled
        // apart from the fills - a spot falls off with distance and the broad
        // area sources do not. It has to win outright: the parapet and terrace
        // are pale concrete and the felt is dark green, so under even light the
        // walls beat the table and the eye lands in the wrong place.
        intensity={light.intensity * 26}
        penumbra={0.85}
        position={light.position}
        shadow-mapSize={[2048, 2048]}
        target={target}
      />
    </>
  )
}

function VenueLights({
  lights,
  ambient,
}: {
  lights: readonly SceneLight[]
  ambient: { colour: string; intensity: number }
}) {
  useEffect(() => {
    // RectAreaLight renders black until its uniform tables are initialised.
    RectAreaLightUniformsLib.init()
  }, [])

  return (
    <>
      {/*
        The world, standing in for Blender's environment light.

        This was a flat white 0.11 while the venue's world is a green-black at
        strength 1.5 - twelve times too strong and the wrong colour. Ambient is
        the one light nothing can occlude, so all of that excess was contrast
        removed from every surface at once, and it is why the browser and the
        lookdev never showed the same room. Both numbers come from the rig now.
      */}
      <ambientLight color={ambient.colour} intensity={ambient.intensity} />
      {lights.map((light) =>
        light.kind === 'spot' ? (
          <CasterLight key={light.name} light={light} />
        ) : (
          <AreaLight key={light.name} light={light} />
        ),
      )}
    </>
  )
}

function Scene({
  seatIds,
  seatRefs,
  venueId,
  cues = [],
  occupiedSeats,
  seatChips = [],
  heroSeat,
  reviewSeat,
}: SceneProps) {
  const [sidecar, setSidecar] = useState<LightingSidecar>({})

  useEffect(() => {
    let cancelled = false
    void loadLightingSidecar().then((loaded) => {
      if (!cancelled) setSidecar(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const rig = sidecar[venueId]
  const lights = useMemo(() => toSceneLights(rig), [rig])
  const worldColour = worldColourOf(rig)
  const ambient = useMemo(() => ambientFor(rig), [rig])

  return (
    <>
      <color attach="background" args={[worldColour]} />
      <VenueLights lights={lights} ambient={ambient} />
      <Suspense fallback={null}>
        <VenueAsset venueId={venueId} cues={cues} occupiedSeats={occupiedSeats} />
      </Suspense>
      <InstancedTablePieces seatChips={seatChips} />
      <Seats seatIds={seatIds} seatRefs={seatRefs} venueId={venueId} />
      <CameraOrbit venueId={venueId} heroSeat={heroSeat ?? null} reviewSeat={reviewSeat ?? null} />
    </>
  )
}

export function RiverScene({
  seatIds,
  seatRefs,
  venueId,
  cues = [],
  occupiedSeats,
  seatChips,
  heroSeat,
  reviewSeat,
}: SceneProps) {
  const venue = venueOf(venueId)
  return (
    <Canvas
      key={venueId}
      className="river-venue"
      camera={{
        fov: venue.camera.fov,
        position: cameraPlacement(venue).position,
      }}
      dpr={[1, 1.5]}
      // The stage is a fixed 1920x1080 box scaled to fit the window, and the
      // measured rectangle comes back already scaled. Sizing from that lays the
      // canvas out smaller than the box it sits in, so the venue stops short of
      // two edges and every seat label - positioned as a percent of the full
      // box - drifts away from the player it belongs to. offsetWidth ignores
      // transforms, which is the size we actually want.
      resize={{ offsetSize: true }}
      onCreated={(state) => {
        // The scene is only judged in a browser, and four separate attempts to
        // measure it failed because there was nothing to read it from. This is
        // the instrument: camera, controls and scene graph, in development.
        if (window.location.pathname.startsWith('/dev/')) {
          Object.assign(window, {
            riverScene: state,
            // The rendered frame, as numbers. Every visual judgement on this
            // project so far has been made against Blender or against the
            // asset bytes, and two confident wrong answers came out of that -
            // linear base colours read as sRGB, and rect-area nits compared
            // against spot candela. Neither survives a look at actual pixels.
            //
            // The render and the read have to sit in one synchronous block.
            // The context is created without preserveDrawingBuffer, so the
            // buffer is valid until the browser composites and empty after -
            // reading it a tick later returns black, which reads exactly like
            // a scene that failed to draw.
            riverFrame: (samples = 480) => {
              state.gl.render(state.scene, state.camera)
              const source = state.gl.domElement
              const height = Math.max(1, Math.round((samples * source.height) / source.width))
              const surface = document.createElement('canvas')
              surface.width = samples
              surface.height = height
              const context = surface.getContext('2d')
              if (context === null) return null
              context.drawImage(source, 0, 0, samples, height)
              const { data } = context.getImageData(0, 0, samples, height)
              return frameMetrics(data, samples, height, TABLE_REGIONS)
            },
          })
        }
      }}
      gl={{
        antialias: true,
        powerPreference: 'high-performance',
        // The lookdev renders through AgX, and every venue was signed off on
        // that curve. ACES pushes saturation and clips sooner, which is why the
        // browser read as a magenta room with a blown-out floor while the same
        // rig looked correct in Blender. Matching the transform is not a tweak,
        // it is the difference between judging the same picture or two.
        toneMapping: THREE.AgXToneMapping,
        toneMappingExposure: 1,
      }}
      shadows
    >
      <Scene
        seatIds={seatIds}
        seatRefs={seatRefs}
        venueId={venueId}
        cues={cues}
        occupiedSeats={occupiedSeats}
        seatChips={seatChips}
        heroSeat={heroSeat}
        reviewSeat={reviewSeat}
      />
    </Canvas>
  )
}

for (const id of VENUE_ORDER) useGLTF.preload(venueOf(id).asset)

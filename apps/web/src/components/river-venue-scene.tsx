'use client'

import { OrbitControls, useGLTF } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { denominations, projectToScreen, type ScreenCamera, stackLayout } from '@river/engine'
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
import {
  type OrbitControls as OrbitControlsImpl,
  RectAreaLightUniformsLib,
  SkeletonUtils,
} from 'three-stdlib'
import {
  type AnimationCue,
  BLEND,
  CLIP_FPS,
  CLIPS,
  type ClipName,
  IDLE_CLIP,
  idleCueFor,
  idlePhaseFor,
  missingClips,
} from '@/lib/animation'
import { freshAsset } from '@/lib/asset-url'
import { frameMetrics, TABLE_REGIONS } from '@/lib/frame-metrics'
import {
  ambientFor,
  type LightingSidecar,
  loadLightingSidecar,
  type SceneLight,
  toSceneLights,
  worldColourOf,
} from '@/lib/lighting'
import { ACCENT_MATERIAL, accentFor } from '@/lib/seat-accents'
import {
  advance,
  applyCue,
  endHand,
  initialSeat,
  poseOf,
  type SeatState,
  syncOccupancy,
} from '@/lib/seat-motion'
import { chairBackAway } from '@/lib/seat-transition-timing'
import {
  cameraPlacement,
  FELT_LIGHT_REACH,
  ORBIT_POLAR_DEGREES,
  SEAT_SLOTS,
  seatCameraAzimuth,
  TABLE_SURFACE_HEIGHT,
  VENUE_ORDER,
  type Venue,
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
  /** The local player's seat. The opening camera starts behind it, and he keeps the accepted look. */
  heroSeat?: number | null | undefined
  /**
   * Counts hands that have finished.
   *
   * A player who stood up for an all-in sits back down when the hand is over, and this is
   * how the table says so. A count rather than a flag: two hands ending is two events, and
   * a boolean that is already true says nothing the second time.
   */
  handSerial?: number | undefined
  /** Dev-review seat framed from inside the table for a face-side close read. */
  reviewSeat?: number | null | undefined
  /** Empty seats the local player may take; hovering one lights its chair. */
  sittableSeats?: readonly number[] | undefined
  onSit?: ((seat: number) => void) | undefined
}

/**
 * Where each seat's markers are pinned in the world.
 *
 * Two anchors per seat: the chair, for the thing a player aims at to sit down,
 * and a point just above the head, for the action pin, the turn clock and the
 * Tab plate. Both come from the loaded venue rather than from a formula. The
 * chairs are named nodes and each character carries its seat number, so a
 * marker is attached to the object it labels and stays attached through an
 * orbit. The ellipse in worldSeats is only the fallback while the venue loads.
 */
export interface SeatAnchors {
  /** World points, fixed at load: chairs do not move. */
  chairs: Map<number, THREE.Vector3>
  heads: Map<number, THREE.Object3D>
  /** The chair nodes themselves, for hover and glow. */
  chairObjects: Map<number, THREE.Object3D>
}

/**
 * How far below a chair's highest point its sit target sits.
 *
 * The target used to be the seat cushion at 0.46m. From the default camera the
 * two chairs behind the table have their cushions hidden by the tabletop, so
 * their targets landed on the felt and hovering the table offered a seat. The
 * top of a chair is the part visible from every orbit angle, and taking it from
 * each chair's own bounds means a backless stool in another venue gets its seat
 * rather than a point in the air where a backrest would be.
 */
const CHAIR_TOP_INSET = 0.14
/** From the head bone to just above the crown, so a pin's tail meets the hair. */
const HEAD_CLEARANCE = 0.26
/** A seated head above the floor, for an occupied seat with no rig to ask. */
const SEATED_HEAD_HEIGHT = 1.16

function shownInScene(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node !== null; node = node.parent) {
    if (!node.visible) return false
  }
  return true
}

function Seats({
  seatIds,
  seatRefs,
  venueId,
  anchors,
}: SceneProps & { anchors: RefObject<SeatAnchors | null> }) {
  const venue = venueOf(venueId)
  const seats = useMemo(() => worldSeats(seatIds, venue.seatRing), [seatIds, venue.seatRing])
  const { camera, controls } = useThree()
  const focus = useMemo(() => new THREE.Vector3(), [])
  const scratch = useMemo(() => new THREE.Vector3(), [])

  // Leaving 3D must not strand a hidden seat or a projected position on an
  // element the 2D renderer is about to lay out for itself.
  useEffect(() => {
    const refs = seatRefs.current
    return () => {
      for (const element of refs.values()) {
        element.style.removeProperty('visibility')
        for (const name of ['--seat-x', '--seat-y', '--chair-x', '--chair-y', '--stem']) {
          element.style.removeProperty(name)
        }
      }
    }
  }, [seatRefs])

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
    const found = anchors.current
    // The index here is the seat number: the table passes ids in seat order.
    // It used to pass them rotated so the local player came first, which put
    // every marker and chip stack one or more chairs away from its player as
    // soon as anyone sat anywhere but seat zero.
    seats.forEach((seat, index) => {
      const element = seatRefs.current.get(seat.id)
      if (element === undefined) return
      // Seat n sits in chair n + 1. Slot zero of the nine-slot ring is the
      // dealer's, the same offset worldSeats applies to its angle.
      const chair = found?.chairs.get((index + 1) % SEAT_SLOTS)
      const chairPoint = chair ?? { x: seat.x, y: 0.8, z: seat.z }
      const chairScreen = projectToScreen(
        { x: chairPoint.x, y: chairPoint.y, z: chairPoint.z },
        spec,
      )
      let head = { x: chairPoint.x, y: SEATED_HEAD_HEIGHT, z: chairPoint.z }
      const bone = found?.heads.get(index)
      const rigged = bone !== undefined && shownInScene(bone)
      if (bone !== undefined && rigged) {
        bone.getWorldPosition(scratch)
        head = { x: scratch.x, y: scratch.y + HEAD_CLEARANCE, z: scratch.z }
      }
      const headScreen = projectToScreen(head, spec)
      // A point behind the camera projects to a plausible coordinate on the
      // wrong side of the screen. Set directly rather than through a class:
      // several seat states already own opacity.
      element.style.visibility = headScreen.behind && chairScreen.behind ? 'hidden' : 'visible'
      element.style.setProperty('--seat-x', `${headScreen.xPercent}%`)
      element.style.setProperty('--seat-y', `${headScreen.yPercent}%`)
      element.style.setProperty('--chair-x', `${chairScreen.xPercent}%`)
      element.style.setProperty('--chair-y', `${chairScreen.yPercent}%`)
      // A pin over a seat with no body in it floats in the air, so it gets a stem
      // down to its chair. A seat with a rig has a head under the pin already.
      element.style.setProperty(
        '--stem',
        rigged ? '0' : `${Math.max(0, chairScreen.yPercent - headScreen.yPercent)}`,
      )
    })
  })

  return <group />
}

const NO_SEATS: readonly number[] = []

/**
 * The glow on a chair you can sit in.
 *
 * The sit target used to be a disc of HUD over the chair with a buy-in on it.
 * The chair itself is the target now: point at an empty chair you can afford
 * and it lights green, press it and you sit. Only the chairs of sittable seats
 * are raycast, and only while the pointer is over the canvas, so the cost is a
 * handful of low-poly chairs rather than the whole venue on every move.
 */
const CHAIR_GLOW = new THREE.Color('#5fd08e')
const CHAIR_GLOW_INTENSITY = 0.42
/** A press that travels further than this is an orbit drag, not a click. */
const CLICK_SLOP = 6

function withinObject(node: THREE.Object3D | null, ancestor: THREE.Object3D): boolean {
  for (let current = node; current !== null; current = current.parent) {
    if (current === ancestor) return true
  }
  return false
}

function glowChair(chair: THREE.Object3D | undefined, on: boolean): void {
  chair?.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return
    if (node.userData.riverBaseMaterial === undefined)
      node.userData.riverBaseMaterial = node.material
    const base = node.userData.riverBaseMaterial as THREE.Material | THREE.Material[]
    if (!on) {
      node.material = base
      return
    }
    // Chairs share materials, so the glow is a clone per mesh; lighting the
    // shared material would light every chair in the room.
    if (node.userData.riverGlowMaterial === undefined) {
      const lit = (material: THREE.Material) => {
        const clone = material.clone()
        if (clone instanceof THREE.MeshStandardMaterial) {
          clone.emissive = CHAIR_GLOW.clone()
          clone.emissiveIntensity = CHAIR_GLOW_INTENSITY
        }
        return clone
      }
      node.userData.riverGlowMaterial = Array.isArray(base) ? base.map(lit) : lit(base)
    }
    node.material = node.userData.riverGlowMaterial as THREE.Material | THREE.Material[]
  })
}

function ChairHighlight({
  anchors,
  sittableSeats,
  onSit,
}: {
  anchors: RefObject<SeatAnchors | null>
  sittableSeats: readonly number[]
  onSit: ((seat: number) => void) | undefined
}) {
  const { camera, gl, pointer } = useThree()
  const raycaster = useMemo(() => new THREE.Raycaster(), [])
  const lit = useRef<number | null>(null)
  const inside = useRef(false)
  const latest = useRef({ sittableSeats, onSit })
  latest.current = { sittableSeats, onSit }

  useEffect(() => {
    const canvas = gl.domElement
    let pressed: { x: number; y: number } | null = null
    const enter = () => {
      inside.current = true
    }
    const leave = () => {
      inside.current = false
    }
    const press = (event: PointerEvent) => {
      pressed = { x: event.clientX, y: event.clientY }
    }
    const release = (event: PointerEvent) => {
      const start = pressed
      pressed = null
      if (start === null) return
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP) return
      const seat = lit.current
      if (seat !== null && latest.current.sittableSeats.includes(seat)) latest.current.onSit?.(seat)
    }
    canvas.addEventListener('pointerenter', enter)
    canvas.addEventListener('pointermove', enter)
    canvas.addEventListener('pointerleave', leave)
    canvas.addEventListener('pointerdown', press)
    canvas.addEventListener('pointerup', release)
    return () => {
      canvas.removeEventListener('pointerenter', enter)
      canvas.removeEventListener('pointermove', enter)
      canvas.removeEventListener('pointerleave', leave)
      canvas.removeEventListener('pointerdown', press)
      canvas.removeEventListener('pointerup', release)
      canvas.style.cursor = ''
    }
  }, [gl])

  useFrame(() => {
    const found = anchors.current
    const sittable = latest.current.sittableSeats
    let next: number | null = null
    if (found !== null && sittable.length > 0 && inside.current) {
      const chairs = sittable.flatMap((seat) => {
        const chair = found.chairObjects.get((seat + 1) % SEAT_SLOTS)
        return chair === undefined ? [] : [{ seat, chair }]
      })
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObjects(
        chairs.map((entry) => entry.chair),
        true,
      )[0]
      if (hit !== undefined) {
        next = chairs.find((entry) => withinObject(hit.object, entry.chair))?.seat ?? null
      }
    }
    if (next === lit.current) return
    if (lit.current !== null)
      glowChair(found?.chairObjects.get((lit.current + 1) % SEAT_SLOTS), false)
    if (next !== null) glowChair(found?.chairObjects.get((next + 1) % SEAT_SLOTS), true)
    lit.current = next
    gl.domElement.style.cursor = next === null ? '' : 'pointer'
  })

  return null
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

/** One seat's instanced character: his own skeleton, mixer, actions and lapel colour. */
interface CastSeat {
  seat: number
  body: THREE.Object3D
  head: THREE.Object3D | undefined
  mixer: THREE.AnimationMixer
  actions: Map<ClipName, THREE.AnimationAction>
  accentTargets: { mesh: THREE.Mesh; slot: number; original: THREE.Material }[]
  accents: Map<string, THREE.Material>
  chair: THREE.Object3D | undefined
  chairBase: THREE.Vector3
  /** Away from the table, which is the way a chair is pushed to stand up. */
  outward: THREE.Vector3
  /** The anchor's world scale, so a chair track authored in his units lands in metres. */
  scale: number
  backAway: number
}

/** Enough emission that a lapel colour reads from the gameplay camera. */
const ACCENT_EMISSIVE = 0.35
/**
 * How quickly a chair catches up with its track.
 *
 * The tracks are continuous inside a clip, but the runtime cuts between them - a leave
 * begins with the chair already in, a player sitting down finds it already out - and a cut
 * of 350mm reads as a chair teleporting. Short enough to look pushed, long enough to
 * absorb the cut.
 */
const CHAIR_FOLLOW_SECONDS = 0.08

function seatState(states: Map<number, SeatState>, seat: number, occupied: boolean): SeatState {
  const held = states.get(seat)
  if (held !== undefined) return held
  const made = initialSeat(occupied)
  states.set(seat, made)
  return made
}

/**
 * The local player keeps the accepted look; every opponent gets a colour of his own, on his
 * own copy of the material. Recolouring the shared one would recolour the whole table.
 */
function applyAccents(cast: readonly CastSeat[], heroSeat: number | null): void {
  for (const entry of cast) {
    const accent = accentFor(entry.seat, heroSeat)
    for (const target of entry.accentTargets) {
      let material = target.original
      if (accent !== null) {
        const held = entry.accents.get(accent.name)
        if (held !== undefined) material = held
        else {
          const coloured = target.original.clone()
          coloured.name = `${ACCENT_MATERIAL} ${accent.name}`
          if (coloured instanceof THREE.MeshStandardMaterial) {
            coloured.color = new THREE.Color(accent.hex)
            coloured.emissive = new THREE.Color(accent.hex)
            coloured.emissiveIntensity = ACCENT_EMISSIVE
          }
          entry.accents.set(accent.name, coloured)
          material = coloured
        }
      }
      if (Array.isArray(target.mesh.material)) target.mesh.material[target.slot] = material
      else target.mesh.material = material
    }
  }
  if (process.env.NODE_ENV !== 'production') {
    // Two seats sharing one material instance is the failure this is written against: it
    // looks right until a colour changes and eight men change with it.
    const owner = new Map<string, number>()
    for (const entry of cast) {
      for (const target of entry.accentTargets) {
        const material = Array.isArray(target.mesh.material)
          ? target.mesh.material[target.slot]
          : target.mesh.material
        if (material === undefined) continue
        const seen = owner.get(material.uuid)
        if (seen !== undefined && seen !== entry.seat) {
          console.warn(
            `river: seats ${seen} and ${entry.seat} share one lapel material, so colouring one colours both`,
          )
        }
        owner.set(material.uuid, entry.seat)
      }
    }
  }
}

/**
 * The characters, instanced into the venue's seat anchors.
 *
 * The venue used to carry nine bodies baked into its own file, with one clip set and every
 * copy sharing bone names, which is why the old path had to retarget clips per seat by bone
 * index. This loads the character once and clones him per anchor instead: each seat gets its
 * own skeleton, its own mixer and its own copy of the material its lapels are coloured
 * through, so eight players are eight bodies and not one body playing everybody's gestures.
 *
 * Every clip except the layered chip push is driven frame by frame from seat-motion rather
 * than left to the mixer's clock, so what the state machine thinks a seat is doing and what
 * is on screen cannot drift apart.
 */
function SilverCast({
  venue,
  scene,
  cues,
  occupiedSeats,
  heroSeat,
  handSerial,
  anchors,
}: {
  venue: Venue
  scene: THREE.Object3D
  cues: readonly AnimationCue[]
  occupiedSeats: readonly number[] | undefined
  heroSeat: number | null
  handSerial: number
  anchors: RefObject<SeatAnchors | null>
}) {
  const cast = useGLTF(freshAsset(venue.cast ?? ''))
  const seats = useRef<CastSeat[]>([])
  const states = useRef<Map<number, SeatState>>(new Map())
  const pending = useRef<{ seat: number; clip: ClipName; at: number }[]>([])
  const clock = useRef(0)
  const hand = useRef(handSerial)
  // Read when the cast is built, so a new seat is coloured at once without rebuilding
  // eight characters every time somebody sits down.
  const hero = useRef(heroSeat)
  hero.current = heroSeat

  useLayoutEffect(() => {
    const clipByName = new Map(cast.animations.map((clip) => [clip.name, clip]))
    const absent = missingClips([...clipByName.keys()])
    // One additive copy per layered clip, shared by every seat: makeClipAdditive rewrites a
    // clip in place, and anything that replaces the idle needs the original.
    const prepared = new Map<ClipName, THREE.AnimationClip>()
    for (const name of CLIPS) {
      const source = clipByName.get(name)
      if (source === undefined) continue
      if (BLEND[name] !== 'additive') {
        prepared.set(name, source)
        continue
      }
      const layered = source.clone()
      THREE.AnimationUtils.makeClipAdditive(layered)
      prepared.set(name, layered)
    }

    scene.updateMatrixWorld(true)
    const found: THREE.Object3D[] = []
    scene.traverse((object) => {
      if (
        object.userData?.riverCast === 'native_silver' &&
        typeof object.userData?.seatIndex === 'number'
      ) {
        found.push(object)
      }
    })
    const built: CastSeat[] = []
    for (const anchor of found) {
      const seat = anchor.userData.seatIndex as number
      const body = SkeletonUtils.clone(cast.scene)
      body.name = `silver_seat_${seat}`
      anchor.add(body)
      const mixer = new THREE.AnimationMixer(body)
      const actions = new Map<ClipName, THREE.AnimationAction>()
      for (const [name, clip] of prepared) {
        const action = mixer.clipAction(clip)
        action.enabled = false
        action.setEffectiveWeight(0)
        if (name === IDLE_CLIP) {
          action.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY)
          action.play()
          action.time = idlePhaseFor(seat)
          actions.set(name, action)
          continue
        }
        action.setLoop(THREE.LoopOnce, 1)
        action.clampWhenFinished = true
        if (BLEND[name] === 'additive') action.blendMode = THREE.AdditiveAnimationBlendMode
        action.play()
        action.paused = true
        actions.set(name, action)
      }
      let head: THREE.Object3D | undefined
      const accentTargets: CastSeat['accentTargets'] = []
      body.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return
        child.receiveShadow = true
        if (head === undefined && child instanceof THREE.SkinnedMesh) {
          head = child.skeleton.bones.find((bone) => /^head(_\d+)?$/.test(bone.name))
        }
        const materials = Array.isArray(child.material) ? child.material : [child.material]
        materials.forEach((material, slot) => {
          if (material.name === ACCENT_MATERIAL) {
            accentTargets.push({ mesh: child, slot, original: material })
          }
        })
      })
      const chair = scene.getObjectByName(`${venue.id}_chair_${(seat + 1) % SEAT_SLOTS}`)
      const chairBase = chair?.position.clone() ?? new THREE.Vector3()
      const worldScale = new THREE.Vector3()
      anchor.getWorldScale(worldScale)
      built.push({
        seat,
        body,
        head,
        mixer,
        actions,
        accentTargets,
        accents: new Map(),
        chair,
        chairBase,
        outward: new THREE.Vector3(chairBase.x, 0, chairBase.z).normalize(),
        scale: worldScale.x,
        backAway: 0,
      })
    }
    built.sort((left, right) => left.seat - right.seat)
    seats.current = built
    applyAccents(built, hero.current)
    if (process.env.NODE_ENV !== 'production') {
      // Both of these have already shipped as silent nothings on this project: a venue with
      // no clips, and clips bound to nothing.
      if (absent.length > 0) console.warn(`river: the cast is missing ${absent.join(', ')}`)
      if (built.length === 0) {
        console.warn(`river: ${venue.name} carries no seat anchors, so nobody is seated`)
      }
      if (built.some((entry) => entry.accentTargets.length === 0)) {
        console.warn(`river: no ${ACCENT_MATERIAL} to colour, so every opponent looks the same`)
      }
      Object.assign(window, {
        riverCast: {
          seats: built.map((entry) => entry.seat),
          clips: [...prepared.keys()],
          missing: absent,
          chairs: built.map((entry) => entry.chair?.name ?? null),
          accentTargets: built.map((entry) => entry.accentTargets.length),
        },
        // The instruments this scene is judged with. Every visual claim about the
        // characters so far has been made against Blender or against the asset bytes, and
        // the browser is where they actually play: riverPlay puts a clip on a seat the way
        // a room event would, and riverSeats says what each seat is doing and where its
        // chair is. Development only.
        riverPlay: (seat: number, clip: ClipName) => {
          pending.current.push({ seat, clip, at: clock.current })
          return `${clip} queued for seat ${seat}`
        },
        riverSeats: () =>
          seats.current.map((entry) => {
            const state = states.current.get(entry.seat)
            const pose = state === undefined ? null : poseOf(state, clock.current)
            return {
              seat: entry.seat,
              phase: state?.phase ?? 'unknown',
              visible: entry.body.visible,
              body: pose?.body === null ? null : pose?.body,
              overlay: pose?.overlay === null ? null : pose?.overlay,
              idleWeight: pose?.idleWeight ?? null,
              chairBackAway: Number(entry.backAway.toFixed(4)),
              accent: accentFor(entry.seat, hero.current)?.name ?? 'none',
            }
          }),
      })
    }
    return () => {
      for (const entry of seats.current) {
        entry.mixer.stopAllAction()
        entry.body.removeFromParent()
        entry.chair?.position.copy(entry.chairBase)
        anchors.current?.heads.delete(entry.seat)
      }
      seats.current = []
      states.current = new Map()
      pending.current = []
    }
  }, [cast.animations, cast.scene, scene, venue.id, venue.name, anchors])

  useEffect(() => {
    applyAccents(seats.current, heroSeat)
  }, [heroSeat])

  // Cues are queued against the same clock that drives the clips, so a staggered peek
  // lands where it was asked for rather than where a timer happened to fire.
  useEffect(() => {
    for (const cue of cues) {
      if (cue.clip === IDLE_CLIP) continue
      pending.current.push({ seat: cue.seat, clip: cue.clip, at: clock.current + cue.delaySeconds })
    }
  }, [cues])

  useEffect(() => {
    if (handSerial === hand.current) return
    hand.current = handSerial
    for (const entry of seats.current) {
      const occupied = occupiedSeats === undefined || occupiedSeats.includes(entry.seat)
      states.current.set(
        entry.seat,
        endHand(seatState(states.current, entry.seat, occupied), clock.current),
      )
    }
  }, [handSerial, occupiedSeats])

  useFrame((_, delta) => {
    clock.current += delta
    const now = clock.current
    const due = pending.current.filter((entry) => entry.at <= now)
    if (due.length > 0) {
      pending.current = pending.current.filter((entry) => entry.at > now)
      for (const entry of due) {
        const occupied = occupiedSeats === undefined || occupiedSeats.includes(entry.seat)
        states.current.set(
          entry.seat,
          applyCue(seatState(states.current, entry.seat, occupied), entry.clip, now),
        )
      }
    }
    for (const entry of seats.current) {
      const occupied = occupiedSeats === undefined || occupiedSeats.includes(entry.seat)
      const state = advance(
        syncOccupancy(seatState(states.current, entry.seat, occupied), occupied, now),
        now,
      )
      states.current.set(entry.seat, state)
      const pose = poseOf(state, now)
      entry.body.visible = pose.visible
      for (const [name, action] of entry.actions) {
        const weight =
          name === IDLE_CLIP
            ? pose.idleWeight
            : pose.body?.clip === name
              ? pose.body.weight
              : pose.release?.clip === name
                ? pose.release.weight
                : pose.overlay?.clip === name
                  ? pose.overlay.weight
                  : 0
        action.enabled = weight > 0
        action.setEffectiveWeight(weight)
        if (name === IDLE_CLIP) continue
        const frame =
          pose.body?.clip === name
            ? pose.body.frame
            : pose.release?.clip === name
              ? pose.release.frame
              : pose.overlay?.clip === name
                ? pose.overlay.frame
                : null
        if (frame !== null) action.time = frame / CLIP_FPS
      }
      entry.mixer.update(delta)
      const target = pose.chair === null ? 0 : chairBackAway(pose.chair.clip, pose.chair.frame)
      entry.backAway += (target - entry.backAway) * (1 - Math.exp(-delta / CHAIR_FOLLOW_SECONDS))
      entry.chair?.position
        .copy(entry.chairBase)
        .addScaledVector(entry.outward, entry.backAway * entry.scale)
      const found = anchors.current
      if (
        entry.head !== undefined &&
        found !== null &&
        found.heads.get(entry.seat) !== entry.head
      ) {
        found.heads.set(entry.seat, entry.head)
      }
    }
  })

  return null
}

/** The plaque and the stage, as percentages of the 1920 by 1080 design box. */

function VenueAsset({
  venueId,
  cues,
  occupiedSeats,
  heroSeat,
  handSerial,
  anchors,
}: {
  venueId: VenueId
  cues: readonly AnimationCue[]
  occupiedSeats: readonly number[] | undefined
  heroSeat: number | null
  handSerial: number
  anchors: RefObject<SeatAnchors | null>
}) {
  const venue = venueOf(venueId)
  const asset = useGLTF(freshAsset(venue.asset))
  const mixers = useRef<THREE.AnimationMixer[]>([])
  const actions = useRef<Map<string, THREE.AnimationAction>>(new Map())

  // Chairs are named <venue>_chair_<n>; the first node to claim a number wins,
  // so a parent is used rather than a mesh child the loader renamed. The head
  // comes from each character's skeleton rather than a scene search, because a
  // glTF bone is not required to sit under the root that owns the skin.
  useLayoutEffect(() => {
    const chairs = new Map<number, THREE.Vector3>()
    const heads = new Map<number, THREE.Object3D>()
    const chairObjects = new Map<number, THREE.Object3D>()
    asset.scene.updateMatrixWorld(true)
    const bounds = new THREE.Box3()
    asset.scene.traverse((object) => {
      const chair = /chair_(\d+)$/.exec(object.name)
      if (chair !== null && !chairs.has(Number(chair[1]))) {
        bounds.setFromObject(object)
        chairObjects.set(Number(chair[1]), object)
        const centre = bounds.getCenter(new THREE.Vector3())
        chairs.set(
          Number(chair[1]),
          new THREE.Vector3(centre.x, bounds.max.y - CHAIR_TOP_INSET, centre.z),
        )
      }
      const seat = object.userData?.seatIndex
      if (typeof seat !== 'number' || heads.has(seat)) return
      object.traverse((child) => {
        if (heads.has(seat) || !(child instanceof THREE.SkinnedMesh)) return
        const head = child.skeleton.bones.find((bone) => /^head(_\d+)?$/.test(bone.name))
        if (head !== undefined) heads.set(seat, head)
      })
    })
    anchors.current = { chairs, heads, chairObjects }
    return () => {
      anchors.current = null
    }
  }, [asset.scene, anchors])

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
    // A venue with a cast has no bodies of its own: SilverCast owns their mixers, their
    // clips and which seats are shown.
    if (venue.cast !== undefined) return
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
        // Everything except the idle plays additively over it. Absolute clips overwrite
        // whatever the base layer was doing, so a chip push froze the character's
        // breathing for its whole length and then snapped back. makeClipAdditive
        // rewrites a clip as a delta from its own first frame, and the pipeline authors
        // every clip starting at the seated rest, so frame zero is exactly the pose the
        // idle is already moving around.
        const isIdle = clip.name === IDLE_CLIP
        if (!isIdle) THREE.AnimationUtils.makeClipAdditive(targeted.clip)
        const action = mixer.clipAction(targeted.clip)
        if (!isIdle) action.blendMode = THREE.AdditiveAnimationBlendMode
        actions.current.set(seatClipKey(rig.seat, clip.name), action)
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
  }, [asset.animations, asset.scene, venue.name, venue.cast])

  useLayoutEffect(() => {
    // Hide the baked character for any seat nobody is sitting in. The chair
    // stays: an empty chair is set dressing, an empty seat with a body in it is
    // a lie about who is at the table.
    if (venue.cast !== undefined) return
    asset.scene.traverse((object) => {
      const seat = object.userData?.seatIndex
      if (typeof seat !== 'number') return
      object.visible = occupiedSeats === undefined || occupiedSeats.includes(seat)
    })
  }, [asset.scene, occupiedSeats, venue.cast])

  // The base layer, started once when the clips bind and never restarted.
  //
  // It used to be a fallback - idles played only when there were no cues at all - so the
  // first action of the hand replaced the breathing rather than layering over it, and it
  // never came back. The idle now runs underneath continuously and actions are additive
  // on top, which is also why this cannot live in the cue effect: re-running that effect
  // would reset the breathing every time the table did anything.
  useEffect(() => {
    if (venue.cast !== undefined) return
    const timers: ReturnType<typeof setTimeout>[] = []
    for (const seat of seatIndexes) {
      const cue = idleCueFor(seat)
      const action = actions.current.get(seatClipKey(seat, cue.clip))
      if (action === undefined) continue
      const begin = () => {
        action.reset()
        action.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY)
        action.play()
      }
      // The stagger is the whole reason idlePhaseFor exists: nine characters breathing on
      // the same frame reads as a row of clones.
      if (cue.delaySeconds > 0) {
        timers.push(setTimeout(begin, cue.delaySeconds * 1000))
        continue
      }
      begin()
    }
    return () => {
      for (const timer of timers) clearTimeout(timer)
    }
  }, [venue.cast])

  useEffect(() => {
    // A cue names a seat, and only that seat's action may answer it. Matching
    // on clip name alone played one shared action nine times over, which is
    // eight no-ops and one character doing everybody's gestures.
    if (venue.cast !== undefined) return
    const timers: ReturnType<typeof setTimeout>[] = []
    const start = (cue: AnimationCue) => {
      const action = actions.current.get(seatClipKey(cue.seat, cue.clip))
      if (action === undefined) return
      action.reset()
      action.setLoop(cue.loop ? THREE.LoopRepeat : THREE.LoopOnce, Number.POSITIVE_INFINITY)
      action.clampWhenFinished = !cue.loop
      action.play()
    }
    for (const cue of cues) {
      // The idle is the base layer and owns its own lifetime above; a cue for it here
      // would restart the breathing mid-gesture.
      if (cue.clip === IDLE_CLIP) continue
      if (cue.delaySeconds > 0) {
        timers.push(setTimeout(() => start(cue), cue.delaySeconds * 1000))
        continue
      }
      start(cue)
    }
    return () => {
      for (const timer of timers) clearTimeout(timer)
    }
  }, [cues, venue.cast])

  // Advancing the mixers is the only per-frame cost, and it is skipped entirely
  // while there is nothing to advance.
  useFrame((_, delta) => {
    for (const mixer of mixers.current) mixer.update(delta)
  })

  return (
    <>
      <primitive object={asset.scene} />
      {venue.cast !== undefined ? (
        <SilverCast
          venue={venue}
          scene={asset.scene}
          cues={cues}
          occupiedSeats={occupiedSeats}
          heroSeat={heroSeat}
          handSerial={handSerial}
          anchors={anchors}
        />
      ) : null}
    </>
  )
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
    // Aim below the face so the proof keeps hair, neckline, hands and rail in one frame
    // instead of clipping the chin.
    //
    // These heights follow the pipeline's character scale, which moved from 0.73 to 0.92
    // once the characters actually sat down rather than standing at the table - see the
    // note on CHARACTER_SCALE in art/pipeline/build_assets.py. Everything above the 5cm
    // seat lift scales with it, so the aim rides up with the character instead of
    // pointing at his sternum.
    const seatLift = 0.05
    const scaleRatio = 0.92 / 0.73
    const rise = (height: number) => seatLift + (height - seatLift) * scaleRatio
    const target: [number, number, number] = [seat.x, rise(1.04), seat.z]
    const distance = 1.453 * scaleRatio
    const position: [number, number, number] = [
      seat.x + inwardX * distance,
      rise(1.14),
      seat.z + inwardZ * distance,
    ]
    return { position, target, distance }
  }, [reviewSeat, venue.seatRing])
  const activePlacement = reviewPlacement ?? placement
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

  useLayoutEffect(() => {
    if (controls.current === null) return
    camera.position.set(...activePlacement.position)
    controls.current.target.set(...activePlacement.target)
    controls.current.update()
  }, [activePlacement, camera])

  useEffect(() => {
    if (controls.current === null || heroSeat === null || reviewPlacement !== null) return
    controls.current.setAzimuthalAngle(seatCameraAzimuth(heroSeat, venue.seatRing))
    controls.current.update()
  }, [heroSeat, reviewPlacement, venue.seatRing])

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
      // Fixed distance in play: the game camera is a composition decision, not something
      // a player should be able to dolly out of. The review camera is a diagnosis tool
      // and needs the opposite - close enough to read a hairline, far enough to judge the
      // character against the chair and table.
      enableZoom={reviewPlacement !== null}
      zoomSpeed={0.7}
      minDistance={reviewPlacement === null ? activePlacement.distance : 0.45}
      maxDistance={reviewPlacement === null ? activePlacement.distance : 6.5}
      minPolarAngle={THREE.MathUtils.degToRad(ORBIT_POLAR_DEGREES.min)}
      maxPolarAngle={THREE.MathUtils.degToRad(ORBIT_POLAR_DEGREES.max)}
      target={activePlacement.target}
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

/**
 * The dusk sky behind the Rooftop.
 *
 * `scene.background` takes a single colour, read from the Blender world in
 * lighting.json. That is honest at night and it is also nothing to look at: the
 * top half of the frame is one flat near-black rectangle, and the menu backdrop
 * - a rendered still, which can afford a gradient - had a sunset while the room
 * you actually sit in did not.
 *
 * A dome rather than a background texture, because a 2D background is stretched
 * to the viewport and shears as the camera orbits, while a sphere is stable and
 * costs one draw call of eight hundred triangles. It sits at 220m, well outside
 * the 26m skyline, writes no depth and renders first, so nothing in the room has
 * to know about it.
 *
 * Interiors keep the flat colour. A sunset through the Laundromat ceiling would
 * be a bug, so this is keyed by venue rather than applied to all three.
 */
const SKY: Partial<Record<VenueId, { low: string; band: string; hot: string; high: string }>> = {
  // The same ramp the menu still uses, so the front door and the table agree on
  // what time of day it is.
  rooftop: { low: '#0a0b16', band: '#3b1d24', hot: '#b85f2b', high: '#12121d' },
}

function SunsetSky({ venueId }: { venueId: VenueId }) {
  const palette = SKY[venueId]
  const material = useMemo(() => {
    if (palette === undefined) return null
    return new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uLow: { value: new THREE.Color(palette.low) },
        uBand: { value: new THREE.Color(palette.band) },
        uHot: { value: new THREE.Color(palette.hot) },
        uHigh: { value: new THREE.Color(palette.high) },
      },
      vertexShader: `
        varying vec3 vWorld;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: `
        uniform vec3 uLow;
        uniform vec3 uBand;
        uniform vec3 uHot;
        uniform vec3 uHigh;
        varying vec3 vWorld;
        void main() {
          float h = clamp(normalize(vWorld).y * 0.5 + 0.5, 0.0, 1.0);
          // Horizon glow low in frame, cooling upward. smoothstep rather than
          // mix so the warm band has an edge to it and does not wash the whole
          // sky orange.
          // Bands widened after looking at it in the room rather than in
          // isolation. The play camera pitches 73.5 degrees down, so the only
          // sky in frame is a shallow strip above the parapet and between the
          // skyline towers; a band that faded out by h=0.6 put the whole of that
          // strip in the dark part of the ramp and only showed colour through
          // two tower gaps.
          vec3 colour = mix(uLow, uBand, smoothstep(0.40, 0.50, h));
          colour = mix(colour, uHot, smoothstep(0.48, 0.56, h) * (1.0 - smoothstep(0.62, 0.78, h)));
          colour = mix(colour, uHigh, smoothstep(0.74, 0.97, h));
          // A gradient across a thousand pixels of near-black bands visibly on
          // an 8-bit display. A sub-LSB of ordered noise costs nothing and
          // removes it.
          float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
          colour += (dither - 0.5) / 255.0;
          gl_FragColor = vec4(colour, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    })
  }, [palette])

  useEffect(() => () => material?.dispose(), [material])
  if (material === null) return null
  return (
    <mesh renderOrder={-1} frustumCulled={false} material={material}>
      <sphereGeometry args={[220, 32, 16]} />
    </mesh>
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
  handSerial = 0,
  reviewSeat,
  sittableSeats = NO_SEATS,
  onSit,
}: SceneProps) {
  const [sidecar, setSidecar] = useState<LightingSidecar>({})
  const anchors = useRef<SeatAnchors | null>(null)

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
      <SunsetSky venueId={venueId} />
      <VenueLights lights={lights} ambient={ambient} />
      <Suspense fallback={null}>
        <VenueAsset
          venueId={venueId}
          cues={cues}
          occupiedSeats={occupiedSeats}
          heroSeat={heroSeat ?? null}
          handSerial={handSerial}
          anchors={anchors}
        />
      </Suspense>
      <InstancedTablePieces seatChips={seatChips} />
      <Seats seatIds={seatIds} seatRefs={seatRefs} venueId={venueId} anchors={anchors} />
      <ChairHighlight anchors={anchors} sittableSeats={sittableSeats} onSit={onSit} />
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
  handSerial,
  reviewSeat,
  sittableSeats,
  onSit,
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
        //
        // Gated on the build rather than on the path. It used to require a
        // /dev/ route, which meant the one scene nobody could measure was the
        // actual table - the place the characters animate, the lighting is
        // real and the camera is the player's. A hand was dealt with a bot
        // seated and visible and there was still no way to ask whether a single
        // bone had moved. Production is untouched.
        if (process.env.NODE_ENV !== 'production') {
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
        handSerial={handSerial}
        reviewSeat={reviewSeat}
        sittableSeats={sittableSeats}
        onSit={onSit}
      />
    </Canvas>
  )
}

for (const id of VENUE_ORDER) {
  const venue = venueOf(id)
  useGLTF.preload(freshAsset(venue.asset))
  if (venue.cast !== undefined) useGLTF.preload(freshAsset(venue.cast))
}

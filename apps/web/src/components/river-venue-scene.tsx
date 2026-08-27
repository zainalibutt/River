'use client'

import { OrbitControls, useGLTF } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { layOutPlaques, projectToScreen, type ScreenCamera } from '@river/engine'
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
  TABLE_SURFACE_HEIGHT,
  VENUE_ORDER,
  type VenueId,
  venueOf,
  verticalFov,
  worldSeats,
} from '@/lib/venue'

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

function InstancedTablePieces() {
  const chips = useRef<THREE.InstancedMesh>(null)
  const cards = useRef<THREE.InstancedMesh>(null)
  const matrix = useMemo(() => new THREE.Matrix4(), [])

  useLayoutEffect(() => {
    if (chips.current !== null) {
      for (let index = 0; index < 36; index += 1) {
        const stack = index % 6
        matrix.makeTranslation(-0.8 + stack * 0.32, 0.68 + Math.floor(index / 6) * 0.045, 0.72)
        chips.current.setMatrixAt(index, matrix)
      }
      chips.current.instanceMatrix.needsUpdate = true
    }
    if (cards.current !== null) {
      for (let index = 0; index < 5; index += 1) {
        matrix.makeTranslation(-0.72 + index * 0.36, 0.65, 0)
        cards.current.setMatrixAt(index, matrix)
      }
      cards.current.instanceMatrix.needsUpdate = true
    }
  }, [matrix])

  return (
    <>
      <instancedMesh ref={chips} args={[undefined, undefined, 36]} castShadow={false} receiveShadow>
        <cylinderGeometry args={[0.12, 0.12, 0.045, 16]} />
        <meshStandardMaterial color="#d8a338" metalness={0.25} roughness={0.42} />
      </instancedMesh>
      <instancedMesh ref={cards} args={[undefined, undefined, 5]} castShadow={false} receiveShadow>
        <boxGeometry args={[0.27, 0.018, 0.39]} />
        <meshStandardMaterial color="#e8ded0" roughness={0.68} />
      </instancedMesh>
    </>
  )
}

function CameraOrbit({ venueId }: { venueId: VenueId }) {
  const venue = venueOf(venueId)
  const placement = useMemo(() => cameraPlacement(venue), [venue])
  const controls = useRef<OrbitControlsImpl>(null)
  const { camera, size } = useThree()

  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera) || size.height === 0) return
    camera.fov = verticalFov(venue.camera.fov, size.width / size.height)
    camera.updateProjectionMatrix()
  }, [camera, size.width, size.height, venue.camera.fov])

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
      minDistance={placement.distance}
      maxDistance={placement.distance}
      minPolarAngle={THREE.MathUtils.degToRad(ORBIT_POLAR_DEGREES.min)}
      maxPolarAngle={THREE.MathUtils.degToRad(ORBIT_POLAR_DEGREES.max)}
      target={placement.target}
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

function VenueLights({ lights }: { lights: readonly SceneLight[] }) {
  useEffect(() => {
    // RectAreaLight renders black until its uniform tables are initialised.
    RectAreaLightUniformsLib.init()
  }, [])

  return (
    <>
      {/*
        Low enough that an unlit corner reads as dim rather than as a hole, and
        no higher. Ambient is the one light that cannot be occluded by
        anything, so every point of it is a point of contrast removed from the
        whole venue.
      */}
      <ambientLight intensity={0.11} />
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

function Scene({ seatIds, seatRefs, venueId, cues = [], occupiedSeats }: SceneProps) {
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

  return (
    <>
      <color attach="background" args={[worldColour]} />
      <VenueLights lights={lights} />
      <Suspense fallback={null}>
        <VenueAsset venueId={venueId} cues={cues} occupiedSeats={occupiedSeats} />
      </Suspense>
      <InstancedTablePieces />
      <Seats seatIds={seatIds} seatRefs={seatRefs} venueId={venueId} />
      <CameraOrbit venueId={venueId} />
    </>
  )
}

export function RiverScene({ seatIds, seatRefs, venueId, cues = [], occupiedSeats }: SceneProps) {
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
      />
    </Canvas>
  )
}

for (const id of VENUE_ORDER) useGLTF.preload(venueOf(id).asset)

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
import {
  type LightingSidecar,
  loadLightingSidecar,
  type SceneLight,
  toSceneLights,
  worldColourOf,
} from '@/lib/lighting'
import {
  cameraPlacement,
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

/** The plaque and the stage, as percentages of the 1920 by 1080 design box. */
const PLAQUE = { widthPercent: (208 / 1920) * 100, heightPercent: (76 / 1080) * 100 }
const STAGE = { widthPercent: 100, heightPercent: 100 }

function VenueAsset({ venueId, cues }: { venueId: VenueId; cues: readonly AnimationCue[] }) {
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
    const roots = asset.scene.children.filter((child) => child.type !== 'Mesh')
    for (const root of roots) {
      const mixer = new THREE.AnimationMixer(root)
      mixers.current.push(mixer)
      for (const clip of clips) {
        actions.current.set(`${root.name}:${clip.name}`, mixer.clipAction(clip))
      }
    }
    return () => {
      for (const mixer of mixers.current) mixer.stopAllAction()
      mixers.current = []
    }
  }, [asset.animations, asset.scene, venue.name])

  const playing = useMemo(() => (cues.length > 0 ? cues : seatIndexes.map(idleCueFor)), [cues])

  useEffect(() => {
    for (const cue of playing) {
      for (const [key, action] of actions.current) {
        if (!key.endsWith(`:${cue.clip}`)) continue
        action.reset()
        action.setLoop(cue.loop ? THREE.LoopRepeat : THREE.LoopOnce, Number.POSITIVE_INFINITY)
        action.clampWhenFinished = !cue.loop
        action.play()
      }
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
      minPolarAngle={THREE.MathUtils.degToRad(50)}
      maxPolarAngle={THREE.MathUtils.degToRad(70)}
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
        angle={0.9}
        color={light.colour}
        distance={0}
        // The caster carries the pool of light on the felt, so it is scaled
        // apart from the fills - a spot falls off with distance and the broad
        // area sources do not.
        intensity={light.intensity * 9}
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
      {/* A low ambient so an unlit corner reads as dim rather than as a hole. */}
      <ambientLight intensity={0.18} />
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

function Scene({ seatIds, seatRefs, venueId, cues = [] }: SceneProps) {
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
        <VenueAsset venueId={venueId} cues={cues} />
      </Suspense>
      <InstancedTablePieces />
      <Seats seatIds={seatIds} seatRefs={seatRefs} venueId={venueId} />
      <CameraOrbit venueId={venueId} />
    </>
  )
}

export function RiverScene({ seatIds, seatRefs, venueId, cues = [] }: SceneProps) {
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
          Object.assign(window, { riverScene: state })
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
      <Scene seatIds={seatIds} seatRefs={seatRefs} venueId={venueId} cues={cues} />
    </Canvas>
  )
}

for (const id of VENUE_ORDER) useGLTF.preload(venueOf(id).asset)

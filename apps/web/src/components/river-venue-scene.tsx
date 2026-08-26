'use client'

import { OrbitControls, useGLTF } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
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
}

function Seats({ seatIds, seatRefs, venueId }: SceneProps) {
  const venue = venueOf(venueId)
  const seats = useMemo(() => worldSeats(seatIds, venue.seatRing), [seatIds, venue.seatRing])
  const { camera } = useThree()
  const point = useMemo(() => new THREE.Vector3(), [])

  useFrame(() => {
    for (const seat of seats) {
      point.set(seat.x, seat.y, seat.z).project(camera)
      const element = seatRefs.current.get(seat.id)
      if (element === undefined) continue
      element.style.setProperty('--seat-x', `${((point.x + 1) / 2) * 100}%`)
      element.style.setProperty('--seat-y', `${((-point.y + 1) / 2) * 100}%`)
    }
  })

  return <group />
}

function VenueAsset({ venueId }: { venueId: VenueId }) {
  const venue = venueOf(venueId)
  const asset = useGLTF(venue.asset)

  useLayoutEffect(() => {
    asset.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      object.castShadow = venue.shadowCasters.test(object.name)
      object.receiveShadow = object.name !== 'river_card'
    })
  }, [asset.scene, venue.shadowCasters])

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

function Scene({ seatIds, seatRefs, venueId }: SceneProps) {
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
        <VenueAsset venueId={venueId} />
      </Suspense>
      <InstancedTablePieces />
      <Seats seatIds={seatIds} seatRefs={seatRefs} venueId={venueId} />
      <CameraOrbit venueId={venueId} />
    </>
  )
}

export function RiverScene({ seatIds, seatRefs, venueId }: SceneProps) {
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
      <Scene seatIds={seatIds} seatRefs={seatRefs} venueId={venueId} />
    </Canvas>
  )
}

for (const id of VENUE_ORDER) useGLTF.preload(venueOf(id).asset)

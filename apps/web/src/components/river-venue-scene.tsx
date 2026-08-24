'use client'

import { OrbitControls, useGLTF } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { type RefObject, Suspense, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { rooftopCamera, worldSeats } from '@/lib/venue'

type SceneProps = {
  seatIds: string[]
  seatRefs: RefObject<Map<string, HTMLElement>>
}

const tableCaster = /^(river_rooftop_wood|river_rooftop_felt|river_rooftop_rail)$/

function Seats({ seatIds, seatRefs }: SceneProps) {
  const seats = useMemo(() => worldSeats(seatIds), [seatIds])
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

function RooftopAsset() {
  const asset = useGLTF('/assets/rooftop_assets.glb')

  useLayoutEffect(() => {
    asset.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      object.castShadow = tableCaster.test(object.name)
      object.receiveShadow = object.name !== 'river_card'
    })
  }, [asset.scene])

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

function CameraOrbit() {
  const controls = useRef<OrbitControlsImpl>(null)

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
      enablePan={false}
      enableZoom={false}
      minDistance={Math.hypot(rooftopCamera.radius, rooftopCamera.height)}
      maxDistance={Math.hypot(rooftopCamera.radius, rooftopCamera.height)}
      minPolarAngle={THREE.MathUtils.degToRad(50)}
      maxPolarAngle={THREE.MathUtils.degToRad(70)}
      target={[0, 0.55, 0]}
    />
  )
}

function Scene({ seatIds, seatRefs }: SceneProps) {
  return (
    <>
      <color attach="background" args={['#7ca8ba']} />
      <hemisphereLight args={['#dbeeff', '#403225', 1.7]} />
      <directionalLight
        castShadow
        intensity={2.1}
        position={[-4, 8, 5]}
        shadow-mapSize={[1024, 1024]}
      />
      <Suspense fallback={null}>
        <RooftopAsset />
      </Suspense>
      <InstancedTablePieces />
      <Seats seatIds={seatIds} seatRefs={seatRefs} />
      <CameraOrbit />
    </>
  )
}

export function RiverScene({ seatIds, seatRefs }: SceneProps) {
  return (
    <Canvas
      className="river-venue"
      camera={{
        fov: rooftopCamera.fov,
        position: [0, rooftopCamera.height, -rooftopCamera.radius],
      }}
      dpr={[1, 1.5]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      shadows
    >
      <Scene seatIds={seatIds} seatRefs={seatRefs} />
    </Canvas>
  )
}

useGLTF.preload('/assets/rooftop_assets.glb')

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface VenueCameraSpec {
  radius: number
  height: number
  pitchDegrees: number
  fov: number
}

/**
 * Blender is Z-up; three.js and glTF are Y-up and the exported assets are
 * already Y-up while the authored coordinates are not.
 *
 * (x, y, z)_blender becomes (x, z, -y)_three. This must match the conversion
 * the light pipeline uses so a light and the camera agree about which way
 * round the room is. Getting it wrong flips the camera to the far side of the
 * table and reads as the venue being unreachable.
 */
export function blenderToThree(point: Vec3): Vec3 {
  return { x: point.x, y: point.z, z: -point.y }
}

/** The exact inverse of blenderToThree. */
export function threeToBlender(point: Vec3): Vec3 {
  return { x: point.x, y: -point.z, z: point.y }
}

/**
 * Place a play camera modelled on the venue lookdev. The Blender play camera
 * sits at (0, -radius, height); converting that through blenderToThree gives
 * the azimuth-0 position, and positive azimuth orbits the table on the fixed
 * radius around the Y axis.
 */
export function orbitCamera(
  camera: VenueCameraSpec,
  azimuthRadians: number,
): { position: Vec3; target: Vec3 } {
  return {
    position: {
      x: camera.radius * Math.sin(azimuthRadians),
      y: camera.height,
      z: camera.radius * Math.cos(azimuthRadians),
    },
    target: { x: 0, y: 0, z: 0 },
  }
}

/**
 * Whether the vertical frustum field at this fov reaches a table of the given
 * radius centred at the origin, measured across the three-dimensional distance
 * from the camera to the table centre. A camera whose field of view does not
 * cover the table cannot frame it.
 */
export function framesTable(camera: VenueCameraSpec, tableRadius: number): boolean {
  const distance = Math.hypot(camera.radius, camera.height)
  const halfFovRad = (camera.fov * Math.PI) / 180 / 2
  const halfCover = distance * Math.tan(halfFovRad)
  return halfCover >= tableRadius
}

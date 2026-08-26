import type { Vec3 } from './venue-camera.js'

export type { Vec3 }

export interface ScreenCamera {
  position: Vec3
  target: Vec3
  verticalFovDegrees: number
  aspect: number
  near: number
  far: number
}

export interface ScreenPoint {
  xPercent: number
  yPercent: number
  behind: boolean
  onScreen: boolean
}

const WORLD_UP: Vec3 = { x: 0, y: 1, z: 0 }

export function seatRing(count: number, radius: number, height: number): Vec3[] {
  if (count <= 0 || radius <= 0) return []
  const seats: Vec3[] = []
  for (let i = 0; i < count; i += 1) {
    const angle = (Math.PI * 2 * i) / count
    seats.push({
      x: radius * Math.sin(angle),
      y: height,
      z: radius * Math.cos(angle),
    })
  }
  return seats
}

export function projectToScreen(point: Vec3, camera: ScreenCamera): ScreenPoint {
  const forward = normalize(sub(camera.target, camera.position))
  const right = normalize(cross(forward, WORLD_UP))
  const up = cross(right, forward)

  const rel = sub(point, camera.position)
  const xView = dot(rel, right)
  const yView = dot(rel, up)
  const zView = -dot(rel, forward)

  const behind = zView >= 0 || -zView < Number.EPSILON
  const frontDepth = -zView
  if (behind) {
    return { xPercent: 0, yPercent: 0, behind: true, onScreen: false }
  }

  const tanHalf = Math.tan((camera.verticalFovDegrees * Math.PI) / 180 / 2)
  const ndcX = xView / frontDepth / (tanHalf * camera.aspect)
  const ndcY = yView / frontDepth / tanHalf

  const insideEdges = Math.abs(ndcX) <= 1 && Math.abs(ndcY) <= 1
  const insideDepth = frontDepth >= camera.near && frontDepth <= camera.far
  return {
    xPercent: (0.5 + 0.5 * ndcX) * 100,
    yPercent: (0.5 - 0.5 * ndcY) * 100,
    behind: false,
    onScreen: insideEdges && insideDepth,
  }
}

export function verticalFovFrom(horizontalDegrees: number, aspect: number): number {
  if (!Number.isFinite(horizontalDegrees) || !Number.isFinite(aspect) || aspect <= 0) {
    return horizontalDegrees
  }
  const halfRad = ((horizontalDegrees * Math.PI) / 180) * 0.5
  return (2 * Math.atan(Math.tan(halfRad) / aspect) * 180) / Math.PI
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function length(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z)
}

function normalize(a: Vec3): Vec3 {
  const magnitude = length(a)
  return { x: a.x / magnitude, y: a.y / magnitude, z: a.z / magnitude }
}

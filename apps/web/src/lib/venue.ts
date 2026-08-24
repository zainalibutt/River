export const rooftopCamera = {
  radius: 6.1,
  height: 4.05,
  pitchDegrees: 62,
  fov: 64,
} as const

export type WorldSeat = {
  id: string
  x: number
  y: number
  z: number
}

export function worldSeats(ids: readonly string[]): WorldSeat[] {
  const radius = 3.05
  return ids.map((id, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / ids.length
    return { id, x: Math.cos(angle) * radius, y: 0.54, z: Math.sin(angle) * radius }
  })
}

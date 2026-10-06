import { PORTRAIT, type TableGeometry } from './table-2d-geometry'

export const PHONE_HEADER_HEIGHT = 64
export const PHONE_DOCK_HEIGHT = 178
export const PHONE_STATUS_HEIGHT = 32
export const PHONE_SAFE_RESERVE = 44

export function phoneViewport(width: number, height: number): boolean {
  return width < 1024 && height > width
}

export function phoneKeyboardInset(
  height: number,
  visibleHeight: number,
  offsetTop: number,
): number {
  return Math.max(0, height - visibleHeight - offsetTop)
}

export function phoneGeometry(width: number, height: number): TableGeometry {
  const tableHeight = Math.max(
    280,
    height - PHONE_HEADER_HEIGHT - PHONE_DOCK_HEIGHT - PHONE_STATUS_HEIGHT - PHONE_SAFE_RESERVE,
  )
  return {
    ...PORTRAIT,
    stage: { width, height: tableHeight },
    a: (width - 112) / 2,
    b: (tableHeight - 100) / 2,
    rail: 12,
    centre: { x: width / 2, y: tableHeight / 2 },
    tilt: 12,
    perspective: 2600,
    eye: { x: width / 2, y: tableHeight / 3 },
    placard: { width: 100, height: 52 },
    boardCard: { width: 32, height: 45 },
    boardGap: 4,
    holeCard: { width: 18, height: 25 },
  }
}

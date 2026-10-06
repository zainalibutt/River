export interface Rect {
  xPercent: number
  yPercent: number
  widthPercent: number
  heightPercent: number
}

export interface Placement {
  index: number
  xPercent: number
  yPercent: number
  pushed: boolean
}

export interface PlaqueSize {
  widthPercent: number
  heightPercent: number
}

export interface PlaqueBounds {
  widthPercent: number
  heightPercent: number
}

const PUSH_STEP = 0.05
const MAX_PUSH = 400

export function layOutPlaques(
  anchors: readonly { xPercent: number; yPercent: number }[],
  size: PlaqueSize,
  bounds: PlaqueBounds,
  centre: { xPercent: number; yPercent: number },
): Placement[] {
  const placedRects: Rect[] = []
  const placements: Placement[] = []

  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index] as { xPercent: number; yPercent: number }
    const ux = realUnitX(anchor, centre)
    const uy = realUnitY(anchor, centre)

    let centreX = anchor.xPercent
    let centreY = anchor.yPercent
    let offset = 0
    while (offset <= MAX_PUSH) {
      const rect = centredRect(centreX + ux * offset, centreY + uy * offset, size)
      if (!placedRects.some((placed) => overlaps(placed, rect))) {
        centreX += ux * offset
        centreY += uy * offset
        break
      }
      offset += PUSH_STEP
    }

    const clamped = clampToBounds(centredRect(centreX, centreY, size), size, bounds)
    const final = centreOf(clamped)
    const pushed =
      Math.abs(final.xPercent - anchor.xPercent) > 1e-9 ||
      Math.abs(final.yPercent - anchor.yPercent) > 1e-9

    placements.push({ index, xPercent: final.xPercent, yPercent: final.yPercent, pushed })
    placedRects.push(clamped)
  }

  return placements
}

export function overlaps(a: Rect, b: Rect): boolean {
  const overlapX =
    a.xPercent < b.xPercent + b.widthPercent && a.xPercent + a.widthPercent > b.xPercent
  const overlapY =
    a.yPercent < b.yPercent + b.heightPercent && a.yPercent + a.heightPercent > b.yPercent
  return overlapX && overlapY
}

export function worstOverlap(placements: readonly Placement[], size: PlaqueSize): number {
  let worst = 0
  const plaqueArea = size.widthPercent * size.heightPercent
  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      const a = placedRect(placements[i] as Placement, size)
      const b = placedRect(placements[j] as Placement, size)
      const width =
        Math.min(a.xPercent + a.widthPercent, b.xPercent + b.widthPercent) -
        Math.max(a.xPercent, b.xPercent)
      const height =
        Math.min(a.yPercent + a.heightPercent, b.yPercent + b.heightPercent) -
        Math.max(a.yPercent, b.yPercent)
      if (width > 0 && height > 0) {
        worst = Math.max(worst, (width * height) / plaqueArea)
      }
    }
  }
  return worst
}

function realUnitX(
  anchor: { xPercent: number; yPercent: number },
  centre: { xPercent: number; yPercent: number },
): number {
  const dx = anchor.xPercent - centre.xPercent
  const dy = anchor.yPercent - centre.yPercent
  const distance = Math.hypot(dx, dy)
  if (distance < 1e-9) return 1
  return dx / distance
}

function realUnitY(
  anchor: { xPercent: number; yPercent: number },
  centre: { xPercent: number; yPercent: number },
): number {
  const dx = anchor.xPercent - centre.xPercent
  const dy = anchor.yPercent - centre.yPercent
  const distance = Math.hypot(dx, dy)
  if (distance < 1e-9) return 0
  return dy / distance
}

function centredRect(centreX: number, centreY: number, size: PlaqueSize): Rect {
  return {
    xPercent: centreX - size.widthPercent / 2,
    yPercent: centreY - size.heightPercent / 2,
    widthPercent: size.widthPercent,
    heightPercent: size.heightPercent,
  }
}

function placedRect(placement: Placement, size: PlaqueSize): Rect {
  return {
    xPercent: placement.xPercent - size.widthPercent / 2,
    yPercent: placement.yPercent - size.heightPercent / 2,
    widthPercent: size.widthPercent,
    heightPercent: size.heightPercent,
  }
}

function centreOf(rect: Rect): { xPercent: number; yPercent: number } {
  return {
    xPercent: rect.xPercent + rect.widthPercent / 2,
    yPercent: rect.yPercent + rect.heightPercent / 2,
  }
}

function clampToBounds(rect: Rect, size: PlaqueSize, bounds: PlaqueBounds): Rect {
  const maxX = Math.max(0, bounds.widthPercent - size.widthPercent)
  const maxY = Math.max(0, bounds.heightPercent - size.heightPercent)
  return {
    ...rect,
    xPercent: Math.min(maxX, Math.max(0, rect.xPercent)),
    yPercent: Math.min(maxY, Math.max(0, rect.yPercent)),
  }
}

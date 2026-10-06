/**
 * Where everything sits on the 2D table, and where the screen sees it.
 *
 * The felt is a plane tipped back from the player, the way a table looks from a seat at
 * it. What lies on the felt - cards, the dealer button, the printed lines - is placed in the
 * plane's own coordinates and tipped with it by the browser. What stands up - a player's
 * placard, a chip stack, the dealer - is drawn flat at the point where its spot on the felt
 * appears, so its type stays sharp and its edges stay square. `project` is the arithmetic
 * the browser applies to the tipped plane, and `planeStyle` hands the browser the same
 * numbers, so the two cannot disagree: a stack drawn beside the bet it belongs to is the
 * failure this file exists to prevent.
 *
 * In multiway, the dealer stands at the head and the player sits at the foot, both on the
 * centre line. That needs an even number of places round the rail, and eight players and a
 * dealer make nine, so a table with an odd count leaves one place empty: the one on the
 * player's right at the foot, which is where the action menu and the raise arc need room.
 *
 * Pure: no DOM, no clock.
 */

export type TableOrientation = 'landscape' | 'portrait'

export interface PlanePoint {
  /** Right of the felt's centre, in plane pixels. */
  u: number
  /** Toward the player from the felt's centre, in plane pixels. The far side is negative. */
  v: number
}

export interface ScreenPoint {
  x: number
  y: number
  /** How much nearer than the felt's centre line this point is: above 1 is nearer. */
  scale: number
}

export interface TableGeometry {
  orientation: TableOrientation
  stage: { width: number; height: number }
  /** Half-width and half-depth of the table to the outside of the rail, in plane pixels. */
  a: number
  b: number
  /** Depth of the padded rail, in plane pixels. */
  rail: number
  /** Where the felt's centre sits on the stage before the tilt. */
  centre: { x: number; y: number }
  /** How far the far edge tips away from the player, in degrees. */
  tilt: number
  /** The browser's perspective distance, in stage pixels. */
  perspective: number
  /** The browser's perspective origin, in stage pixels. */
  eye: { x: number; y: number }
  placard?: { width: number; height: number }
  boardCard?: { width: number; height: number }
  boardGap?: number
  holeCard?: { width: number; height: number }
}

/** Where a placard stands, as a box on the stage. */
export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export const PLACARD = { width: 204, height: 64 } as const

export const LANDSCAPE: TableGeometry = {
  orientation: 'landscape',
  stage: { width: 1920, height: 1080 },
  a: 790,
  b: 372,
  rail: 44,
  centre: { x: 960, y: 548 },
  tilt: 34,
  perspective: 2200,
  eye: { x: 960, y: 330 },
}

export const PORTRAIT: TableGeometry = {
  orientation: 'portrait',
  stage: { width: 1080, height: 1920 },
  a: 404,
  b: 640,
  rail: 40,
  centre: { x: 540, y: 842 },
  tilt: 22,
  perspective: 2600,
  eye: { x: 540, y: 520 },
}

const RADIANS = Math.PI / 180

/**
 * Where a point on the felt appears on the stage.
 *
 * The browser tips the plane about its own centre (rotateX), then applies the perspective
 * of the element that holds it about the perspective origin. Positive z faces the viewer,
 * and the far half of the felt, v below zero, tips away from it.
 */
export function project(geometry: TableGeometry, point: PlanePoint): ScreenPoint {
  const tilt = geometry.tilt * RADIANS
  const x = geometry.centre.x + point.u
  const y = geometry.centre.y + point.v * Math.cos(tilt)
  const z = point.v * Math.sin(tilt)
  const scale = geometry.perspective / (geometry.perspective - z)
  return {
    x: geometry.eye.x + (x - geometry.eye.x) * scale,
    y: geometry.eye.y + (y - geometry.eye.y) * scale,
    scale,
  }
}

/** The CSS for the tipped plane and the element that gives it perspective. */
export function planeStyle(geometry: TableGeometry) {
  return {
    scene: {
      width: `${geometry.stage.width}px`,
      height: `${geometry.stage.height}px`,
      perspective: `${geometry.perspective}px`,
      perspectiveOrigin: `${geometry.eye.x}px ${geometry.eye.y}px`,
    },
    plane: {
      left: `${geometry.centre.x - geometry.a}px`,
      top: `${geometry.centre.y - geometry.b}px`,
      width: `${geometry.a * 2}px`,
      height: `${geometry.b * 2}px`,
      transform: `rotateX(${geometry.tilt}deg)`,
    },
  }
}

/** A point on the felt, in the plane element's own box rather than about its centre. */
export function planeOffset(
  geometry: TableGeometry,
  point: PlanePoint,
): { left: number; top: number } {
  return { left: point.u + geometry.a, top: point.v + geometry.b }
}

function ellipsePoint(a: number, b: number, t: number): PlanePoint {
  return { u: a * Math.cos(t), v: -b * Math.sin(t) }
}

const ARC_STEPS = 2048

/**
 * The ellipse parameter at each of `count` places spaced evenly by distance around the
 * rail, the first at the head of the table and the rest running clockwise as the player
 * sees it.
 *
 * Evenly spaced angles bunch chairs at the ends of a long table and spread them along its
 * sides; a real table spaces its chairs by the rail, so this does too.
 */
function placesAroundRail(a: number, b: number, count: number): number[] {
  const lengths = new Float64Array(ARC_STEPS + 1)
  let previous = ellipsePoint(a, b, 0)
  for (let step = 1; step <= ARC_STEPS; step += 1) {
    const point = ellipsePoint(a, b, (step / ARC_STEPS) * Math.PI * 2)
    lengths[step] =
      (lengths[step - 1] ?? 0) + Math.hypot(point.u - previous.u, point.v - previous.v)
    previous = point
  }
  const total = lengths[ARC_STEPS] ?? 0
  const parameterAt = (distance: number): number => {
    const wrapped = ((distance % total) + total) % total
    let low = 0
    let high = ARC_STEPS
    while (high - low > 1) {
      const middle = (low + high) >> 1
      if ((lengths[middle] ?? 0) <= wrapped) low = middle
      else high = middle
    }
    const from = lengths[low] ?? 0
    const to = lengths[high] ?? from
    const within = to > from ? (wrapped - from) / (to - from) : 0
    return ((low + within) / ARC_STEPS) * Math.PI * 2
  }
  // The head of the table is a quarter of the way round from the right-hand end. Clockwise
  // on screen runs against the parameter, because the far side is up.
  const head = total / 4
  return Array.from({ length: count }, (_, place) => parameterAt(head - (place * total) / count))
}

export interface SeatSpots {
  seat: number
  /** Which place round the rail the seat takes, 1 onward clockwise from the dealer. */
  place: number
  /** Whether this is the place at the foot of the table, where the player sits. */
  foot: boolean
  /** Direction round the table, as the ellipse parameter. */
  angle: number
  placard: ScreenPoint
  placardBox: Box
  /** Where the seat's own chips stand on the felt. */
  stack: PlanePoint
  /** Where its two cards lie. */
  cards: readonly [PlanePoint, PlanePoint]
  /** Where its bets are pushed. */
  bet: PlanePoint
  /** Where the dealer button sits when it is this seat's. */
  button: PlanePoint
  /** Turn to lay a card square to the seat, in degrees, clockwise. */
  facing: number
}

export interface TableLayout {
  geometry: TableGeometry
  headsUp: boolean
  seats: readonly SeatSpots[]
  /** The dealer's feet, at the far rail, and where the dealer's hands work. */
  dealer: ScreenPoint
  shoe: PlanePoint
  muck: PlanePoint
  board: readonly PlanePoint[]
  pot: PlanePoint
  /** The printed name on the felt, between the board and the player. */
  mark: PlanePoint
  /** Board card size on the felt, in plane pixels. */
  boardCard: { width: number; height: number }
  /** Hole card size on the felt, in plane pixels. */
  holeCard: { width: number; height: number }
}

function toward(point: PlanePoint, target: PlanePoint, distance: number): PlanePoint {
  const du = target.u - point.u
  const dv = target.v - point.v
  const length = Math.hypot(du, dv) || 1
  return { u: point.u + (du / length) * distance, v: point.v + (dv / length) * distance }
}

function along(point: PlanePoint, angle: number, distance: number): PlanePoint {
  // The tangent to the ellipse at parameter `angle`, pointing clockwise on screen.
  const u = Math.sin(angle)
  const v = Math.cos(angle)
  const length = Math.hypot(u, v) || 1
  return { u: point.u + (u / length) * distance, v: point.v + (v / length) * distance }
}

/**
 * The seat that takes the player's place: yours when you are seated, and seat zero when
 * you are only looking, so a table you have not joined still has someone at its foot.
 */
export function anchorSeat(heroSeat: number | null): number {
  return heroSeat ?? 0
}

/**
 * Lift a placard clear of the HUD. A placard sits on the rail, and on a small table the
 * places either side of the foot fall in the corners the HUD holds, so the placard rises
 * toward the middle of the table - still over its own seat, just no longer under a menu.
 */
function clearOf(box: Box, reserved: readonly Box[]): Box {
  let lifted = box
  for (let pass = 0; pass < reserved.length + 1; pass += 1) {
    const blocking = reserved.find((hud) => overlaps(hud, lifted))
    if (blocking === undefined) return lifted
    lifted = { ...lifted, y: blocking.y - lifted.height - 8 }
  }
  return lifted
}

/** Lay out a table of `seatCount` seats with `heroSeat` at the player's place. */
export function tableLayout(
  geometry: TableGeometry,
  seatCount: number,
  heroSeat: number | null,
  reserved: readonly Box[] = geometry.orientation === 'landscape' ? LANDSCAPE_HUD : [],
): TableLayout {
  const count = Math.max(2, Math.floor(seatCount))
  // Multiway reserves a croupier place. Heads-up puts the opponent there instead.
  const headsUp = count === 2
  const placeCount = headsUp ? 2 : (count + 1) % 2 === 0 ? count + 1 : count + 2
  const places = placesAroundRail(geometry.a, geometry.b, placeCount)
  const footPlace = placeCount / 2
  const anchor = anchorSeat(heroSeat)
  const inner = { a: geometry.a - geometry.rail, b: geometry.b - geometry.rail }
  const placardSize = geometry.placard ?? PLACARD
  const seats: SeatSpots[] = []
  for (let seat = 0; seat < count; seat += 1) {
    const offset = (((seat - anchor) % count) + count) % count
    // Clockwise from the foot, round past the head, skipping the dealer's place.
    const place = headsUp
      ? (footPlace + offset) % placeCount
      : ((footPlace - 1 + offset) % (placeCount - 1)) + 1
    const angle = places[place] ?? 0
    const rail = ellipsePoint(
      geometry.a - geometry.rail * 0.35,
      geometry.b - geometry.rail * 0.35,
      angle,
    )
    const placard = project(geometry, rail)
    // The player's own stack and cards sit under the action menu, which is fine: the cluster
    // at the lower left carries both. Their bet is drawn nearer the middle, clear of the
    // menu, because a bet is what the rest of the table is looking at.
    const foot = place === footPlace
    const spotAngle = angle
    const stack = ellipsePoint(inner.a * 0.9, inner.b * 0.82, spotAngle)
    const cardsCentre = along(ellipsePoint(inner.a * 0.8, inner.b * 0.68, spotAngle), spotAngle, 64)
    const cardFacing = toward(cardsCentre, { u: 0, v: 0 }, 1)
    const facing = (Math.atan2(cardFacing.u, -cardFacing.v) * 180) / Math.PI
    const spread = along({ u: 0, v: 0 }, spotAngle, 15)
    const resting: Box = {
      x: placard.x - placardSize.width / 2,
      y: placard.y - placardSize.height / 2,
      width: placardSize.width,
      height: placardSize.height,
    }
    // The foot's placard only shows for a seat you are not in, and then the HUD at the
    // centre is the prompt to choose a seat, so it stands a little up the felt, clear of it.
    const placardBox = foot ? { ...resting, y: resting.y - 74 } : clearOf(resting, reserved)
    seats.push({
      seat,
      place,
      foot,
      angle,
      placard: {
        x: placardBox.x + placardSize.width / 2,
        y: placardBox.y + placardSize.height / 2,
        scale: placard.scale,
      },
      placardBox,
      stack,
      cards: [
        { u: cardsCentre.u - spread.u, v: cardsCentre.v - spread.v },
        { u: cardsCentre.u + spread.u, v: cardsCentre.v + spread.v },
      ],
      bet: ellipsePoint(inner.a * 0.62, inner.b * (foot ? 0.34 : 0.5), spotAngle),
      button: along(ellipsePoint(inner.a * 0.74, inner.b * 0.62, spotAngle), spotAngle, -70),
      facing,
    })
  }
  const boardCard = geometry.boardCard ?? { width: 92, height: 128 }
  const gap = geometry.boardGap ?? 12
  const boardSpan = boardCard.width * 5 + gap * 4
  const board = Array.from({ length: 5 }, (_, index) => ({
    u: -boardSpan / 2 + boardCard.width / 2 + index * (boardCard.width + gap),
    v: 8,
  }))
  return {
    geometry,
    headsUp,
    seats,
    dealer: project(geometry, { u: 0, v: -geometry.b + geometry.rail * 0.2 }),
    shoe: { u: geometry.a * 0.2, v: -inner.b * 0.8 },
    muck: { u: -geometry.a * 0.2, v: -inner.b * 0.8 },
    board,
    pot: { u: 0, v: -inner.b * 0.42 },
    mark: { u: 0, v: inner.b * 0.42 },
    boardCard,
    holeCard: geometry.holeCard ?? { width: 58, height: 81 },
  }
}

/** Boxes that overlap by more than a hairline. */
export function overlaps(first: Box, second: Box): boolean {
  return (
    Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x) > 1 &&
    Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y) > 1
  )
}

/**
 * The HUD's fixed furniture on the landscape stage: the two corner menus, the cluster at
 * the lower left, the action menu at the lower centre at the size the raise arc opens to,
 * and the status line at the lower right. No placard may sit under them.
 */
export const LANDSCAPE_HUD: readonly Box[] = [
  { x: 90, y: 48, width: 580, height: 60 },
  { x: 1260, y: 48, width: 580, height: 60 },
  { x: 80, y: 770, width: 230, height: 240 },
  { x: 770, y: 660, width: 380, height: 390 },
  { x: 1230, y: 1000, width: 480, height: 34 },
  { x: 1560, y: 880, width: 280, height: 108 },
]

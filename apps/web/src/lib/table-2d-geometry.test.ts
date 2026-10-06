import { describe, expect, it } from 'vitest'
import {
  type Box,
  LANDSCAPE,
  LANDSCAPE_HUD,
  overlaps,
  PORTRAIT,
  project,
  type TableGeometry,
  tableLayout,
} from './table-2d-geometry'

type Matrix = number[][]

function multiply(left: Matrix, right: Matrix): Matrix {
  return left.map(
    (row) =>
      right[0]?.map((_, column) =>
        row.reduce((sum, value, k) => sum + value * (right[k]?.[column] ?? 0), 0),
      ) ?? [],
  )
}

function translate(x: number, y: number): Matrix {
  return [
    [1, 0, 0, x],
    [0, 1, 0, y],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ]
}

/**
 * The browser's own sequence, written as the CSS Transforms spec composes it: the plane's
 * rotateX about its centre, inside a perspective applied about the perspective origin.
 * An independent route to the same screen point, so `project` is checked against the
 * matrices rather than against itself.
 */
function browserPoint(geometry: TableGeometry, u: number, v: number): { x: number; y: number } {
  const angle = (geometry.tilt * Math.PI) / 180
  const rotate: Matrix = [
    [1, 0, 0, 0],
    [0, Math.cos(angle), -Math.sin(angle), 0],
    [0, Math.sin(angle), Math.cos(angle), 0],
    [0, 0, 0, 1],
  ]
  const perspective: Matrix = [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, -1 / geometry.perspective, 1],
  ]
  const plane = multiply(
    multiply(translate(geometry.centre.x, geometry.centre.y), rotate),
    translate(-geometry.centre.x, -geometry.centre.y),
  )
  const scene = multiply(
    multiply(translate(geometry.eye.x, geometry.eye.y), perspective),
    translate(-geometry.eye.x, -geometry.eye.y),
  )
  const point = [[geometry.centre.x + u], [geometry.centre.y + v], [0], [1]]
  const out = multiply(multiply(scene, plane), point)
  const w = out[3]?.[0] ?? 1
  return { x: (out[0]?.[0] ?? 0) / w, y: (out[1]?.[0] ?? 0) / w }
}

const STAGE_MARGIN = 8

function insideStage(geometry: TableGeometry, box: Box): boolean {
  return (
    box.x >= STAGE_MARGIN &&
    box.y >= STAGE_MARGIN &&
    box.x + box.width <= geometry.stage.width - STAGE_MARGIN &&
    box.y + box.height <= geometry.stage.height - STAGE_MARGIN
  )
}

describe('the tipped felt', () => {
  it('projects a point on the felt exactly where the browser draws it', () => {
    for (const geometry of [LANDSCAPE, PORTRAIT]) {
      for (const [u, v] of [
        [0, 0],
        [0, -geometry.b],
        [0, geometry.b],
        [-geometry.a, 0],
        [geometry.a * 0.6, -geometry.b * 0.7],
        [-geometry.a * 0.3, geometry.b * 0.9],
      ] as const) {
        const ours = project(geometry, { u, v })
        const browser = browserPoint(geometry, u, v)
        expect(ours.x).toBeCloseTo(browser.x, 6)
        expect(ours.y).toBeCloseTo(browser.y, 6)
      }
    }
  })

  it('draws the far side higher and smaller than the near side', () => {
    const far = project(LANDSCAPE, { u: 0, v: -LANDSCAPE.b })
    const near = project(LANDSCAPE, { u: 0, v: LANDSCAPE.b })
    expect(far.y).toBeLessThan(near.y)
    expect(far.scale).toBeLessThan(1)
    expect(near.scale).toBeGreaterThan(1)
  })
})

describe('seats round the rail', () => {
  it('seats every player at the foot or round the rail, reserving a croupier only in multiway', () => {
    for (let count = 2; count <= 9; count += 1) {
      for (const hero of [null, 0, count - 1]) {
        const layout = tableLayout(LANDSCAPE, count, hero)
        const places = layout.seats.map((seat) => seat.place)
        expect(new Set(places).size).toBe(count)
        if (count === 2) expect(places).toContain(0)
        else expect(places).not.toContain(0)
        const anchor = layout.seats.find((seat) => seat.seat === (hero ?? 0))
        expect(anchor?.foot).toBe(true)
        expect(layout.seats.filter((seat) => seat.foot)).toHaveLength(1)
      }
    }
  })

  it('runs play clockwise: the next seat is on the player’s left', () => {
    // Play passes from one seat number to the next, and at a real table that is to the
    // left of whoever just acted. From the foot, the left is the lower left of the screen.
    const layout = tableLayout(LANDSCAPE, 8, 3)
    const foot = layout.seats.find((seat) => seat.seat === 3)
    const next = layout.seats.find((seat) => seat.seat === 4)
    const before = layout.seats.find((seat) => seat.seat === 2)
    if (foot === undefined || next === undefined || before === undefined) throw new Error('seat')
    expect(next.placard.x).toBeLessThan(foot.placard.x)
    expect(before.placard.x).toBeGreaterThan(foot.placard.x)
  })

  it('puts the dealer at the head of the table, on the centre line', () => {
    const layout = tableLayout(LANDSCAPE, 8, 0)
    expect(layout.dealer.x).toBeCloseTo(LANDSCAPE.stage.width / 2, 6)
    for (const seat of layout.seats) expect(layout.dealer.y).toBeLessThan(seat.placard.y)
  })

  it('keeps the placards apart, on the stage and out from under the HUD', () => {
    for (let count = 2; count <= 9; count += 1) {
      for (const hero of [null, 0, 5 % count]) {
        const layout = tableLayout(LANDSCAPE, count, hero)
        const boxes = layout.seats.map((seat) => seat.placardBox)
        for (let first = 0; first < boxes.length; first += 1) {
          const box = boxes[first] as Box
          expect(insideStage(LANDSCAPE, box)).toBe(true)
          for (let second = first + 1; second < boxes.length; second += 1) {
            expect(overlaps(box, boxes[second] as Box)).toBe(false)
          }
        }
        // The placard at the foot is only drawn for a seat you are not sitting in, and then
        // the action menu is the one-line prompt to choose a seat.
        for (const seat of layout.seats.filter((entry) => !entry.foot)) {
          const under = LANDSCAPE_HUD.filter((hud) => overlaps(hud, seat.placardBox))
          expect(under).toEqual([])
        }
      }
    }
  })

  it('keeps every bet off the others and off the board', () => {
    const layout = tableLayout(LANDSCAPE, 8, 0)
    const chip = 34
    const bets = layout.seats.map((seat) => {
      const at = project(LANDSCAPE, seat.bet)
      return { x: at.x - chip / 2, y: at.y - chip / 2, width: chip, height: chip }
    })
    const first = project(LANDSCAPE, layout.board[0] ?? { u: 0, v: 0 })
    const last = project(LANDSCAPE, layout.board[4] ?? { u: 0, v: 0 })
    const board = {
      x: first.x - layout.boardCard.width / 2,
      y: first.y - layout.boardCard.height / 2,
      width: last.x - first.x + layout.boardCard.width,
      height: layout.boardCard.height,
    }
    for (let one = 0; one < bets.length; one += 1) {
      expect(overlaps(bets[one] as Box, board)).toBe(false)
      for (let two = one + 1; two < bets.length; two += 1) {
        expect(overlaps(bets[one] as Box, bets[two] as Box)).toBe(false)
      }
    }
  })

  it('fits a portrait table on a phone-shaped stage', () => {
    const layout = tableLayout(PORTRAIT, 8, 0)
    const boxes = layout.seats.map((seat) => seat.placardBox)
    for (let first = 0; first < boxes.length; first += 1) {
      expect(insideStage(PORTRAIT, boxes[first] as Box)).toBe(true)
      for (let second = first + 1; second < boxes.length; second += 1) {
        expect(overlaps(boxes[first] as Box, boxes[second] as Box)).toBe(false)
      }
    }
  })
})

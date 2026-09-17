import { describe, expect, it } from 'vitest'
import { CLIP_FPS, CLIP_LAST_FRAME } from './animation.js'
import {
  ALL_IN_STACK_PLACE,
  CHIP_STACK_PLACE,
  HOLE_CARD_PEEK,
  HOLE_CARD_SIZE,
  holeCardAt,
  PEEK_LAST_FRAME,
  PROP_TRACK_FPS,
} from './seat-props.js'

/**
 * The places the browser draws a player's own chips and cards.
 *
 * All of it is generated from the tracks the clips were authored against, so what is
 * checked here is that the generated numbers still describe a hand of cards on a table in
 * front of a seated man - and that the runtime reads them the way the scene assumes. A peek
 * that lifts nothing is what shipped before this module existed, and it looked like a
 * player idly brushing the felt.
 */
describe('hole cards', () => {
  it('runs on the same clock as the peek clip, for the same length', () => {
    expect(PROP_TRACK_FPS).toBe(CLIP_FPS)
    expect(PEEK_LAST_FRAME).toBe(CLIP_LAST_FRAME.PEEK_card)
    for (const track of HOLE_CARD_PEEK) expect(track.length / 7).toBe(PEEK_LAST_FRAME + 1)
  })

  it('is a playing card, not a coaster', () => {
    expect(HOLE_CARD_SIZE.width).toBeCloseTo(0.063, 3)
    expect(HOLE_CARD_SIZE.length).toBeCloseTo(0.088, 3)
  })

  it('lies on the table at rest and returns there', () => {
    for (const card of [0, 1]) {
      const rest = holeCardAt(card, 0)
      const back = holeCardAt(card, PEEK_LAST_FRAME)
      expect(back.position[1]).toBeCloseTo(rest.position[1], 4)
      expect(back.position[2]).toBeCloseTo(rest.position[2], 4)
      // In front of him, on the felt he was authored on.
      expect(rest.position[2]).toBeGreaterThan(0.4)
      expect(rest.position[1]).toBeGreaterThan(0.79)
      expect(rest.position[1]).toBeLessThan(0.8)
    }
  })

  it('lifts the card far enough to read as a look at it', () => {
    for (const card of [0, 1]) {
      const rest = holeCardAt(card, 0).position[1]
      let highest = rest
      for (let frame = 0; frame <= PEEK_LAST_FRAME; frame += 1) {
        highest = Math.max(highest, holeCardAt(card, frame).position[1])
      }
      expect(highest - rest).toBeGreaterThan(0.09)
    }
  })

  it('turns the card up, and keeps every rotation a rotation', () => {
    let steepest = 1
    for (let frame = 0; frame <= PEEK_LAST_FRAME; frame += 0.5) {
      for (const card of [0, 1]) {
        const [x, y, z, w] = holeCardAt(card, frame).quaternion
        expect(Math.hypot(x, y, z, w)).toBeCloseTo(1, 5)
        // The card's own up, turned by the quaternion: flat on the felt is +1.
        steepest = Math.min(steepest, 1 - 2 * (x * x + z * z))
      }
    }
    // A card tipped up towards the face that is reading it. Flat is 1, straight up is 0,
    // and the peek reaches about 76 degrees off the felt.
    expect(steepest).toBeLessThan(0.3)
  })

  it('reads between samples rather than stepping', () => {
    // The lift holds still for a beat at the top, so the frame to test on is found rather
    // than picked: the first one where the card is actually moving.
    let moving = -1
    for (let frame = 0; frame < PEEK_LAST_FRAME && moving < 0; frame += 1) {
      if (holeCardAt(0, frame).position[1] !== holeCardAt(0, frame + 1).position[1]) moving = frame
    }
    expect(moving).toBeGreaterThanOrEqual(0)
    const first = holeCardAt(0, moving).position[1]
    const middle = holeCardAt(0, moving + 0.5).position[1]
    const last = holeCardAt(0, moving + 1).position[1]
    expect(Math.min(first, last)).toBeLessThan(middle)
    expect(Math.max(first, last)).toBeGreaterThan(middle)
  })

  it('clamps rather than falling off either end of the track', () => {
    expect(holeCardAt(0, -5).position).toEqual(holeCardAt(0, 0).position)
    expect(holeCardAt(0, 999).position).toEqual(holeCardAt(0, PEEK_LAST_FRAME).position)
    expect(holeCardAt(7, 0).position).toEqual([0, 0, 0])
  })
})

describe('chips', () => {
  it('sits the stack in front of him, within reach', () => {
    // Half a metre out and a little to one side: where the hand that pushes it was
    // authored to find it. The browser used to place it a quarter of the way from the
    // middle of the felt to the seat ring, which is a different place entirely.
    expect(CHIP_STACK_PLACE.rest[2]).toBeCloseTo(0.5, 2)
    expect(Math.abs(CHIP_STACK_PLACE.rest[0])).toBeLessThan(0.1)
    expect(CHIP_STACK_PLACE.rest[1]).toBeGreaterThan(0.79)
  })

  it('pushes forwards, and shoves further than it pushes', () => {
    const push = CHIP_STACK_PLACE.pushed[2] - CHIP_STACK_PLACE.rest[2]
    const shove = ALL_IN_STACK_PLACE.pushed[2] - ALL_IN_STACK_PLACE.rest[2]
    expect(push).toBeGreaterThan(0.05)
    expect(shove).toBeGreaterThan(push)
    // The all-in starts square in front of him; the push starts beside his hand.
    expect(ALL_IN_STACK_PLACE.rest[0]).toBe(0)
  })
})

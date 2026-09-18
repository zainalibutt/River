import { describe, expect, it } from 'vitest'
import { CLIP_FPS, CLIP_LAST_FRAME } from './animation'
import {
  advance,
  applyCue,
  BLEND_IN_SECONDS,
  BLEND_OUT_SECONDS,
  endHand,
  initialSeat,
  LEAVE_FROM_STANDING_FRAME,
  poseOf,
  RETURN_FROM_FRAME,
  type SeatState,
  syncOccupancy,
} from './seat-motion'

const seconds = (frames: number): number => frames / CLIP_FPS

function pose(state: SeatState, now: number) {
  return poseOf(advance(state, now), now)
}

function totalWeight(state: SeatState, now: number): number {
  const drawn = pose(state, now)
  return drawn.idleWeight + (drawn.body?.weight ?? 0) + (drawn.release?.weight ?? 0)
}

describe('seat motion', () => {
  it('shows an occupied seat seated on the idle and hides an empty one', () => {
    expect(pose(initialSeat(true), 0)).toMatchObject({ visible: true, idleWeight: 1, body: null })
    expect(pose(initialSeat(false), 0).visible).toBe(false)
  })

  it('sits a new player down from the first frame, with no blend from a body that was not there', () => {
    const entering = applyCue(initialSeat(false), 'SIT_enter', 10)
    const start = pose(entering, 10)
    expect(start.visible).toBe(true)
    expect(start.body).toEqual({ clip: 'SIT_enter', frame: 0, weight: 1 })
    expect(start.chair).toEqual({ clip: 'SIT_enter', frame: 0 })

    const done = 10 + seconds(CLIP_LAST_FRAME.SIT_enter)
    expect(advance(entering, done + 0.01).phase).toBe('seated')
    expect(pose(entering, done + BLEND_OUT_SECONDS + 0.01)).toMatchObject({
      idleWeight: 1,
      body: null,
      release: null,
      chair: null,
    })
  })

  it('keeps a leaving body on screen after the room has emptied the seat', () => {
    // The leave cue and the emptied seat arrive in the same message. Hiding on the
    // seat alone made the leave animation impossible to see.
    let seat = applyCue(initialSeat(true), 'LEAVE_getup', 5)
    seat = syncOccupancy(seat, false, 5)
    expect(seat.phase).toBe('leaving')
    expect(pose(seat, 6).visible).toBe(true)
    expect(pose(seat, 5 + seconds(CLIP_LAST_FRAME.LEAVE_getup) + 0.01).visible).toBe(false)
  })

  it('clears a seat the room empties with no leave cue, and fills one the room fills with no sit cue', () => {
    expect(syncOccupancy(initialSeat(true), false, 1).phase).toBe('absent')
    expect(syncOccupancy(initialSeat(false), true, 1).phase).toBe('seated')
  })

  it('layers the chip push over the idle without taking any weight from it', () => {
    const seat = applyCue(initialSeat(true), 'CHIP_toss', 2)
    const drawn = pose(seat, 2 + seconds(15))
    expect(drawn.idleWeight).toBe(1)
    expect(drawn.body).toBeNull()
    expect(drawn.overlay).toMatchObject({ clip: 'CHIP_toss', weight: 1 })
    expect(drawn.overlay?.frame).toBeCloseTo(15, 6)
    expect(pose(seat, 2 + seconds(31)).overlay).toBeNull()
  })

  it('replaces the idle with the check tap through a short blend, and hands back the same way', () => {
    const seat = applyCue(initialSeat(true), 'CHECK_tap', 0)
    const halfway = pose(seat, BLEND_IN_SECONDS / 2)
    expect(halfway.body?.weight).toBeCloseTo(0.5, 6)
    expect(halfway.idleWeight).toBeCloseTo(0.5, 6)
    const done = seconds(CLIP_LAST_FRAME.CHECK_tap)
    const handingBack = pose(seat, done + BLEND_OUT_SECONDS / 2)
    expect(handingBack.body).toBeNull()
    expect(handingBack.release).toMatchObject({
      clip: 'CHECK_tap',
      frame: CLIP_LAST_FRAME.CHECK_tap,
    })
    expect(handingBack.release?.weight).toBeCloseTo(0.5, 6)
  })

  it('never lets weights leave the rest pose to fill a gap', () => {
    // three.js fills any weight short of one with the bind pose, not the idle, so
    // every drawn frame has to account for all of it.
    let seat = applyCue(initialSeat(true), 'PEEK_card', 0)
    seat = applyCue(seat, 'CHECK_tap', 0.9)
    seat = applyCue(seat, 'ALLIN_standup', 2.0)
    for (let now = 0; now < 7; now += 0.037) {
      expect(totalWeight(seat, now)).toBeCloseTo(1, 9)
    }
  })

  it('does not let a gesture interrupt a full-body clip', () => {
    const entering = applyCue(initialSeat(false), 'SIT_enter', 0)
    for (const clip of ['CHECK_tap', 'PEEK_card', 'CHIP_toss', 'ALLIN_standup'] as const) {
      const after = applyCue(entering, clip, 1)
      expect(after.phase).toBe('entering')
      expect(after.body?.clip).toBe('SIT_enter')
      expect(after.overlay).toBeNull()
    }
    const allIn = applyCue(initialSeat(true), 'ALLIN_standup', 0)
    expect(applyCue(allIn, 'CHECK_tap', 1).body?.clip).toBe('ALLIN_standup')
  })

  it('stands for an all-in, holds the finish, and sits back down from it when the hand is over', () => {
    const allIn = applyCue(initialSeat(true), 'ALLIN_standup', 0)
    const stood = seconds(CLIP_LAST_FRAME.ALLIN_standup) + 2
    const holding = pose(allIn, stood)
    expect(advance(allIn, stood).phase).toBe('standing')
    expect(holding.body).toEqual({
      clip: 'ALLIN_standup',
      frame: CLIP_LAST_FRAME.ALLIN_standup,
      weight: 1,
    })
    expect(holding.chair).toEqual({ clip: 'ALLIN_standup', frame: CLIP_LAST_FRAME.ALLIN_standup })

    const returning = endHand(allIn, stood)
    expect(returning.phase).toBe('returning')
    expect(pose(returning, stood).body).toEqual({
      clip: 'SIT_enter',
      frame: RETURN_FROM_FRAME,
      weight: 1,
    })
    const seated = stood + seconds(CLIP_LAST_FRAME.SIT_enter - RETURN_FROM_FRAME) + 0.01
    expect(advance(returning, seated).phase).toBe('seated')
  })

  it('sits straight back down when the hand ends before the stand-up has finished', () => {
    const allIn = endHand(applyCue(initialSeat(true), 'ALLIN_standup', 0), 1)
    const stoodUp = seconds(CLIP_LAST_FRAME.ALLIN_standup)
    expect(advance(allIn, stoodUp + 0.01).phase).toBe('returning')
    expect(pose(allIn, stoodUp + 0.01).body?.clip).toBe('SIT_enter')
  })

  it('leaves from the standing finish when the player is already on their feet', () => {
    const allIn = applyCue(initialSeat(true), 'ALLIN_standup', 0)
    const standing = seconds(CLIP_LAST_FRAME.ALLIN_standup) + 1
    const leaving = applyCue(allIn, 'LEAVE_getup', standing)
    expect(pose(leaving, standing).body).toEqual({
      clip: 'LEAVE_getup',
      frame: LEAVE_FROM_STANDING_FRAME,
      weight: 1,
    })
  })

  it('restarts the same gesture at full weight rather than blending a clip over itself', () => {
    const first = applyCue(initialSeat(true), 'CHECK_tap', 0)
    const again = applyCue(first, 'CHECK_tap', 0.5)
    const drawn = pose(again, 0.5)
    expect(drawn.body).toEqual({ clip: 'CHECK_tap', frame: 0, weight: 1 })
    expect(drawn.release).toBeNull()
    expect(totalWeight(again, 0.5)).toBeCloseTo(1, 9)
  })

  it('lets a look already under way finish rather than starting it again', () => {
    const first = applyCue(initialSeat(true), 'PEEK_card', 0)
    const again = applyCue(first, 'PEEK_card', 0.6)
    expect(pose(again, 0.6).body?.frame).toBeCloseTo(0.6 * CLIP_FPS, 6)
    // Once it has finished, another look is a new one.
    const later = applyCue(first, 'PEEK_card', seconds(CLIP_LAST_FRAME.PEEK_card) + 1)
    expect(pose(later, seconds(CLIP_LAST_FRAME.PEEK_card) + 1).body?.frame).toBe(0)
  })

  it('lets an action cut a look short instead of losing the action', () => {
    const looking = applyCue(initialSeat(true), 'PEEK_card', 0)
    const pushed = applyCue(looking, 'CHIP_toss', 0.8)
    expect(pushed.phase).toBe('seated')
    const drawn = pose(pushed, 0.8 + seconds(10))
    expect(drawn.overlay).toMatchObject({ clip: 'CHIP_toss' })
    // The look blends out rather than vanishing, and the weights still account for all of it.
    expect(pose(pushed, 0.8 + BLEND_OUT_SECONDS / 2).release?.clip).toBe('PEEK_card')
    for (let now = 0.8; now < 2.5; now += 0.031) {
      expect(totalWeight(pushed, now)).toBeCloseTo(1, 9)
    }
  })

  it('moves the chair only on the tracks that carry chair motion', () => {
    expect(pose(applyCue(initialSeat(true), 'CHECK_tap', 0), 0.5).chair).toBeNull()
    expect(pose(applyCue(initialSeat(true), 'LEAVE_getup', 0), 1).chair?.clip).toBe('LEAVE_getup')
    expect(pose(initialSeat(true), 0).chair).toBeNull()
  })

  it('ignores a leave for a seat nobody is in and a sit for a seat already taken', () => {
    expect(applyCue(initialSeat(false), 'LEAVE_getup', 0).phase).toBe('absent')
    expect(applyCue(initialSeat(true), 'SIT_enter', 0).phase).toBe('seated')
  })
})

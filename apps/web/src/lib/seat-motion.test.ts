import { describe, expect, it } from 'vitest'
import { CLIP_FPS, CLIP_LAST_FRAME } from './animation'
import {
  advance,
  applyCue,
  BLEND_IN_SECONDS,
  BLEND_OUT_SECONDS,
  endHand,
  holdPeek,
  initialSeat,
  PEEK_HOLD_LIMIT_SECONDS,
  poseOf,
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

  it('spawns a new player directly into seated idle without playing sit or moving the chair', () => {
    const entering = applyCue(initialSeat(false), 'SIT_enter', 10)
    const start = pose(entering, 10)
    expect(start.visible).toBe(true)
    expect(start).toMatchObject({
      idleWeight: 1,
      body: null,
      release: null,
      overlay: null,
      chair: null,
    })

    const done = 10 + seconds(CLIP_LAST_FRAME.SIT_enter)
    expect(advance(entering, done + 0.01).phase).toBe('seated')
    expect(pose(entering, done + BLEND_OUT_SECONDS + 0.01)).toMatchObject({
      idleWeight: 1,
      body: null,
      release: null,
      chair: null,
    })
  })

  it('despawns immediately and does not let stale occupied snapshots resurrect a departure', () => {
    let seat = applyCue(initialSeat(true), 'LEAVE_getup', 5)
    expect(pose(seat, 5)).toMatchObject({ visible: false, body: null, chair: null })
    expect(pose(syncOccupancy(seat, true, 5), 5).visible).toBe(false)
    seat = syncOccupancy(seat, false, 5)
    expect(seat.phase).toBe('absent')
    expect(pose(seat, 6).visible).toBe(false)
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
    const allIn = applyCue(initialSeat(true), 'ALLIN_standup', 0)
    for (const clip of ['CHECK_tap', 'PEEK_card', 'CHIP_toss', 'ALLIN_standup'] as const) {
      const after = applyCue(allIn, clip, 1)
      expect(after.phase).toBe('allIn')
      expect(after.body?.clip).toBe('ALLIN_standup')
      expect(after.overlay).toBeNull()
    }
    expect(applyCue(allIn, 'CHECK_tap', 1).body?.clip).toBe('ALLIN_standup')
  })

  it('preserves the all-in and standing hold, then resets to idle without the parked sit', () => {
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
    expect(returning.phase).toBe('seated')
    expect(pose(returning, stood)).toMatchObject({
      idleWeight: 1,
      body: null,
      release: null,
      chair: null,
    })
  })

  it('finishes an all-in whose hand ended early, then resets directly to idle', () => {
    const allIn = endHand(applyCue(initialSeat(true), 'ALLIN_standup', 0), 1)
    const stoodUp = seconds(CLIP_LAST_FRAME.ALLIN_standup)
    expect(pose(allIn, 1).body?.clip).toBe('ALLIN_standup')
    expect(advance(allIn, stoodUp + 0.01).phase).toBe('seated')
    expect(pose(allIn, stoodUp + 0.01)).toMatchObject({
      body: null,
      release: null,
      idleWeight: 1,
      chair: null,
    })
  })

  it('despawns from a standing all-in without playing leave', () => {
    const allIn = applyCue(initialSeat(true), 'ALLIN_standup', 0)
    const standing = seconds(CLIP_LAST_FRAME.ALLIN_standup) + 1
    const leaving = applyCue(allIn, 'LEAVE_getup', standing)
    expect(pose(leaving, standing)).toMatchObject({ visible: false, body: null, chair: null })
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

  it('holds a look open while the cards are held, and finishes it when they are let go', () => {
    const looking = applyCue(initialSeat(true), 'PEEK_card', 0)
    const held = holdPeek(looking, true, 22, 0.1)
    // Long past the clip's own length, still up.
    expect(pose(held, 5).body?.frame).toBe(22)
    expect(advance(held, 5).phase).toBe('gesture')
    const released = holdPeek(advance(held, 5), false, 22, 5)
    expect(pose(released, 5).body?.frame).toBe(22)
    const rest = (CLIP_LAST_FRAME.PEEK_card - 22) / CLIP_FPS
    expect(advance(released, 5 + rest + 0.01).phase).toBe('seated')
  })

  it('lets a held look go on its own if the release never comes', () => {
    const held = holdPeek(applyCue(initialSeat(true), 'PEEK_card', 0), true, 22, 0.1)
    const later = advance(held, 0.1 + PEEK_HOLD_LIMIT_SECONDS + 0.01)
    expect(later.body?.holdAt).toBeUndefined()
  })

  it('moves the chair only on the tracks that carry chair motion', () => {
    expect(pose(applyCue(initialSeat(true), 'CHECK_tap', 0), 0.5).chair).toBeNull()
    expect(pose(applyCue(initialSeat(true), 'LEAVE_getup', 0), 1).chair).toBeNull()
    expect(pose(initialSeat(true), 0).chair).toBeNull()
  })

  it('ignores a leave for a seat nobody is in and a sit for a seat already taken', () => {
    expect(applyCue(initialSeat(false), 'LEAVE_getup', 0).phase).toBe('absent')
    expect(applyCue(initialSeat(true), 'SIT_enter', 0).phase).toBe('seated')
  })

  it('spawns cleanly after leaving during a held peek or an additive push', () => {
    const looking = holdPeek(applyCue(initialSeat(true), 'PEEK_card', 0), true, 22, 0.1)
    const pushing = applyCue(initialSeat(true), 'CHIP_toss', 0)
    for (const active of [looking, pushing]) {
      const gone = applyCue(active, 'LEAVE_getup', 0.5)
      expect(pose(gone, 0.5).visible).toBe(false)
      const spawned = applyCue(gone, 'SIT_enter', 0.6)
      expect(pose(spawned, 0.6)).toMatchObject({
        visible: true,
        idleWeight: 1,
        body: null,
        release: null,
        overlay: null,
        chair: null,
      })
      expect(pose(applyCue(spawned, 'CHECK_tap', 0.7), 1).body?.clip).toBe('CHECK_tap')
    }
  })
})

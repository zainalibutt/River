import { BLEND, CLIP_FPS, CLIP_LAST_FRAME, type ClipName } from './animation'

/**
 * What one seat's body is doing, as a pure state machine the scene reads every frame.
 *
 * The browser used to play every clip additively over the idle and let the mixer sort
 * out the rest. That only works for a gesture that starts where the idle already is. A
 * sit starts standing beside the chair, a leave ends a step away from it, and an all-in
 * ends upright: layered over a seated idle those drive the body through the chair. So
 * full-body clips replace the idle outright, one at a time, and the seat has to know
 * which one it is in. Keeping that here, away from three.js, is what lets it be tested.
 *
 * Times are seconds on the scene clock. Frames are clip frames at CLIP_FPS.
 */
export type SeatPhase =
  /** Nobody in the seat. The body is hidden. */
  | 'absent'
  /** SIT_enter from its first frame: walking in and sitting down. */
  | 'entering'
  /** The idle, possibly with the additive chip push over it. */
  | 'seated'
  /** CHECK_tap or PEEK_card in place of the idle. */
  | 'gesture'
  /** ALLIN_standup. */
  | 'allIn'
  /** Held on the all-in's last frame until the hand is over. */
  | 'standing'
  /** SIT_enter from RETURN_FROM_FRAME: sitting back down after an all-in. */
  | 'returning'
  /** LEAVE_getup: getting up and stepping away. */
  | 'leaving'

export interface ClipSpan {
  clip: ClipName
  startedAt: number
  fromFrame: number
  toFrame: number
  /** Whether this clip ramps in over the pose before it, or starts at full weight. */
  blendIn: boolean
}

export interface Release {
  clip: ClipName
  /** The frame the clip is held on while it hands back to what follows. */
  frame: number
  releasedAt: number
}

export interface SeatState {
  phase: SeatPhase
  body: ClipSpan | null
  release: Release | null
  overlay: (ClipSpan & { fadingFrom: number | null }) | null
  /** An all-in whose hand ended before the player finished standing sits straight back down. */
  returnAfterAllIn: boolean
}

export interface WeightedClip {
  clip: ClipName
  frame: number
  weight: number
}

export interface SeatPose {
  visible: boolean
  /** Weight of the looping idle. Idle, body and release always sum to one. */
  idleWeight: number
  body: WeightedClip | null
  release: WeightedClip | null
  overlay: WeightedClip | null
  /** Which chair track moves this seat's chair, and where in it. Null keeps the chair in. */
  chair: { clip: ClipName; frame: number } | null
}

export const BLEND_IN_SECONDS = 0.2
export const BLEND_OUT_SECONDS = 0.25
/**
 * SIT_enter's frame 40 is ALLIN_standup's last frame exactly: the seat transitions were
 * authored from the accepted all-in's standing finish, and the rebaked clips measure no
 * difference between the two. Sitting back down after an all-in is the rest of the sit.
 */
export const RETURN_FROM_FRAME = 40
/**
 * LEAVE_getup holds the all-in's standing finish from frame 78 to 87, keyed from the same
 * pose, so a player who is already standing leaves from there rather than sitting first.
 */
export const LEAVE_FROM_STANDING_FRAME = 78

const EMPTY: SeatState = {
  phase: 'absent',
  body: null,
  release: null,
  overlay: null,
  returnAfterAllIn: false,
}

export function initialSeat(occupied: boolean): SeatState {
  return occupied ? { ...EMPTY, phase: 'seated' } : EMPTY
}

function span(clip: ClipName, now: number, fromFrame: number, blendIn: boolean): ClipSpan {
  return { clip, startedAt: now, fromFrame, toFrame: CLIP_LAST_FRAME[clip], blendIn }
}

export function frameOf(clip: ClipSpan, now: number): number {
  return Math.min(clip.toFrame, clip.fromFrame + Math.max(0, now - clip.startedAt) * CLIP_FPS)
}

function finished(clip: ClipSpan, now: number): boolean {
  return clip.fromFrame + (now - clip.startedAt) * CLIP_FPS >= clip.toFrame
}

function ramp(elapsed: number, seconds: number): number {
  return Math.min(1, Math.max(0, elapsed / seconds))
}

/** Freeze whatever replaces the idle right now, so the next clip can blend over it. */
function releaseOf(state: SeatState, now: number): Release | null {
  if (state.body !== null) {
    return { clip: state.body.clip, frame: frameOf(state.body, now), releasedAt: now }
  }
  return state.release
}

function fadeOverlay(state: SeatState, now: number): SeatState['overlay'] {
  if (state.overlay === null || state.overlay.fadingFrom !== null) return state.overlay
  return { ...state.overlay, fadingFrom: now }
}

/** Start a replacing clip over whatever the seat is showing. */
function replaceWith(
  state: SeatState,
  phase: SeatPhase,
  clip: ClipName,
  now: number,
  fromFrame: number,
  blendIn: boolean,
): SeatState {
  return {
    phase,
    body: span(clip, now, fromFrame, blendIn),
    release: blendIn ? releaseOf(state, now) : null,
    overlay: fadeOverlay(state, now),
    returnAfterAllIn: false,
  }
}

/** A cue arriving at `now`. Cues that make no sense for the seat's phase are dropped. */
export function applyCue(state: SeatState, clip: ClipName, now: number): SeatState {
  const current = advance(state, now)
  switch (clip) {
    case 'SIT_enter':
      if (current.phase === 'absent') return replaceWith(current, 'entering', clip, now, 0, false)
      if (current.phase === 'leaving') return replaceWith(current, 'entering', clip, now, 0, true)
      return current
    case 'LEAVE_getup':
      if (current.phase === 'absent' || current.phase === 'leaving') return current
      if (current.phase === 'standing') {
        return replaceWith(current, 'leaving', clip, now, LEAVE_FROM_STANDING_FRAME, false)
      }
      if (current.phase === 'allIn' || current.phase === 'returning') {
        return replaceWith(current, 'leaving', clip, now, LEAVE_FROM_STANDING_FRAME, true)
      }
      return replaceWith(current, 'leaving', clip, now, 0, true)
    case 'ALLIN_standup':
      if (current.phase === 'seated' || current.phase === 'gesture') {
        return replaceWith(current, 'allIn', clip, now, 0, true)
      }
      return current
    case 'CHECK_tap':
    case 'PEEK_card':
      if (current.body !== null && current.body.clip === clip) {
        // A look already under way is the same look. Looks now arrive from the player's
        // own presses and from the server, and snapping a card back to the felt to lift
        // it again on every one of them reads as a twitch.
        if (clip === 'PEEK_card') return current
        // The same tap again restarts at full weight. Blending a clip over itself needs
        // two actions for one clip, which a mixer will not give, and dipping back through
        // the idle to start again reads as a stumble.
        return replaceWith(current, 'gesture', clip, now, 0, false)
      }
      if (current.phase === 'seated' || current.phase === 'gesture') {
        return replaceWith(current, 'gesture', clip, now, 0, true)
      }
      return current
    case 'CHIP_toss':
    case 'FOLD_muck':
      if (current.phase === 'gesture') {
        // The action lands while he is still looking at his cards. The look gives way,
        // blended out, and the push plays over the idle it hands back to. Dropping the
        // push instead is how a bot that looked at its cards before betting came to put
        // its chips in without moving.
        return {
          ...current,
          phase: 'seated',
          body: null,
          release: releaseOf(current, now),
          overlay: { ...span(clip, now, 0, false), fadingFrom: null },
        }
      }
      if (current.phase !== 'seated') return current
      return { ...current, overlay: { ...span(clip, now, 0, false), fadingFrom: null } }
    default:
      return current
  }
}

/** The hand is over: anyone standing for an all-in sits back down. */
export function endHand(state: SeatState, now: number): SeatState {
  const current = advance(state, now)
  if (current.phase === 'standing') {
    return replaceWith(current, 'returning', 'SIT_enter', now, RETURN_FROM_FRAME, false)
  }
  if (current.phase === 'allIn') return { ...current, returnAfterAllIn: true }
  return current
}

/**
 * The room's word on whether anyone is in the seat.
 *
 * A seat the room fills without a sit cue - the page loading onto a table in progress,
 * or a reconnect - is shown seated at once. A seat the room empties without a leave cue
 * is cleared at once. A leave already under way is left to finish, which is the whole
 * point of tracking it: the seat empties in the same message that asks for the leave.
 */
export function syncOccupancy(state: SeatState, occupied: boolean, now: number): SeatState {
  const current = advance(state, now)
  if (occupied && current.phase === 'absent') return { ...EMPTY, phase: 'seated' }
  if (!occupied && current.phase !== 'absent' && current.phase !== 'leaving') return EMPTY
  return current
}

/** Move the seat on to whatever follows a clip that has finished. */
export function advance(state: SeatState, now: number): SeatState {
  let next = state
  if (next.overlay !== null) {
    const fadedOut =
      next.overlay.fadingFrom !== null && now - next.overlay.fadingFrom >= BLEND_IN_SECONDS
    if (fadedOut || finished(next.overlay, now)) next = { ...next, overlay: null }
  }
  if (next.release !== null && now - next.release.releasedAt >= BLEND_OUT_SECONDS) {
    next = { ...next, release: null }
  }
  const body = next.body
  if (body === null || !finished(body, now)) return next
  const endedAt = body.startedAt + (body.toFrame - body.fromFrame) / CLIP_FPS
  const handBack: Release = { clip: body.clip, frame: body.toFrame, releasedAt: endedAt }
  switch (next.phase) {
    case 'entering':
    case 'gesture':
    case 'returning':
      return advance({ ...next, phase: 'seated', body: null, release: handBack }, now)
    case 'allIn':
      if (next.returnAfterAllIn) {
        return advance(
          {
            ...next,
            phase: 'returning',
            body: span('SIT_enter', endedAt, RETURN_FROM_FRAME, false),
            release: null,
            returnAfterAllIn: false,
          },
          now,
        )
      }
      // Held on the last frame at full weight. Keeping the all-in's own ramp here would
      // blend the standing figure back in from the seated idle all over again.
      return {
        ...next,
        phase: 'standing',
        body: { ...body, startedAt: endedAt, fromFrame: body.toFrame, blendIn: false },
      }
    case 'standing':
      return next
    case 'leaving':
      return EMPTY
    default:
      return next
  }
}

/** What to draw for the seat at `now`. Call `advance` first. */
export function poseOf(state: SeatState, now: number): SeatPose {
  if (state.phase === 'absent') {
    return { visible: false, idleWeight: 1, body: null, release: null, overlay: null, chair: null }
  }
  const body = state.body
  const bodyWeight =
    body === null ? 0 : body.blendIn ? ramp(now - body.startedAt, BLEND_IN_SECONDS) : 1
  const releaseShare =
    state.release === null ? 0 : 1 - ramp(now - state.release.releasedAt, BLEND_OUT_SECONDS)
  const releaseWeight = (1 - bodyWeight) * releaseShare
  const idleWeight = Math.max(0, 1 - bodyWeight - releaseWeight)
  let overlay: WeightedClip | null = null
  if (state.overlay !== null && BLEND[state.overlay.clip] === 'additive') {
    const fade =
      state.overlay.fadingFrom === null
        ? 1
        : 1 - ramp(now - state.overlay.fadingFrom, BLEND_IN_SECONDS)
    overlay = { clip: state.overlay.clip, frame: frameOf(state.overlay, now), weight: fade }
  }
  return {
    visible: true,
    idleWeight,
    body: body === null ? null : { clip: body.clip, frame: frameOf(body, now), weight: bodyWeight },
    release:
      state.release === null || releaseWeight <= 0
        ? null
        : { clip: state.release.clip, frame: state.release.frame, weight: releaseWeight },
    overlay,
    chair: chairTrack(state, now),
  }
}

function chairTrack(state: SeatState, now: number): SeatPose['chair'] {
  const body = state.body
  if (body === null) return null
  if (body.clip === 'SIT_enter' || body.clip === 'LEAVE_getup' || body.clip === 'ALLIN_standup') {
    return { clip: body.clip, frame: frameOf(body, now) }
  }
  return null
}

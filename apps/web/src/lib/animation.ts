import type { RoomEvent } from '@river/server'

/**
 * The clips the native Silver character carries, by their names in its GLB.
 *
 * This list is the contract with the art pipeline: it is the allow-list
 * `export_silver_integration.py` ships and `check_character_glb.py` enforces.
 * A clip that is not here cannot be played, and a name here that the rig does
 * not carry is a build error rather than a silent no-op - see `missingClips`.
 *
 * Fold, win and lose gestures exist in an earlier library but are not part of
 * this character yet, so those events play nothing rather than the nearest
 * clip.
 */
export const CLIPS = [
  'IDLE_thinking_readable',
  'CHECK_tap',
  'PEEK_card',
  'CHIP_toss',
  'ALLIN_standup',
  'SIT_enter',
  'LEAVE_getup',
] as const

export type ClipName = (typeof CLIPS)[number]

/** The clip that runs whenever a seated player is doing nothing else. */
export const IDLE_CLIP: ClipName = 'IDLE_thinking_readable'

/** Every clip was authored and exported at this rate; frames below are its frames. */
export const CLIP_FPS = 30

/** The last frame of each clip. Every clip starts on frame 0. */
export const CLIP_LAST_FRAME: Readonly<Record<ClipName, number>> = {
  IDLE_thinking_readable: 120,
  CHECK_tap: 36,
  PEEK_card: 48,
  CHIP_toss: 30,
  ALLIN_standup: 90,
  SIT_enter: 108,
  LEAVE_getup: 132,
}

/**
 * How a clip combines with the idle underneath it.
 *
 * Additive is only correct for a clip whose first frame is the pose the idle is
 * already in, because additive playback applies the clip as a change from its
 * own first frame. Measured on the rebaked clips, CHIP_toss starts and ends on
 * the idle's first frame exactly. CHECK_tap and PEEK_card start and end with the
 * left hand about 186mm from where the idle holds it, so layered they would tap
 * and peek from the wrong place; they replace the idle for their length instead,
 * with a short blend either side. The sit, the leave and the all-in move the
 * whole body and are never averaged with a seated idle.
 */
export type BlendMode = 'additive' | 'replace'

export const BLEND: Readonly<Record<ClipName, BlendMode>> = {
  IDLE_thinking_readable: 'replace',
  CHECK_tap: 'replace',
  PEEK_card: 'replace',
  CHIP_toss: 'additive',
  ALLIN_standup: 'replace',
  SIT_enter: 'replace',
  LEAVE_getup: 'replace',
}

export interface AnimationCue {
  seat: number
  clip: ClipName
  loop: boolean
  /** Seconds to wait before playing. Never gates the hand - see below. */
  delaySeconds: number
  /** Higher wins when two cues land on one seat in the same frame. */
  priority: number
  /**
   * Where this cue sits in the table's running order, stamped when it is queued.
   *
   * Cues used to reach the scene as "the latest batch", a whole array replaced on every
   * message. Two messages landing before the scene rendered - a bot's action and a look at
   * the cards, say - left only the second batch for it to read, and the first gesture was
   * never played. The scene now reads a running list and plays what is newer than the last
   * cue it saw.
   */
  serial?: number
}

/**
 * The reference game spent years patching out cinematic delay, and the notes
 * say the second biggest mistake available here is making every animation
 * blocking. So a cue is fire and forget: it carries a delay for staggering, and
 * nothing anywhere waits on one finishing. If the server settles a hand while a
 * chip toss is mid-flight, the chip toss loses.
 *
 * Leaving outranks everything, because a player who has gone must be seen to
 * go; sitting down outranks every gesture for the same reason.
 */
const PRIORITY = {
  idle: 0,
  peek: 10,
  check: 15,
  chips: 20,
  allIn: 50,
  sit: 60,
  leave: 70,
} as const

/**
 * A seat's idle offset, in seconds.
 *
 * Eight characters breathing on the same frame reads as a row of clones. The
 * offset is derived from the seat rather than randomised, so a reconnecting
 * player rejoins the table they left instead of one that resynchronised.
 */
export function idlePhaseFor(seat: number): number {
  const scattered = Math.abs(Math.sin(seat * 12.9898) * 43758.5453)
  return Number(((scattered % 1) * 4).toFixed(3))
}

export function idleCueFor(seat: number): AnimationCue {
  return {
    seat,
    clip: IDLE_CLIP,
    loop: true,
    delaySeconds: idlePhaseFor(seat),
    priority: PRIORITY.idle,
  }
}

/**
 * When a seat looks at its cards after the deal, in seconds.
 *
 * Everyone lifting their cards on the same frame reads as a drill. Spread over
 * a little over a second, by seat, so it is the same for everyone watching.
 */
export function peekDelayFor(seat: number): number {
  return Number((0.35 + (idlePhaseFor(seat + 11) / 4) * 1.2).toFixed(3))
}

export interface CueContext {
  /** Seats dealt into the hand that has just started, for the peek. */
  seatsInHand?: readonly number[]
}

/**
 * What one room event should make a seat do.
 *
 * Returns nothing for events with no matching clip rather than reaching for the
 * nearest one. A wrong gesture is worse than none: a player reads a shrug as a
 * tell and it means nothing at all.
 */
export function cueForEvent(
  event: RoomEvent,
  seatOf: (playerId: string) => number,
  context: CueContext = {},
): AnimationCue[] {
  switch (event.kind) {
    case 'acted':
    case 'awayPlayed':
    case 'timedOut': {
      const seat = seatOf(event.playerId)
      if (seat < 0) return []
      const clip = clipForAction(event.action.kind)
      return clip === null ? [] : [once(seat, clip, priorityForClip(clip))]
    }
    case 'blinds':
      return event.posts.map((post) => once(post.seat, 'CHIP_toss', PRIORITY.chips))
    case 'seated':
      return [once(event.seat, 'SIT_enter', PRIORITY.sit)]
    case 'stood':
      return [once(event.seat, 'LEAVE_getup', PRIORITY.leave)]
    case 'handStarted':
      return (context.seatsInHand ?? []).map((seat) => ({
        ...once(seat, 'PEEK_card', PRIORITY.peek),
        delaySeconds: peekDelayFor(seat),
      }))
    default:
      return []
  }
}

function clipForAction(kind: string): ClipName | null {
  switch (kind) {
    case 'check':
      return 'CHECK_tap'
    case 'call':
    case 'raiseTo':
      return 'CHIP_toss'
    case 'allIn':
      return 'ALLIN_standup'
    case 'fold':
      // There is no fold clip on this character, and for as long as the cards stayed where
      // they were no clip was the honest answer: a gesture that moves nothing reads as a
      // tell that means nothing. The cards now leave. A fold is the push - a player sliding
      // his cards forward to the muck is the push with cards under the hand instead of
      // chips - and the scene sends the cards off with it. A clip authored for the fold
      // replaces this rather than sitting beside it.
      return 'CHIP_toss'
    default:
      return null
  }
}

function priorityForClip(clip: ClipName): number {
  if (clip === 'ALLIN_standup') return PRIORITY.allIn
  if (clip === 'CHECK_tap') return PRIORITY.check
  if (clip === 'PEEK_card') return PRIORITY.peek
  return PRIORITY.chips
}

function once(seat: number, clip: ClipName, priority: number): AnimationCue {
  return { seat, clip, loop: false, delaySeconds: 0, priority }
}

/** A seat looking at its cards now: pressed by its player, or announced by the table. */
export function peekCue(seat: number): AnimationCue {
  return once(seat, 'PEEK_card', PRIORITY.peek)
}

/** How many cues the running list keeps. The scene only ever reads the newest few. */
export const CUE_HISTORY = 48

/**
 * The cues a consumer has not played yet, oldest first.
 *
 * A cue with no serial predates the running list and is always new, which keeps a caller
 * that hands over a single batch working as it did.
 */
export function unplayedCues(
  cues: readonly AnimationCue[],
  lastPlayed: number,
): { fresh: AnimationCue[]; lastPlayed: number } {
  let newest = lastPlayed
  const fresh: AnimationCue[] = []
  for (const cue of cues) {
    if (cue.serial !== undefined && cue.serial <= lastPlayed) continue
    fresh.push(cue)
    if (cue.serial !== undefined) newest = Math.max(newest, cue.serial)
  }
  return { fresh, lastPlayed: newest }
}

/**
 * One cue per seat, highest priority winning.
 *
 * A seat that goes all in and gets up in the same batch should leave, not
 * stand for the all-in, and the order the server happened to emit the events in
 * is not a reason to pick differently. Ties keep the earlier cue, so the
 * resolution is stable for the same input.
 */
export function resolveCues(cues: readonly AnimationCue[]): AnimationCue[] {
  const bySeat = new Map<number, AnimationCue>()
  for (const cue of cues) {
    const held = bySeat.get(cue.seat)
    if (held === undefined || cue.priority > held.priority) bySeat.set(cue.seat, cue)
  }
  return [...bySeat.values()].sort((left, right) => left.seat - right.seat)
}

/** Every cue a batch of events should produce, already resolved per seat. */
export function cuesForEvents(
  events: readonly RoomEvent[],
  seatOf: (playerId: string) => number,
  context: CueContext = {},
): AnimationCue[] {
  return resolveCues(events.flatMap((event) => cueForEvent(event, seatOf, context)))
}

/**
 * Whether a batch of events ends a hand.
 *
 * A player who stood up for an all-in sits back down when the hand is over, and
 * this is the moment. The record and the gap before the next hand both mean it,
 * and either arriving alone is enough.
 */
export function endsHand(events: readonly RoomEvent[]): boolean {
  return events.some((event) => event.kind === 'handRecorded' || event.kind === 'between')
}

/**
 * Clips the contract expects that a loaded character does not carry.
 *
 * A silent absence is how the last five modules on this project ended up wired
 * to nothing, so the scene says which are missing rather than playing fewer.
 */
export function missingClips(available: readonly string[]): ClipName[] {
  const present = new Set(available)
  return CLIPS.filter((clip) => !present.has(clip))
}

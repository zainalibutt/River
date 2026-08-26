import type { RoomEvent } from '@river/server'

/**
 * The clips authored on the character rig, by their names in the GLB.
 *
 * This list is the contract with the art pipeline. A clip that is not here
 * cannot be played, and a name here that the rig does not carry is a build
 * error rather than a silent no-op - see `missingClips`.
 */
export const CLIPS = [
  'IDLE_breathe',
  'CHIP_toss',
  'DEAL_toss',
  'FOLD_muck',
  'PEEK_card',
  'PRESET_reach',
  'REACT_win',
  'REACT_lose',
  'ALLIN_standup',
] as const

export type ClipName = (typeof CLIPS)[number]

export interface AnimationCue {
  seat: number
  clip: ClipName
  loop: boolean
  /** Seconds to wait before playing. Never gates the hand - see below. */
  delaySeconds: number
  /** Higher wins when two cues land on one seat in the same frame. */
  priority: number
}

/**
 * the reference spent years patching out cinematic delay, and the reference notes
 * say the second biggest mistake available here is making every animation
 * blocking. So a cue is fire and forget: it carries a delay for staggering, and
 * nothing anywhere waits on one finishing. If the server settles a hand while a
 * chip toss is mid-flight, the chip toss loses.
 */
const PRIORITY = {
  idle: 0,
  peek: 10,
  chips: 20,
  fold: 30,
  react: 40,
  allIn: 50,
} as const

/**
 * A seat's idle offset, in seconds.
 *
 * Nine characters breathing on the same frame reads as a row of clones. The
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
    clip: 'IDLE_breathe',
    loop: true,
    delaySeconds: idlePhaseFor(seat),
    priority: PRIORITY.idle,
  }
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
    case 'uncontested': {
      const seat = seatOf(event.playerId)
      return seat < 0 ? [] : [once(seat, 'REACT_win', PRIORITY.react)]
    }
    case 'showdown':
      return event.awards.flatMap((award) => {
        const seat = seatOf(award.playerId)
        return seat < 0 ? [] : [once(seat, 'REACT_win', PRIORITY.react)]
      })
    case 'bust': {
      const seat = seatOf(event.playerId)
      return seat < 0 ? [] : [once(seat, 'REACT_lose', PRIORITY.react)]
    }
    default:
      return []
  }
}

function clipForAction(kind: string): ClipName | null {
  switch (kind) {
    case 'fold':
      return 'FOLD_muck'
    case 'call':
    case 'raiseTo':
      return 'CHIP_toss'
    case 'allIn':
      return 'ALLIN_standup'
    default:
      // A check has no gesture on this rig. Nothing is the honest answer.
      return null
  }
}

function priorityForClip(clip: ClipName): number {
  if (clip === 'ALLIN_standup') return PRIORITY.allIn
  if (clip === 'FOLD_muck') return PRIORITY.fold
  if (clip === 'PEEK_card') return PRIORITY.peek
  return PRIORITY.chips
}

function once(seat: number, clip: ClipName, priority: number): AnimationCue {
  return { seat, clip, loop: false, delaySeconds: 0, priority }
}

/**
 * One cue per seat, highest priority winning.
 *
 * A seat that goes all in and wins in the same batch should stand up, not
 * shuffle chips, and the order the server happened to emit the events in is not
 * a reason to pick differently. Ties keep the earlier cue, so the resolution is
 * stable for the same input.
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
): AnimationCue[] {
  return resolveCues(events.flatMap((event) => cueForEvent(event, seatOf)))
}

/**
 * Clips the contract expects that a loaded rig does not carry.
 *
 * The venue GLBs currently export nine skins and zero animations, so this
 * returns the whole list. That is the point: a silent absence is how the last
 * five modules on this project ended up wired to nothing.
 */
export function missingClips(available: readonly string[]): ClipName[] {
  const present = new Set(available)
  return CLIPS.filter((clip) => !present.has(clip))
}

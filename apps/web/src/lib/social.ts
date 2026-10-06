import type { Emote } from '@river/server'
import type { SocialEvent } from '@river/server/wire'

export const EMOTE_LABELS: Record<Emote, string> = {
  wave: 'WAVE',
  laugh: 'LAUGH',
  facepalm: 'FACEPALM',
  fistPump: 'FIST PUMP',
  chipTrick: 'CHIP TRICK',
  dance: 'DANCE',
  confetti: 'CONFETTI',
  tableKnock: 'KNOCK',
}

export const EMOTE_ORDER: readonly Emote[] = [
  'wave',
  'laugh',
  'fistPump',
  'facepalm',
  'chipTrick',
  'tableKnock',
  'dance',
  'confetti',
]

export type SocialFeedKind = 'chat' | 'emote' | 'vo'

export interface SocialFeedEntry {
  id: string
  kind: SocialFeedKind
  playerId: string
  name: string
  text: string
  self: boolean
  atMs: number
}

/** The feed is a side panel, not a log. Older lines are dropped rather than paged. */
export const FEED_LIMIT = 60

export const CHAT_MAX_LENGTH = 240

export interface FeedContext {
  selfId: string
  nameFor: (playerId: string) => string
}

/**
 * Emotes are refused during your own decision window - the server enforces this
 * and returns an error. Mirroring the rule here means the button reads as
 * unavailable rather than failing after the click.
 */
export function canSendEmote(isLocalTurn: boolean, connected: boolean): boolean {
  return connected && !isLocalTurn
}

export function normaliseChat(text: string): string | null {
  const trimmed = text.trim().replace(/\s+/g, ' ')
  if (trimmed.length === 0) return null
  return trimmed.slice(0, CHAT_MAX_LENGTH)
}

function voText(trigger: 'allIn' | 'win' | 'loss'): string {
  switch (trigger) {
    case 'allIn':
      return 'shoves it all in'
    case 'win':
      return 'takes it down'
    default:
      return 'lets it go'
  }
}

/**
 * Fold a social event into the feed.
 *
 * Returns the same array reference when the event contributes no line, so React
 * does not re-render the panel for a speaking flag flicking on and off.
 */
export function appendSocialEvent(
  feed: readonly SocialFeedEntry[],
  event: SocialEvent,
  context: FeedContext,
): readonly SocialFeedEntry[] {
  let entry: SocialFeedEntry | null = null
  const base = (kind: SocialFeedKind, text: string, atMs: number): SocialFeedEntry => ({
    id: `${kind}:${event.playerId}:${atMs}:${text.slice(0, 12)}`,
    kind,
    playerId: event.playerId,
    name: context.nameFor(event.playerId),
    text,
    self: event.playerId === context.selfId,
    atMs,
  })

  if (event.kind === 'chat') {
    const text = normaliseChat(event.text)
    if (text !== null) entry = base('chat', text, event.sentAtMs)
  } else if (event.kind === 'emote') {
    entry = base('emote', EMOTE_LABELS[event.emote], event.sentAtMs)
  } else if (event.kind === 'avatarVo') {
    entry = base('vo', voText(event.trigger), event.sentAtMs)
  }

  // speaking and emoteInterrupted drive indicators, not feed lines.
  if (entry === null) return feed
  const next = [...feed, entry]
  return next.length > FEED_LIMIT ? next.slice(next.length - FEED_LIMIT) : next
}

/** Speaking is a live indicator set, not a feed. */
export function applySpeaking(
  speaking: ReadonlySet<string>,
  event: SocialEvent,
): ReadonlySet<string> {
  if (event.kind !== 'speaking') return speaking
  const next = new Set(speaking)
  if (event.speaking) next.add(event.playerId)
  else next.delete(event.playerId)
  return next
}

/** Lines a player can send in one tap: short, friendly, and what a table of friends says. */
export const QUICK_LINES = ['Nice hand', 'Good luck', 'Unlucky', 'Well played', 'Thanks'] as const

/** How long a line stays up at the seat that said it. */
export const BUBBLE_MS = 4_200

/** A line said at the table, shown for a moment at the speaker's seat. */
export interface SeatBubble {
  id: number
  seat: number
  text: string
  kind: 'chat' | 'emote'
  /** When it comes down, on the page's clock. */
  until: number
}

/**
 * The bubble a chat line or an emote puts up at its speaker's seat, or null for anything
 * else, or for somebody not seated. Bots speak through chat too, so their lines come up at
 * their seats - the one place their personalities could be seen and never were.
 */
export function bubbleFor(
  event: SocialEvent,
  seatOf: (playerId: string) => number | null,
  id: number,
  now: number,
): SeatBubble | null {
  if (event.kind !== 'chat' && event.kind !== 'emote') return null
  const seat = seatOf(event.playerId)
  if (seat === null) return null
  const text = event.kind === 'chat' ? normaliseChat(event.text) : EMOTE_LABELS[event.emote]
  if (text === null) return null
  return { id, seat, text, kind: event.kind, until: now + BUBBLE_MS }
}

/** Bubbles after a new one: one per seat, the newest replacing whatever that seat said. */
export function withBubble(
  bubbles: readonly SeatBubble[],
  bubble: SeatBubble,
  now: number,
): readonly SeatBubble[] {
  return [...bubbles.filter((entry) => entry.seat !== bubble.seat && entry.until > now), bubble]
}

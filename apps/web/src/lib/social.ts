import type { Emote } from '@river/server'
import type { SocialEvent } from '@river/server/wire'

export const EMOTE_LABELS: Record<Emote, string> = {
  wave: 'WAVE',
  laugh: 'LAUGH',
  facepalm: 'FACEPALM',
  fistPump: 'FIST PUMP',
  throatSlit: 'THROAT SLIT',
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
  'throatSlit',
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

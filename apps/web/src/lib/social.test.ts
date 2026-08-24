import type { SocialEvent } from '@river/server/wire'
import { describe, expect, it } from 'vitest'
import {
  appendSocialEvent,
  applySpeaking,
  CHAT_MAX_LENGTH,
  canSendEmote,
  FEED_LIMIT,
  normaliseChat,
  type SocialFeedEntry,
} from './social.js'

const context = { selfId: 'alice', nameFor: (id: string) => (id === 'alice' ? 'Alice' : 'Bob') }

function chat(text: string, playerId = 'bob', sentAtMs = 1000): SocialEvent {
  return { kind: 'chat', playerId, text, sentAtMs }
}

describe('social feed', () => {
  it('refuses emotes during your own decision window', () => {
    expect(canSendEmote(false, true)).toBe(true)
    expect(canSendEmote(true, true)).toBe(false)
    expect(canSendEmote(false, false)).toBe(false)
  })

  it('drops empty and whitespace-only chat', () => {
    expect(normaliseChat('   ')).toBeNull()
    expect(normaliseChat('')).toBeNull()
    expect(normaliseChat('  hi  ')).toBe('hi')
  })

  it('collapses runs of whitespace so a wall of newlines cannot stretch the panel', () => {
    expect(normaliseChat('nice    hand\n\n\n\nmate')).toBe('nice hand mate')
  })

  it('truncates rather than rejecting a long message', () => {
    const long = 'a'.repeat(CHAT_MAX_LENGTH + 200)
    expect(normaliseChat(long)?.length).toBe(CHAT_MAX_LENGTH)
  })

  it('marks your own lines as self', () => {
    const feed = appendSocialEvent([], chat('hello', 'alice'), context)
    expect(feed[0]?.self).toBe(true)
    expect(feed[0]?.name).toBe('Alice')
  })

  it('renders an emote as a labelled line', () => {
    const feed = appendSocialEvent(
      [],
      { kind: 'emote', playerId: 'bob', emote: 'fistPump', sentAtMs: 5 },
      context,
    )
    expect(feed[0]).toMatchObject({ kind: 'emote', text: 'FIST PUMP', self: false })
  })

  it('renders avatar VO as narration, not as speech', () => {
    const feed = appendSocialEvent(
      [],
      { kind: 'avatarVo', playerId: 'bob', trigger: 'allIn', sentAtMs: 5 },
      context,
    )
    expect(feed[0]).toMatchObject({ kind: 'vo', text: 'shoves it all in' })
  })

  it('returns the same array when an event contributes no line', () => {
    const feed: readonly SocialFeedEntry[] = []
    const same = appendSocialEvent(
      feed,
      { kind: 'speaking', playerId: 'bob', speaking: true },
      context,
    )
    expect(same).toBe(feed)
  })

  it('does not add a feed line for an interrupted emote', () => {
    const feed: readonly SocialFeedEntry[] = []
    expect(appendSocialEvent(feed, { kind: 'emoteInterrupted', playerId: 'bob' }, context)).toBe(
      feed,
    )
  })

  it('caps the feed and keeps the newest lines', () => {
    let feed: readonly SocialFeedEntry[] = []
    for (let index = 0; index < FEED_LIMIT + 25; index++) {
      feed = appendSocialEvent(feed, chat(`m${index}`, 'bob', index), context)
    }
    expect(feed).toHaveLength(FEED_LIMIT)
    expect(feed[feed.length - 1]?.text).toBe(`m${FEED_LIMIT + 24}`)
  })

  it('tracks speaking as a set, not a feed', () => {
    let speaking: ReadonlySet<string> = new Set()
    speaking = applySpeaking(speaking, { kind: 'speaking', playerId: 'bob', speaking: true })
    expect(speaking.has('bob')).toBe(true)
    speaking = applySpeaking(speaking, { kind: 'speaking', playerId: 'bob', speaking: false })
    expect(speaking.has('bob')).toBe(false)
  })
})

'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createRiverAuthClient, ensureRiverSession, loadBrowserAuthConfig } from '@/lib/auth'

/**
 * The front door.
 *
 * River was one route for its whole life, so six finished systems - the
 * cosmetics store, table items, REP challenges, hand history, the lobby - had
 * nowhere to live and were bolted onto the table page as panels. That is the
 * same reason the HUD is crowded. This is where they go instead.
 *
 * Nothing here is a button that does nothing. An item whose screen is not built
 * says so and cannot be pressed, because a menu that navigates to an empty
 * route is worse than a menu that admits what it is.
 */

interface MenuItem {
  id: string
  label: string
  href?: string
  action?: 'play' | 'join'
  /** Named so the disabled state reads as a plan rather than a fault. */
  pending?: boolean
}

const ITEMS: readonly MenuItem[] = [
  { id: 'play', label: 'Play', action: 'play' },
  { id: 'private', label: 'Private Table', pending: true },
  { id: 'join', label: 'Join Friends', action: 'join' },
  { id: 'wardrobe', label: 'Wardrobe', pending: true },
  { id: 'collection', label: 'Collection', pending: true },
  { id: 'settings', label: 'Settings', pending: true },
]

interface Me {
  playerId: string
  anonymous: boolean
  admin: boolean
  balance: number | null
}

export function ClubMenu() {
  const router = useRouter()
  const [focused, setFocused] = useState('play')
  const [me, setMe] = useState<Me | null>(null)
  const [joining, setJoining] = useState(false)
  const [inviteLink, setInviteLink] = useState('')
  const [inviteError, setInviteError] = useState<string | null>(null)
  const inviteRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const config = await loadBrowserAuthConfig()
        const client = createRiverAuthClient(config)
        const session = await ensureRiverSession(client)
        const response = await fetch('/api/me', {
          headers: { authorization: `Bearer ${session.access_token}` },
          cache: 'no-store',
        })
        if (!response.ok) return
        const body = (await response.json()) as Me
        if (!cancelled) setMe(body)
      } catch {
        // The menu renders without a bankroll rather than not at all. Somebody
        // arriving on a bad connection should still see the door.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (joining) inviteRef.current?.focus()
  }, [joining])

  const openInvite = useCallback(() => {
    const raw = inviteLink.trim()
    if (raw.length === 0) return
    try {
      // Accept a full invite link, which is what actually gets shared. A bare
      // code cannot find a table: the server needs the room id as well, and
      // guessing one would put somebody at an empty table of their own.
      const url = new URL(raw, window.location.origin)
      const room = url.searchParams.get('room')
      const code = url.searchParams.get('code')
      if (room === null || code === null) {
        setInviteError('That link is missing its table.')
        return
      }
      const venue = url.searchParams.get('venue')
      const next = new URLSearchParams({ room, code })
      if (venue !== null) next.set('venue', venue)
      router.push(`/table?${next.toString()}`)
    } catch {
      setInviteError('That does not look like an invite link.')
    }
  }, [inviteLink, router])

  const activate = useCallback(
    (item: MenuItem) => {
      if (item.pending === true) return
      if (item.action === 'play') {
        router.push('/table')
        return
      }
      if (item.action === 'join') {
        setInviteError(null)
        setJoining(true)
        return
      }
      if (item.href !== undefined) router.push(item.href)
    },
    [router],
  )

  return (
    <div className="club">
      <nav className="club-rail" aria-label="Main menu">
        <div className="club-wordmark">
          <h1 className="club-wordmark-name">River</h1>
          <div className="club-wordmark-rule" aria-hidden="true">
            <span className="club-wordmark-pips">&spades;&hearts;&diams;&clubs;</span>
          </div>
        </div>

        <div className="club-nav">
          {ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className="club-nav-item"
              aria-current={focused === item.id}
              disabled={item.pending === true}
              onMouseEnter={() => setFocused(item.id)}
              onFocus={() => setFocused(item.id)}
              onClick={() => activate(item)}
            >
              <span className="club-nav-mark" aria-hidden="true">
                &diams;
              </span>
              <span className="club-nav-label">{item.label}</span>
            </button>
          ))}
        </div>

        <div className="club-rail-footer">
          <div className="club-rail-footer-rule">
            <span>The Rooftop</span>
          </div>
        </div>
      </nav>

      <div className="club-stage">
        {/* Decorative: the room behind the menu carries no information the
            navigation does not already say. */}
        <img className="club-stage-image" src="/menu/rooftop.jpg" alt="" aria-hidden="true" />

        {me !== null ? (
          <div className="club-capsule club-capsule-player club-scene">
            <div>
              <div className="club-capsule-name">{me.anonymous ? 'Guest' : 'River'}</div>
              <div className="club-capsule-sub">
                {me.admin ? 'Developer' : me.anonymous ? 'Unsaved session' : 'Member'}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="club-capsule-value">
                {me.balance === null ? '—' : me.balance.toLocaleString('en-GB')}
              </div>
              <div className="club-capsule-label">Chips</div>
            </div>
          </div>
        ) : null}

        {joining ? (
          <div className="club-capsule club-capsule-event club-scene">
            <div style={{ display: 'grid', gap: '0.6rem' }}>
              <label className="club-capsule-label" htmlFor="club-invite">
                Paste an invite link
              </label>
              <input
                ref={inviteRef}
                id="club-invite"
                className="club-input"
                value={inviteLink}
                onChange={(event) => {
                  setInviteLink(event.target.value)
                  setInviteError(null)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') openInvite()
                  if (event.key === 'Escape') setJoining(false)
                }}
                placeholder="https://…/table?room=…&code=…"
              />
              {inviteError !== null ? (
                <span className="club-capsule-sub club-error">{inviteError}</span>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

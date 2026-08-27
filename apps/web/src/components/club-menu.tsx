'use client'

import type { SupabaseClient } from '@supabase/supabase-js'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createRiverAuthClient,
  ensureRiverSession,
  loadBrowserAuthConfig,
  signInToRiver,
} from '@/lib/auth'

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
  { id: 'private', label: 'Private Table', href: '/play' },
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
  const authRef = useRef<SupabaseClient | null>(null)
  const [signIn, setSignIn] = useState<'idle' | 'editing' | 'sent' | 'error'>('idle')
  const [returning, setReturning] = useState(false)
  const [email, setEmail] = useState('')
  const emailRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const config = await loadBrowserAuthConfig()
        const client = createRiverAuthClient(config)
        authRef.current = client
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

  useEffect(() => {
    if (signIn === 'editing') emailRef.current?.focus()
  }, [signIn])

  /**
   * Turn the anonymous session into a saved one.
   *
   * Every visitor gets an anonymous session on load - that is the zero-friction
   * guest play the spec asks for - and there was no way at all to keep it. The
   * only sign-in in the product was a SAVE button on the table, so somebody who
   * had not sat down yet could not have an account, and the menu greeted a
   * developer as a guest.
   *
   * The magic link keeps the same player id, so a bankroll built as a guest
   * survives the upgrade rather than being left behind in an account nobody can
   * reach again.
   */
  const sendMagicLink = useCallback(async () => {
    const client = authRef.current
    const address = email.trim()
    if (client === null || address.length === 0) return
    try {
      const outcome = await signInToRiver(client, address, window.location.origin)
      setReturning(outcome === 'returning')
      setSignIn('sent')
    } catch {
      setSignIn('error')
    }
  }, [email])

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
              {item.pending === true ? <span className="club-nav-soon">Soon</span> : null}
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
            navigation does not already say.

            next/image rather than a bare tag, so the backdrop is served in a
            modern format at the size the viewport actually needs. It is the
            largest thing on the first screen anybody sees, and priority stops
            it arriving after the type it sits behind. */}
        <Image
          className="club-stage-image"
          src="/menu/rooftop.jpg"
          alt=""
          aria-hidden="true"
          fill
          priority
          sizes="100vw"
        />

        {me !== null ? (
          <div className="club-capsule club-capsule-player club-scene">
            <div className="club-capsule-identity">
              <div className="club-capsule-name">{me.anonymous ? 'Guest' : 'Member'}</div>
              {me.anonymous ? (
                signIn === 'sent' ? (
                  <div className="club-capsule-sub">Check your email</div>
                ) : (
                  <button
                    type="button"
                    className="club-link"
                    onClick={() => setSignIn(signIn === 'editing' ? 'idle' : 'editing')}
                  >
                    Sign in to keep this
                  </button>
                )
              ) : (
                <div className="club-capsule-sub">{me.admin ? 'Developer' : 'Signed in'}</div>
              )}
            </div>
            <div className="club-capsule-figure">
              <div className="club-capsule-value">
                {me.balance === null ? '—' : me.balance.toLocaleString('en-GB')}
              </div>
              <div className="club-capsule-label">Chips</div>
            </div>
          </div>
        ) : null}

        {signIn === 'sent' ? (
          <div className="club-capsule club-capsule-signin club-scene">
            <div className="club-field">
              <span className="club-capsule-label">Check your email</span>
              <span className="club-capsule-sub">
                {returning
                  ? 'A link to sign back into your account is on its way.'
                  : 'A link to keep this session is on its way.'}
              </span>
            </div>
          </div>
        ) : null}

        {signIn === 'editing' || signIn === 'error' ? (
          <div className="club-capsule club-capsule-signin club-scene">
            <div className="club-field">
              <label className="club-capsule-label" htmlFor="club-email">
                Email a sign-in link
              </label>
              <input
                ref={emailRef}
                id="club-email"
                className="club-input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value)
                  if (signIn === 'error') setSignIn('editing')
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void sendMagicLink()
                  if (event.key === 'Escape') setSignIn('idle')
                }}
                placeholder="you@example.com"
              />
              {signIn === 'error' ? (
                <span className="club-capsule-sub club-error">That did not send. Try again.</span>
              ) : (
                <span className="club-capsule-sub">Your chips and streaks come with you.</span>
              )}
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

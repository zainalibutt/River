'use client'

import type { BotTablePreset } from '@river/engine'
import type { SupabaseClient } from '@supabase/supabase-js'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react'
import { DailyChips } from '@/components/daily-chips'
import { FriendsSheet } from '@/components/friends-sheet'
import { RiverIntro } from '@/components/river-intro'
import { RiverSettings, usePreferences } from '@/components/river-settings'
import { RiverSoundControl } from '@/components/river-sound-control'
import { RollingAmount } from '@/components/rolling-amount'
import {
  createRiverAuthClient,
  ensureRiverSession,
  loadBrowserAuthConfig,
  signInToRiver,
} from '@/lib/auth'
import {
  describeNameStatus,
  isNameStatus,
  NAME_LONGEST,
  type NameStatus,
  nameProblem,
} from '@/lib/player-name'
import { profilePath } from '@/lib/profile'
import { startTableHref } from '@/lib/start-table'
import { inviteDestination } from '@/lib/table-target'
import { useInterfaceSound } from '@/lib/use-interface-sound'
import { useVisibleViewport } from '@/lib/use-visible-viewport'

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

/** The strength of a full bot table. The champion table sits beside these, heads-up. */
type TableStrength = Exclude<BotTablePreset, 'champion'>

const BOT_PRESET_LABELS: Readonly<Record<TableStrength, string>> = {
  casual: 'Casual',
  mixed: 'Mixed',
  tough: 'Tough',
  random: 'Random',
}

interface Me {
  playerId: string
  anonymous: boolean
  admin: boolean
  balance: number | null
}

/** Where the name box has got to with what is typed in it. */
type NameCheck =
  | { kind: 'idle' }
  | { kind: 'checking'; name: string }
  | { kind: 'answered'; name: string; status: NameStatus }
  | { kind: 'claiming'; name: string }
  | { kind: 'failed'; name: string }

export function ClubMenu() {
  const router = useRouter()
  useInterfaceSound()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closingMotion = useRef<Animation | null>(null)
  const visibleViewport = useVisibleViewport()
  const [me, setMe] = useState<Me | null>(null)
  // Where this member's public profile lives, once their name is known to have one.
  const [profile, setProfile] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)
  const [playSetup, setPlaySetup] = useState(false)
  const [botMode, setBotMode] = useState<'fill' | 'off'>('fill')
  const [botPreset, setBotPreset] = useState<TableStrength>('random')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [preferences, setPreferences] = usePreferences()
  const [inviteLink, setInviteLink] = useState('')
  const [inviteError, setInviteError] = useState<string | null>(null)
  const inviteRef = useRef<HTMLInputElement>(null)
  const authRef = useRef<SupabaseClient | null>(null)
  const [friendsOpen, setFriendsOpen] = useState(false)
  const accessToken = useCallback(async () => {
    const client = authRef.current
    if (client === null) throw new Error('not signed in yet')
    return (await ensureRiverSession(client)).access_token
  }, [])
  const [signIn, setSignIn] = useState<'idle' | 'editing' | 'sent' | 'error'>('idle')
  const [returning, setReturning] = useState(false)
  const [email, setEmail] = useState('')
  const emailRef = useRef<HTMLInputElement>(null)
  // A member's name, and whether they have chosen it or still carry the one
  // River gave them when they arrived.
  const [memberName, setMemberName] = useState<{
    name: string
    chosen: boolean
  } | null>(null)
  const [naming, setNaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [nameCheck, setNameCheck] = useState<NameCheck>({ kind: 'idle' })
  const nameRef = useRef<HTMLInputElement>(null)

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
        if (body.anonymous) return
        // A member may read their own players row, and its name is the one their
        // profile goes by. Guests have no profile, so they are not asked.
        const own = await client
          .from('players')
          .select('display_name, name_claimed_at')
          .eq('id', body.playerId)
          .maybeSingle()
        const name: unknown = own.data?.display_name
        if (typeof name !== 'string' || cancelled) return
        const chosen = typeof own.data?.name_claimed_at === 'string'
        setMemberName({ name, chosen })
        setProfile(profilePath(name))
        if (!chosen) {
          // Somebody who has just confirmed their email arrives here, and the
          // name is the first thing a member is asked for. Once a visit: the
          // badge offers it again after that.
          setPlaySetup(false)
          setJoining(false)
          setSettingsOpen(false)
          setNaming(true)
        }
      } catch {
        // The menu renders without a bankroll rather than not at all. Somebody
        // arriving on a bad connection should still see the door.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const panelOpen = joining || playSetup || settingsOpen || naming || signIn !== 'idle'
  const closePanels = useCallback(() => {
    setJoining(false)
    setPlaySetup(false)
    setSettingsOpen(false)
    setNaming(false)
    setSignIn('idle')
  }, [])
  const dismissPanel = useCallback(() => {
    const dialog = dialogRef.current
    if (dialog === null || !dialog.open || closingMotion.current !== null) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !dialog.animate) {
      dialog.close()
      closePanels()
      return
    }
    dialog.dataset.closing = 'true'
    const duration = Number.parseFloat(getComputedStyle(dialog).getPropertyValue('--home-exit-ms'))
    const motion = dialog.animate([{ opacity: 0, transform: 'translateY(10px)' }], {
      duration,
      easing: 'cubic-bezier(0.4, 0, 1, 1)',
    })
    closingMotion.current = motion
    motion.onfinish = () => {
      closingMotion.current = null
      delete dialog.dataset.closing
      dialog.close()
      closePanels()
    }
  }, [closePanels])
  useEffect(() => () => closingMotion.current?.cancel(), [])
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null) return
    if (panelOpen && !dialog.open) dialog.showModal()
    if (!panelOpen) {
      closingMotion.current?.cancel()
      closingMotion.current = null
      delete dialog.dataset.closing
      if (dialog.open) dialog.close()
    }
    if (joining) inviteRef.current?.focus()
    else if (naming) nameRef.current?.focus()
    else if (signIn === 'editing') emailRef.current?.focus()
  }, [panelOpen, joining, naming, signIn])

  /**
   * Asks the server about a name for this member, or claims it. Null when the
   * question could not be put, which the box never shows as free or taken.
   */
  const askName = useCallback(async (name: string, claim: boolean): Promise<NameStatus | null> => {
    const client = authRef.current
    if (client === null) return null
    try {
      const session = await ensureRiverSession(client)
      const response = await fetch(
        claim ? '/api/name' : `/api/name?name=${encodeURIComponent(name)}`,
        {
          method: claim ? 'POST' : 'GET',
          headers: {
            authorization: `Bearer ${session.access_token}`,
            ...(claim ? { 'content-type': 'application/json' } : {}),
          },
          ...(claim ? { body: JSON.stringify({ name }) } : {}),
          cache: 'no-store',
        },
      )
      if (!response.ok) return null
      const body = (await response.json()) as { status?: unknown }
      return isNameStatus(body.status) ? body.status : null
    } catch {
      return null
    }
  }, [])

  // Each name is checked a moment after typing stops, once the rules here have
  // nothing against it, so a name that cannot be had is never sent at all.
  useEffect(() => {
    if (!naming || nameDraft.length === 0 || nameProblem(nameDraft) !== null) {
      setNameCheck({ kind: 'idle' })
      return
    }
    const name = nameDraft
    setNameCheck({ kind: 'checking', name })
    let cancelled = false
    const timer = window.setTimeout(() => {
      void askName(name, false).then((status) => {
        if (cancelled) return
        setNameCheck(
          status === null ? { kind: 'failed', name } : { kind: 'answered', name, status },
        )
      })
    }, 350)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [askName, nameDraft, naming])

  const claimName = useCallback(async () => {
    const name = nameDraft
    if (nameProblem(name) !== null) return
    setNameCheck({ kind: 'claiming', name })
    const status = await askName(name, true)
    if (status === 'claimed') {
      setMemberName({ name, chosen: true })
      setProfile(profilePath(name))
      setNaming(false)
      setNameCheck({ kind: 'idle' })
      return
    }
    setNameCheck(status === null ? { kind: 'failed', name } : { kind: 'answered', name, status })
  }, [askName, nameDraft])

  const openNaming = useCallback(() => {
    setPlaySetup(false)
    setJoining(false)
    setSettingsOpen(false)
    setSignIn('idle')
    setNaming(true)
  }, [])

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
      // Accept an invite link, which is what actually gets shared: the short
      // one INVITE copies, or a long one from before there were short ones.
      const destination = inviteDestination(raw, window.location.origin)
      if (destination === null) {
        setInviteError('That link is missing its table.')
        return
      }
      router.push(destination)
    } catch {
      setInviteError('That does not look like an invite link.')
    }
  }, [inviteLink, router])

  const startTable = useCallback(() => {
    router.push(
      startTableHref(botMode === 'off' ? { bots: 'off' } : { bots: 'fill', preset: botPreset }),
    )
  }, [botMode, botPreset, router])

  const draftProblem = nameDraft.length === 0 ? null : nameProblem(nameDraft)
  const nameClaimable =
    nameCheck.kind === 'answered' &&
    nameCheck.status === 'available' &&
    nameCheck.name === nameDraft
  const nameLine: { text: string; trouble: boolean } =
    nameDraft.length === 0
      ? {
          text: 'Letters, numbers and underscores. Once it is yours, nobody else can have it.',
          trouble: false,
        }
      : draftProblem !== null
        ? { text: describeNameStatus(draftProblem, nameDraft), trouble: true }
        : nameCheck.kind === 'answered'
          ? {
              text: describeNameStatus(nameCheck.status, nameCheck.name),
              trouble: nameCheck.status !== 'available',
            }
          : nameCheck.kind === 'failed'
            ? { text: 'That could not be checked. Try again.', trouble: true }
            : nameCheck.kind === 'claiming'
              ? { text: 'Claiming…', trouble: false }
              : { text: 'Checking…', trouble: false }

  return (
    <div className="club club-home">
      <RiverIntro />
      <div className="club-home-art" aria-hidden="true">
        <div className="club-home-world">
          <Image
            src="/menu/rooftop-menu-4k.webp"
            alt=""
            fill
            sizes="(max-width: 900px) and (orientation: portrait) 140vh, 100vw"
            priority
          />
        </div>
      </div>
      <header className="club-home-header">
        <div className="club-wordmark">
          <h1 className="club-wordmark-name">River</h1>
          <p className="club-home-tagline">Premium poker.</p>
        </div>

        <nav className="club-home-tools" aria-label="Settings">
          <RiverSoundControl />
          <button type="button" className="club-home-tool" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
        </nav>
      </header>

      <div className="club-home-body">
        <main className="club-home-content">
          <section className="club-home-play" aria-label="Solo play">
            <button
              type="button"
              className="club-home-play-button"
              aria-label="Quick Play"
              onClick={() => router.push(startTableHref({ bots: 'fill', preset: 'random' }))}
            >
              <span className="club-home-action-title">Quick Play</span>
            </button>
            <button type="button" className="club-home-options" onClick={() => setPlaySetup(true)}>
              Table options
            </button>
          </section>
          <button
            type="button"
            className="club-home-nell"
            aria-label="Champion, Nell 1v1"
            onClick={() => router.push(startTableHref({ bots: 'fill', preset: 'champion' }))}
          >
            <span className="club-home-match-mark" aria-hidden="true">
              <span>1</span>
              <small>v</small>
              <span>1</span>
            </span>
            <span className="club-home-challenge">
              <span className="club-home-action-title">Champion</span>
              <span className="club-home-action-detail">Nell · 1v1</span>
            </span>
          </button>
          <section className="club-home-friends" aria-labelledby="club-friends-title">
            <div>
              <h2 id="club-friends-title">Friends</h2>
            </div>
            <div className="club-home-friend-actions">
              <button
                type="button"
                className="club-home-secondary"
                onClick={() => router.push('/play')}
              >
                Create
              </button>
              <button
                type="button"
                className="club-home-secondary"
                onClick={() => {
                  setInviteError(null)
                  setJoining(true)
                }}
              >
                Join
              </button>
            </div>
          </section>
        </main>
        <p className="club-home-venue" aria-hidden="true">
          The Rooftop
        </p>

        {me !== null ? (
          <footer className="club-capsule club-capsule-player club-home-account">
            <div className="club-capsule-identity">
              <div className="club-capsule-name">
                {me.anonymous ? 'Guest' : memberName?.chosen === true ? memberName.name : 'Member'}
              </div>
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
                <>
                  <div className="club-capsule-sub">{me.admin ? 'Developer' : 'Signed in'}</div>
                  {memberName !== null && !memberName.chosen ? (
                    <button type="button" className="club-link" onClick={openNaming}>
                      Choose your name
                    </button>
                  ) : null}
                </>
              )}
            </div>
            <DailyChips
              accessToken={accessToken}
              onBalance={(balance) =>
                setMe((current) => (current === null ? current : { ...current, balance }))
              }
            />
            <div className="club-capsule-figure">
              <div className="club-capsule-value">
                {me.balance === null ? (
                  '—'
                ) : (
                  <RollingAmount value={me.balance} abbreviated={false} bigBlind={null} />
                )}
              </div>
              <div className="club-capsule-label">Chips</div>
            </div>
            {/* Places of your own, read as one line of type under the strip rather than a
                stack of buttons: the strip's actions are the claim and the name above. */}
            <nav className="club-capsule-links" aria-label="Your account">
              {!me.anonymous && memberName?.chosen !== false && profile !== null ? (
                <button type="button" className="club-link" onClick={() => router.push(profile)}>
                  Your profile
                </button>
              ) : null}
              <button type="button" className="club-link" onClick={() => router.push('/record')}>
                Your record
              </button>
              <button type="button" className="club-link" onClick={() => setFriendsOpen(true)}>
                Friends
              </button>
            </nav>
          </footer>
        ) : null}

        {friendsOpen ? (
          <FriendsSheet
            accessToken={accessToken}
            onClose={() => setFriendsOpen(false)}
            onJoinTable={(code) => router.push(`/t/${code}`)}
            onSaveProgress={() => {
              setFriendsOpen(false)
              setSignIn('editing')
            }}
          />
        ) : null}

        <dialog
          ref={dialogRef}
          className="club-home-dialog"
          style={
            visibleViewport === null
              ? undefined
              : ({
                  '--visible-viewport-height': `${visibleViewport.height}px`,
                  '--viewport-bottom-inset': `${visibleViewport.bottomInset}px`,
                } as CSSProperties)
          }
          aria-labelledby="club-panel-title"
          onCancel={(event) => {
            event.preventDefault()
            dismissPanel()
          }}
          onClose={closePanels}
        >
          <div className="club-home-dialog-heading">
            <h2 id="club-panel-title">
              {joining
                ? 'Join a table'
                : playSetup
                  ? 'Table options'
                  : settingsOpen
                    ? 'Settings'
                    : naming
                      ? 'Your name'
                      : 'Sign in'}
            </h2>
            <button type="button" className="club-home-tool" onClick={dismissPanel}>
              Close
            </button>
          </div>
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
                  }}
                  placeholder="you@example.com"
                />
                {signIn === 'error' ? (
                  <span className="club-capsule-sub club-error">That did not send. Try again.</span>
                ) : (
                  <span className="club-capsule-sub">Your chips and streaks come with you.</span>
                )}
                <button
                  type="button"
                  className="club-primary"
                  disabled={email.trim().length === 0}
                  onClick={() => void sendMagicLink()}
                >
                  Send sign-in link
                </button>
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
                  }}
                  placeholder="https://…/t/…"
                  aria-describedby={inviteError === null ? undefined : 'club-invite-error'}
                  aria-invalid={inviteError !== null}
                />
                {inviteError !== null ? (
                  <span id="club-invite-error" className="club-capsule-sub club-error" role="alert">
                    {inviteError}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="club-primary"
                  disabled={inviteLink.trim().length === 0}
                  onClick={openInvite}
                >
                  Join table
                </button>
              </div>
            </div>
          ) : null}

          {playSetup ? (
            <section className="club-capsule club-capsule-event club-scene club-table-setup">
              <div className="club-field">
                <span className="club-capsule-label">Start a table</span>
                <fieldset className="club-choice-row">
                  <legend className="club-choice-legend">Table opponents</legend>
                  <button
                    type="button"
                    aria-pressed={botMode === 'fill'}
                    onClick={() => setBotMode('fill')}
                  >
                    Bots
                  </button>
                  <button
                    type="button"
                    aria-pressed={botMode === 'off'}
                    onClick={() => setBotMode('off')}
                  >
                    People only
                  </button>
                </fieldset>
                {botMode === 'fill' ? (
                  <fieldset className="club-choice-grid">
                    <legend className="club-choice-legend">Bot table strength</legend>
                    {(Object.keys(BOT_PRESET_LABELS) as TableStrength[]).map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        aria-pressed={botPreset === preset}
                        onClick={() => setBotPreset(preset)}
                      >
                        {BOT_PRESET_LABELS[preset]}
                      </button>
                    ))}
                  </fieldset>
                ) : (
                  <span className="club-capsule-sub">No bots will take empty seats.</span>
                )}
                <button type="button" className="club-primary" onClick={startTable}>
                  Take a seat
                </button>
              </div>
            </section>
          ) : null}

          {naming ? (
            <section className="club-capsule club-capsule-event club-scene">
              <div className="club-field">
                <label className="club-capsule-label" htmlFor="club-name">
                  Choose your name
                </label>
                <input
                  ref={nameRef}
                  id="club-name"
                  className="club-input"
                  value={nameDraft}
                  maxLength={NAME_LONGEST}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  onChange={(event) => setNameDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && nameClaimable) void claimName()
                  }}
                  placeholder={memberName?.name ?? ''}
                />
                <span
                  className={`club-capsule-sub${nameLine.trouble ? ' club-error' : ''}`}
                  aria-live="polite"
                >
                  {nameLine.text}
                </span>
                <button
                  type="button"
                  className="club-primary"
                  disabled={!nameClaimable}
                  onClick={() => void claimName()}
                >
                  Claim
                </button>
              </div>
            </section>
          ) : null}

          {settingsOpen ? (
            <section className="club-capsule club-capsule-event club-scene club-settings">
              <div className="club-field">
                <span className="club-capsule-label">Settings</span>
                <RiverSettings preferences={preferences} onChange={setPreferences} />
              </div>
            </section>
          ) : null}
        </dialog>
      </div>
    </div>
  )
}

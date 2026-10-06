'use client'

import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { loadProfile, memberSinceLabel, type ProfileOutcome } from '@/lib/profile'

/**
 * A member's public face: the name they go by and when they first came.
 *
 * Nothing about their play is shown, because River keeps none of it once a
 * seat is given up, and nothing private is shown, because none of it reaches
 * the browser in the first place.
 */
export function PlayerProfile({ name }: { name: string }) {
  const router = useRouter()
  const [outcome, setOutcome] = useState<ProfileOutcome | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadProfile(name).then((next) => {
      if (!cancelled) setOutcome(next)
    })
    return () => {
      cancelled = true
    }
  }, [name])

  return (
    <div className="club">
      <nav className="club-rail" aria-label="Player profile">
        <div className="club-wordmark">
          <h1 className="club-wordmark-name">River</h1>
          <div className="club-wordmark-rule" aria-hidden="true">
            <span className="club-wordmark-pips">&spades;&hearts;&diams;&clubs;</span>
          </div>
        </div>

        <div className="club-nav">
          <button type="button" className="club-nav-item" onClick={() => router.push('/')}>
            <span className="club-nav-mark" aria-hidden="true">
              &diams;
            </span>
            <span className="club-nav-label">Back</span>
          </button>
        </div>

        <div className="club-rail-footer">
          <div className="club-rail-footer-rule">
            <span>Player profile</span>
          </div>
        </div>
      </nav>

      <div className="club-stage">
        {/* Decorative, as on the menu: the room behind the page. */}
        <Image
          className="club-stage-image"
          src="/menu/rooftop.jpg"
          alt=""
          aria-hidden="true"
          fill
          priority
          sizes="100vw"
        />

        <section className="club-folio club-scene" aria-live="polite" aria-label="Player profile">
          {outcome === null ? (
            <header className="club-folio-head">
              <h2 className="club-folio-title">Finding the player</h2>
              <p className="club-folio-sub">Player profile</p>
            </header>
          ) : outcome.kind === 'found' ? (
            <>
              <header className="club-folio-head">
                <h2 className="club-folio-title" style={{ overflowWrap: 'anywhere' }}>
                  {outcome.profile.name}
                </h2>
                <p className="club-folio-sub">Member</p>
              </header>
              <div className="club-row club-row-fixed">
                <span className="club-row-label">Member since</span>
                <span className="club-row-value">
                  {memberSinceLabel(outcome.profile.memberSince)}
                </span>
              </div>
            </>
          ) : outcome.kind === 'missing' ? (
            <>
              <header className="club-folio-head">
                <h2 className="club-folio-title">No member by that name</h2>
                <p className="club-folio-sub">Player profile</p>
              </header>
              <p className="club-folio-note">
                Profiles belong to players who have signed in. A guest has none yet, and neither
                does a name nobody has taken.
              </p>
              <button type="button" className="club-primary" onClick={() => router.push('/')}>
                Back to River
              </button>
            </>
          ) : (
            <>
              <header className="club-folio-head">
                <h2 className="club-folio-title">Profiles could not be loaded</h2>
                <p className="club-folio-sub">Player profile</p>
              </header>
              <p className="club-folio-note">
                River could not reach its records just now. Try again in a moment.
              </p>
              <button
                type="button"
                className="club-primary"
                onClick={() => window.location.reload()}
              >
                Try again
              </button>
              <button type="button" className="club-link" onClick={() => router.push('/')}>
                Back to River
              </button>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

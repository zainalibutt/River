'use client'

import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { followShortLink } from '@/lib/table-target'

/**
 * Finding the table a short link belongs to, and going there.
 *
 * A live table is never shown here at all: the page replaces itself with
 * `/table`, so the back button leaves River rather than landing on a link that
 * forwards straight back. What is shown is the wait, and the two ways it can
 * end without a table - it has closed, or River could not be asked.
 */
export function ShortLink({ code }: { code: string }) {
  const router = useRouter()
  const [state, setState] = useState<'finding' | 'closed' | 'unreachable'>('finding')

  useEffect(() => {
    let cancelled = false
    void followShortLink(code).then((outcome) => {
      if (cancelled) return
      if (outcome.kind === 'open') router.replace(outcome.address)
      else setState(outcome.kind)
    })
    return () => {
      cancelled = true
    }
  }, [code, router])

  return (
    <div className="club">
      <nav className="club-rail" aria-label="Invite">
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
            <span>Invite only</span>
          </div>
        </div>
      </nav>

      <div className="club-stage">
        {/* Decorative, as on the menu: the room behind the message. */}
        <Image
          className="club-stage-image"
          src="/menu/rooftop.jpg"
          alt=""
          aria-hidden="true"
          fill
          priority
          sizes="100vw"
        />

        <section className="club-folio club-scene" aria-live="polite" aria-label="Invite">
          {state === 'finding' ? (
            <header className="club-folio-head">
              <h2 className="club-folio-title">Finding the table</h2>
              <p className="club-folio-sub">Invite link</p>
            </header>
          ) : state === 'closed' ? (
            <>
              <header className="club-folio-head">
                <h2 className="club-folio-title">That table has closed</h2>
                <p className="club-folio-sub">Invite link</p>
              </header>
              <p className="club-folio-note">
                Everybody has left the table this link was for, or its game has ended. Start a table
                of your own, or ask for a fresh link.
              </p>
              <button type="button" className="club-primary" onClick={() => router.push('/')}>
                Back to River
              </button>
            </>
          ) : (
            <>
              <header className="club-folio-head">
                <h2 className="club-folio-title">River could not be reached</h2>
                <p className="club-folio-sub">Invite link</p>
              </header>
              <p className="club-folio-note">
                The table this link was for could not be looked up just now. Check your connection
                and try again.
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

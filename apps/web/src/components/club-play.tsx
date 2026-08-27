'use client'

import { DEFAULT_STAKE, SEATS_PER_SHAPE } from '@river/engine'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
import { VENUE_ORDER, type VenueId, venueOf } from '@/lib/venue'

/**
 * Setting up a private table.
 *
 * The venue is the only setting the wire can actually carry: `enter` takes a
 * venueId, and the room's seat count and stake are chosen by the server from
 * its own defaults. So the venue is a live control and the other two rows read
 * back what the table will be rather than pretending to set it. A stepper that
 * changes a number the server ignores is worse than no stepper - it is a lie
 * the player only discovers once they are sitting down.
 *
 * Changing the venue changes the picture. That is the point of choosing one,
 * and it is the cheapest way to make a settings screen feel like a place.
 */

const TURN_BUDGET_LABEL = 'Standard'

function newRoomId(): string {
  return `river-${crypto.randomUUID().slice(0, 8)}`
}

export function ClubPlay() {
  const router = useRouter()
  const [venue, setVenue] = useState<VenueId>('rooftop')
  const [creating, setCreating] = useState(false)

  const index = VENUE_ORDER.indexOf(venue)
  const detail = useMemo(() => venueOf(venue), [venue])

  const step = useCallback(
    (by: number) => {
      const next = VENUE_ORDER[(index + by + VENUE_ORDER.length) % VENUE_ORDER.length]
      if (next !== undefined) setVenue(next)
    },
    [index],
  )

  const create = useCallback(() => {
    setCreating(true)
    // The room is named here and comes into being when somebody enters it. No
    // round trip: the server creates a table on first entry, so a code cannot
    // be reserved and then abandoned by a player who changed their mind.
    router.push(`/table?room=${newRoomId()}&venue=${venue}`)
  }, [router, venue])

  return (
    <div className="club">
      <nav className="club-rail" aria-label="Private table setup">
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
        {/* Keyed on the venue so React swaps the element rather than mutating
            src, which lets the new room fade in instead of popping. */}
        <Image
          key={venue}
          className="club-stage-image club-stage-swap"
          src={`/menu/${venue}.jpg`}
          alt=""
          aria-hidden="true"
          fill
          priority
          sizes="100vw"
        />

        <section className="club-folio club-scene" aria-label="Table settings">
          <header className="club-folio-head">
            <h2 className="club-folio-title">Private Table</h2>
            <p className="club-folio-sub">Invite only</p>
          </header>

          <div className="club-row">
            <span className="club-row-label">Venue</span>
            <div className="club-row-control">
              <button
                type="button"
                className="club-step"
                onClick={() => step(-1)}
                aria-label="Previous venue"
              >
                &#9664;
              </button>
              <span className="club-row-value">{detail.name}</span>
              <button
                type="button"
                className="club-step"
                onClick={() => step(1)}
                aria-label="Next venue"
              >
                &#9654;
              </button>
            </div>
          </div>

          <p className="club-folio-tagline">{detail.tagline}</p>

          <div className="club-row club-row-fixed">
            <span className="club-row-label">Seats</span>
            <span className="club-row-value">{SEATS_PER_SHAPE.full}</span>
          </div>

          <div className="club-row club-row-fixed">
            <span className="club-row-label">Buy-in</span>
            <span className="club-row-value">
              {DEFAULT_STAKE.defaultBuyIn.toLocaleString('en-GB')}
            </span>
          </div>

          <div className="club-row club-row-fixed">
            <span className="club-row-label">Turn timer</span>
            <span className="club-row-value">{TURN_BUDGET_LABEL}</span>
          </div>

          <p className="club-folio-note">
            Blinds {DEFAULT_STAKE.smallBlind.toLocaleString('en-GB')}/
            {DEFAULT_STAKE.bigBlind.toLocaleString('en-GB')}. Seats, buy-in and timer are fixed for
            now.
          </p>

          <button type="button" className="club-primary" onClick={create} disabled={creating}>
            {creating ? 'Opening…' : 'Create table'}
          </button>
        </section>
      </div>
    </div>
  )
}

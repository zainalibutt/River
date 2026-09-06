'use client'

import { DEFAULT_STAKE, SEATS_PER_SHAPE } from '@river/engine'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import { type VenueId, venueOf } from '@/lib/venue'

/**
 * Setting up a private table.
 *
 * Every row here reads back what the table will be rather than pretending to
 * set it. `enter` takes a venueId and the room's seat count and stake are
 * chosen by the server from its own defaults, so a stepper on those would
 * change a number the server ignores - worse than no stepper, because it is a
 * lie the player only discovers once they are sitting down.
 *
 * The venue used to be the exception, and it is not one at the moment. Only the
 * Rooftop is being finished: the Laundromat and the Executive Suite exist in the
 * pipeline but are not being reviewed or dressed, so stepping to them offers a
 * room nobody is working on. Deferred rather than deleted - the venues, their
 * lighting rigs and their stills are all still built, and this becomes a stepper
 * again the moment there is a second finished room to step to.
 */

const ONLY_VENUE: VenueId = 'rooftop'
const ONLY_VENUE_DETAIL = venueOf(ONLY_VENUE)

const TURN_BUDGET_LABEL = 'Standard'

function newRoomId(): string {
  return `river-${crypto.randomUUID().slice(0, 8)}`
}

export function ClubPlay() {
  const router = useRouter()
  const [creating, setCreating] = useState(false)
  const detail = ONLY_VENUE_DETAIL

  const create = useCallback(() => {
    setCreating(true)
    // The room is named here and comes into being when somebody enters it. No
    // round trip: the server creates a table on first entry, so a code cannot
    // be reserved and then abandoned by a player who changed their mind.
    router.push(`/table?room=${newRoomId()}&venue=${ONLY_VENUE}`)
  }, [router])

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
          key={ONLY_VENUE}
          className="club-stage-image club-stage-swap"
          src={`/menu/${ONLY_VENUE}.jpg`}
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

          <div className="club-row club-row-fixed">
            <span className="club-row-label">Venue</span>
            <span className="club-row-value">{detail.name}</span>
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

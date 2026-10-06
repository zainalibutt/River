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
    <div className="club club-private">
      <div className="club-private-world" aria-hidden="true">
        <Image src="/menu/rooftop-menu-4k.webp" alt="" fill priority sizes="100vw" />
      </div>
      <header className="club-private-header">
        <button type="button" className="club-private-back" onClick={() => router.push('/')}>
          Back
        </button>
        <h1 className="club-private-brand">River</h1>
      </header>
      <main className="club-private-body">
        <section className="club-private-card" aria-label="Table settings">
          <p className="club-private-kicker">Invite only</p>
          <h2>Private table</h2>
          <dl className="club-private-details">
            <div>
              <dt>Venue</dt>
              <dd>{detail.name}</dd>
            </div>
            <div>
              <dt>Seats</dt>
              <dd>{SEATS_PER_SHAPE.full}</dd>
            </div>
            <div>
              <dt>Buy-in</dt>
              <dd>{DEFAULT_STAKE.defaultBuyIn.toLocaleString('en-GB')}</dd>
            </div>
            <div>
              <dt>Turn timer</dt>
              <dd>{TURN_BUDGET_LABEL}</dd>
            </div>
          </dl>
          <p className="club-private-note">
            Blinds {DEFAULT_STAKE.smallBlind.toLocaleString('en-GB')} /{' '}
            {DEFAULT_STAKE.bigBlind.toLocaleString('en-GB')} · Fixed table
          </p>
          <button type="button" className="club-primary" onClick={create} disabled={creating}>
            {creating ? 'Opening…' : 'Create table'}
          </button>
        </section>
      </main>
    </div>
  )
}

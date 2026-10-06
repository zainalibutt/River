'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { RiverVenue } from '@/components/river-venue'
import { CLIPS, type ClipName } from '@/lib/animation'
import { DEFAULT_VENUE, VENUE_ORDER, type VenueId, venueOf, worldSeats } from '@/lib/venue'

const seatIds = Array.from({ length: 8 }, (_, index) => `review-seat-${index}`)
const fullTable = Array.from({ length: 8 }, (_, index) => index)
const sparseTable = [1, 3, 6]
const goldTable = [0]

type Occupancy = 'empty' | 'sparse' | 'full' | 'gold'

/** What the venue scene publishes on the window in development: who sits where, and a way to
 * put a clip on a seat as a room event would. */
type ReviewHooks = {
  riverCast?: { seats: number[]; cast: string[] }
  riverPlay?: (seat: number, clip: ClipName) => string
}

function reviewHooks(): ReviewHooks {
  return window as unknown as ReviewHooks
}

function occupiedSeatsFor(occupancy: Occupancy): readonly number[] {
  if (occupancy === 'full') return fullTable
  if (occupancy === 'sparse') return sparseTable
  if (occupancy === 'gold') return goldTable
  return []
}

export function VisualReviewClient() {
  const [venueId, setVenueId] = useState<VenueId>(DEFAULT_VENUE)
  // Which characters the table is dealt. The mix is hashed from the room, so a review of
  // the cast is a review of one particular table until you name another one: ?room=x.
  const [room] = useState(() =>
    typeof window === 'undefined'
      ? ''
      : (new URLSearchParams(window.location.search).get('room') ?? ''),
  )
  const [occupancy, setOccupancy] = useState<Occupancy>('full')
  const [controlsVisible, setControlsVisible] = useState(true)
  const [stageScale, setStageScale] = useState(2 / 3)
  const seatRefs = useRef<Map<string, HTMLElement>>(new Map())
  const occupiedSeats = occupiedSeatsFor(occupancy)
  const [playSeat, setPlaySeat] = useState(0)
  const [castBySeat, setCastBySeat] = useState<ReadonlyMap<number, string>>(new Map())

  // The scene says who it dealt each seat once the characters have loaded.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const cast = reviewHooks().riverCast
      if (cast === undefined) return
      setCastBySeat(new Map(cast.seats.map((seat, index) => [seat, cast.cast[index] ?? ''])))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const resize = () =>
      setStageScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080))
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  // Two cards in front of everyone dealt in. The browser draws the hole cards, not the
  // character file, and where they land is measured per character - so a review of the cast
  // that dealt nobody anything could not show a hand being held at all.
  const holeSeats = useMemo(
    () =>
      occupiedSeats.map((seat) => ({
        seat,
        mucked: false,
        shown: null,
        revealDelay: 0,
        secondRevealDelay: 0,
      })),
    [occupiedSeats],
  )

  const seatChips = useMemo(() => {
    const ring = worldSeats(seatIds, venueOf(venueId).seatRing)
    return occupiedSeats.flatMap((seat, index) => {
      const place = ring[seat]
      if (place === undefined) return []
      return [{ seat, amount: 18_500 + index * 37_500, x: place.x, z: place.z }]
    })
  }, [occupiedSeats, venueId])

  return (
    <main className="visual-review-app">
      <div className="stage-fit">
        <section
          className="river-stage three-dimensional"
          aria-label="River visual review"
          style={{ transform: `scale(${stageScale})` }}
        >
          <RiverVenue
            venueId={venueId}
            occupiedSeats={occupiedSeats}
            seatChips={seatChips}
            seatIds={seatIds}
            seatRefs={seatRefs}
            holeSeats={holeSeats}
            handNumber={1}
            room={room}
            reviewSeat={occupancy === 'gold' ? 0 : null}
          />
          <div className="visual-review-label" aria-hidden="true">
            <span>VISUAL REVIEW</span>
            <strong>{venueOf(venueId).name}</strong>
            <small>{occupancy.toUpperCase()} TABLE</small>
          </div>
          {controlsVisible ? (
            <div className="visual-review-controls">
              <fieldset aria-label="Review venue">
                {VENUE_ORDER.map((id) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={venueId === id}
                    onClick={() => setVenueId(id)}
                  >
                    {venueOf(id).name}
                  </button>
                ))}
              </fieldset>
              <fieldset aria-label="Review occupancy">
                {(['empty', 'sparse', 'full', 'gold'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={occupancy === value}
                    onClick={() => setOccupancy(value)}
                  >
                    {value}
                  </button>
                ))}
              </fieldset>
              <fieldset aria-label="Seat to play on" className="visual-review-clips">
                {occupiedSeats.map((seat) => (
                  <button
                    key={seat}
                    type="button"
                    aria-pressed={playSeat === seat}
                    onClick={() => setPlaySeat(seat)}
                  >
                    {`${seat} ${castBySeat.get(seat) ?? ''}`.trim()}
                  </button>
                ))}
              </fieldset>
              <fieldset aria-label="Clip to play" className="visual-review-clips">
                {CLIPS.map((clip) => (
                  <button
                    key={clip}
                    type="button"
                    onClick={() => reviewHooks().riverPlay?.(playSeat, clip)}
                  >
                    {clip.split('_')[0]}
                  </button>
                ))}
              </fieldset>
              <button type="button" onClick={() => setControlsVisible(false)}>
                CLEAN FRAME
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="visual-review-restore"
              onClick={() => setControlsVisible(true)}
            >
              REVIEW
            </button>
          )}
        </section>
      </div>
    </main>
  )
}

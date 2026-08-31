'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { RiverVenue } from '@/components/river-venue'
import { DEFAULT_VENUE, VENUE_ORDER, type VenueId, venueOf, worldSeats } from '@/lib/venue'

const seatIds = Array.from({ length: 8 }, (_, index) => `review-seat-${index}`)
const fullTable = Array.from({ length: 8 }, (_, index) => index)
const sparseTable = [1, 3, 6]
const goldTable = [0]

type Occupancy = 'empty' | 'sparse' | 'full' | 'gold'

function occupiedSeatsFor(occupancy: Occupancy): readonly number[] {
  if (occupancy === 'full') return fullTable
  if (occupancy === 'sparse') return sparseTable
  if (occupancy === 'gold') return goldTable
  return []
}

export function VisualReviewClient() {
  const [venueId, setVenueId] = useState<VenueId>(DEFAULT_VENUE)
  const [occupancy, setOccupancy] = useState<Occupancy>('full')
  const [controlsVisible, setControlsVisible] = useState(true)
  const [stageScale, setStageScale] = useState(2 / 3)
  const seatRefs = useRef<Map<string, HTMLElement>>(new Map())
  const occupiedSeats = occupiedSeatsFor(occupancy)

  useEffect(() => {
    const resize = () =>
      setStageScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080))
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

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

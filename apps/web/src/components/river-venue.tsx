'use client'

import dynamic from 'next/dynamic'
import type { RefObject } from 'react'
import type { AnimationCue } from '@/lib/animation'
import type { VenueId } from '@/lib/venue'
import type { SeatChips } from './river-venue-scene'

const RiverScene = dynamic(
  () => import('./river-venue-scene').then((module) => module.RiverScene),
  {
    ssr: false,
  },
)

type RiverVenueProps = {
  seatIds: string[]
  seatRefs: RefObject<Map<string, HTMLElement>>
  venueId: VenueId
  cues?: readonly AnimationCue[] | undefined
  /** Seat indexes with somebody in them; the rest render as empty chairs. */
  occupiedSeats?: readonly number[] | undefined
  /** What each occupied seat has in front of it, for the chip stacks. */
  seatChips?: readonly SeatChips[] | undefined
}

export function RiverVenue({
  seatIds,
  seatRefs,
  venueId,
  cues,
  occupiedSeats,
  seatChips,
}: RiverVenueProps) {
  return (
    <RiverScene
      seatIds={seatIds}
      seatRefs={seatRefs}
      venueId={venueId}
      cues={cues}
      occupiedSeats={occupiedSeats}
      seatChips={seatChips}
    />
  )
}

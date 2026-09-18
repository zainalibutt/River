'use client'

import type { Card } from '@river/engine'
import dynamic from 'next/dynamic'
import type { RefObject } from 'react'
import type { AnimationCue } from '@/lib/animation'
import type { ChipMoment } from '@/lib/chip-flow'
import type { VenueId } from '@/lib/venue'
import type { HoleSeat, SeatChips } from './river-venue-scene'

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
  /** Each dealt-in seat's two cards: held, folded to the muck, or face up at a showdown. */
  holeSeats?: readonly HoleSeat[] | undefined
  /** The deal those cards belong to. */
  handNumber?: number | undefined
  /** Seats holding their cards up. */
  heldPeeks?: readonly number[] | undefined
  /** Chips on the move, one running entry per message. */
  chipMoments?: readonly ChipMoment[] | undefined
  /** The community cards dealt so far. */
  board?: readonly Card[] | undefined
  /** What each occupied seat has in front of it, for the chip stacks. */
  seatChips?: readonly SeatChips[] | undefined
  heroSeat?: number | null | undefined
  /** How many hands have finished; a player standing for an all-in sits down on a change. */
  handSerial?: number | undefined
  reviewSeat?: number | null | undefined
  /** Empty seats the local player may take; hovering one lights its chair. */
  sittableSeats?: readonly number[] | undefined
  onSit?: ((seat: number) => void) | undefined
}

export function RiverVenue({
  seatIds,
  seatRefs,
  venueId,
  cues,
  occupiedSeats,
  holeSeats,
  handNumber,
  heldPeeks,
  chipMoments,
  board,
  seatChips,
  heroSeat,
  handSerial,
  reviewSeat,
  sittableSeats,
  onSit,
}: RiverVenueProps) {
  return (
    <RiverScene
      seatIds={seatIds}
      seatRefs={seatRefs}
      venueId={venueId}
      cues={cues}
      occupiedSeats={occupiedSeats}
      holeSeats={holeSeats}
      handNumber={handNumber}
      heldPeeks={heldPeeks}
      chipMoments={chipMoments}
      board={board}
      seatChips={seatChips}
      heroSeat={heroSeat}
      handSerial={handSerial}
      reviewSeat={reviewSeat}
      sittableSeats={sittableSeats}
      onSit={onSit}
    />
  )
}

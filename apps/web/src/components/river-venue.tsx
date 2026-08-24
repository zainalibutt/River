'use client'

import dynamic from 'next/dynamic'
import type { RefObject } from 'react'

const RiverScene = dynamic(
  () => import('./river-venue-scene').then((module) => module.RiverScene),
  {
    ssr: false,
  },
)

type RiverVenueProps = {
  seatIds: string[]
  seatRefs: RefObject<Map<string, HTMLElement>>
}

export function RiverVenue({ seatIds, seatRefs }: RiverVenueProps) {
  return <RiverScene seatIds={seatIds} seatRefs={seatRefs} />
}

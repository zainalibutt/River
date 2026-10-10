'use client'

import { useEffect, useState } from 'react'

/**
 * The menu's room, moving: a twenty-second loop of the camera drifting round the empty
 * table, rendered from the same rooftop as the intro film. It fades in over the still once
 * it is actually playing, so a slow connection only ever sees the still.
 *
 * Wide screens only. A phone keeps the still (the loop is a landscape frame and costs data
 * a phone menu does not need), and so does anyone asking for reduced motion or less data.
 */

const DRIFT_QUERY = '(min-width: 900px) and (min-aspect-ratio: 4/3)'
/** H.264 for every browser that has it; VP9 for the ones built without it. */
const DRIFT_SOURCES = [
  ['/menu/rooftop-drift.mp4', 'video/mp4'],
  ['/menu/rooftop-drift.webm', 'video/webm'],
] as const

function wantsDrift(): boolean {
  if (!window.matchMedia(DRIFT_QUERY).matches) return false
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  return connection?.saveData !== true
}

export function MenuDrift() {
  const [wanted, setWanted] = useState(false)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    setWanted(wantsDrift())
  }, [])

  if (!wanted) return null
  return (
    <video
      className={`club-home-drift${playing ? ' playing' : ''}`}
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      onPlaying={() => setPlaying(true)}
    >
      {DRIFT_SOURCES.map(([src, type]) => (
        <source key={src} src={src} type={type} />
      ))}
    </video>
  )
}

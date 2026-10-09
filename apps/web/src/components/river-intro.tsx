'use client'

import { useEffect, useRef, useState } from 'react'
import { CardBack, PlayingCard } from '@/components/table-pieces'
import { tableSound } from '@/lib/table-sound'
import './river-intro.css'

/**
 * The way into River: three seconds of cards before the menu.
 *
 * A deck falls into a pool of warm light and fans; one card spins up out of it and turns
 * over, catching the light, as the ace of spades; two chips roll in and settle on it; and
 * the room pushes in through the spade until it fills the screen and opens on the menu.
 *
 * Once a visit, kept in this tab's session. Any press or key skips it, and with reduced
 * motion it never plays. It is drawn rather than filmed, so it is light, sharp at any size
 * and quick to retime; when the 3D room arrives the push through the spade can open on it.
 */

const SEEN_KEY = 'river:intro-seen'
/** When the last beat has finished and the menu is fully in view. */
const LENGTH_MS = 3_050
/** How long the curtain takes to lift once the intro ends or is skipped. */
const LEAVE_MS = 320
/** The sounds under the beats; silent until the browser allows sound, as it must. */
const BEATS: readonly [number, Parameters<typeof tableSound.play>[0]][] = [
  [600, 'card_slide'],
  [1_250, 'card_flip'],
  [1_900, 'chip_place'],
  [2_120, 'chip_place'],
]

type Phase = 'deciding' | 'playing' | 'leaving' | 'gone'

function alreadySeen(): boolean {
  try {
    return window.sessionStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return false
  }
}

export function RiverIntro() {
  // Drawn by the server too, so the menu never shows for a frame before the intro covers it.
  const [phase, setPhase] = useState<Phase>('deciding')
  // Decided once per mount: the second run of this effect would read its own mark as seen.
  const decided = useRef(false)

  useEffect(() => {
    if (decided.current) return
    decided.current = true
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (still || alreadySeen()) {
      setPhase('leaving')
      return
    }
    try {
      window.sessionStorage.setItem(SEEN_KEY, '1')
    } catch {
      // A browser that will not keep it plays the intro again next load.
    }
    setPhase('playing')
  }, [])

  useEffect(() => {
    if (phase === 'playing') {
      const timers = BEATS.map(([at, effect]) =>
        window.setTimeout(() => tableSound.play(effect), at),
      )
      const end = window.setTimeout(() => setPhase('leaving'), LENGTH_MS)
      const skip = () => setPhase('leaving')
      window.addEventListener('keydown', skip)
      return () => {
        for (const timer of timers) window.clearTimeout(timer)
        window.clearTimeout(end)
        window.removeEventListener('keydown', skip)
      }
    }
    if (phase === 'leaving') {
      const gone = window.setTimeout(() => setPhase('gone'), LEAVE_MS)
      return () => window.clearTimeout(gone)
    }
  }, [phase])

  if (phase === 'gone') return null
  return (
    <div
      className={`river-intro ${phase}`}
      aria-hidden="true"
      onPointerDown={() => setPhase((current) => (current === 'playing' ? 'leaving' : current))}
    >
      <div className="intro-light" />
      {phase === 'playing' ? (
        <div className="intro-stage">
          <div className="intro-deck">
            {[0, 1, 2, 3, 4].map((index) => (
              <div key={index} className={`intro-card intro-fan-${index}`}>
                <CardBack />
              </div>
            ))}
          </div>
          <div className="intro-hero">
            <div className="intro-hero-turn">
              <div className="intro-hero-back">
                <CardBack />
              </div>
              <div className="intro-hero-face">
                <PlayingCard card={{ rank: 'A', suit: 's' }} />
                <i className="intro-sheen" />
              </div>
            </div>
          </div>
          <span className="intro-chip intro-chip-left" />
          <span className="intro-chip intro-chip-right" />
        </div>
      ) : null}
      {phase === 'playing' ? <p className="intro-mark">River</p> : null}
    </div>
  )
}

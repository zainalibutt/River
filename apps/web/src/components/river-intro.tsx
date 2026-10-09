'use client'

import { useEffect, useRef, useState } from 'react'
import { PlayingCard } from '@/components/table-pieces'
import { tableSound } from '@/lib/table-sound'
import './river-intro.css'

/**
 * The way into River.
 *
 * On a wide screen it opens on film: the rooftop at night, a pan off the blackjack table
 * to the city, the terrace from above, Gold at the poker table, and over her shoulder as
 * she peeks at pocket aces. Where the film ends the same two aces take over in the table's
 * own drawing: they straighten to the screen, turn over to the river-spade back, fold
 * into one card, and the card gives way to the mark and the name.
 *
 * A phone, or a screen that will not play the film in time, gets the drawn half alone:
 * the aces are dealt up from below and the same turn, fold and mark follow.
 *
 * Once a visit, kept in this tab's session. Any press or key skips it, and with reduced
 * motion it never plays.
 */

const SEEN_KEY = 'river:intro-seen'
/** H.264 for every browser that has it; VP9 for the ones built without it. */
const FILM_SOURCES = [
  ['/intro/river-intro.mp4', 'video/mp4'],
  ['/intro/river-intro.webm', 'video/webm'],
] as const
/** Wide enough for a landscape film to be worth its weight. */
const FILM_QUERY = '(min-width: 900px) and (min-aspect-ratio: 4/3)'
/** How long the film may take to start before the drawn half plays instead. */
const FILM_START_MS = 2_500
/** The drawn half, from the first frame to the name held in full. */
const CARDS_MS = 3_500
/** How long the curtain takes to lift once the intro ends or is skipped. */
const LEAVE_MS = 360
/** The sounds under the drawn half; silent until the browser allows sound, as it must. */
const BEATS: readonly [number, Parameters<typeof tableSound.play>[0]][] = [
  [640, 'card_flip'],
  [740, 'card_flip'],
  [1_180, 'card_slide'],
]

type Phase = 'deciding' | 'film' | 'cards' | 'leaving' | 'gone'

function alreadySeen(): boolean {
  try {
    return window.sessionStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return false
  }
}

function saveData(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  return connection?.saveData === true
}

export function RiverIntro() {
  // Drawn by the server too, so the menu never shows for a frame before the intro covers it.
  const [phase, setPhase] = useState<Phase>('deciding')
  // Whether the drawn half follows the film (and starts where it ends) or plays alone.
  const [fromFilm, setFromFilm] = useState(false)
  // Decided once per mount: the second run of this effect would read its own mark as seen.
  const decided = useRef(false)
  const film = useRef<HTMLVideoElement>(null)

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
    const wide = window.matchMedia(FILM_QUERY).matches && !saveData()
    setFromFilm(wide)
    setPhase(wide ? 'film' : 'cards')
  }, [])

  useEffect(() => {
    if (phase !== 'film' && phase !== 'cards') {
      if (phase === 'leaving') {
        const gone = window.setTimeout(() => setPhase('gone'), LEAVE_MS)
        return () => window.clearTimeout(gone)
      }
      return
    }
    const timers: number[] = []
    if (phase === 'film') {
      const video = film.current
      // A film that has not begun in time is not waited for: the cards play alone.
      timers.push(
        window.setTimeout(() => {
          if (!video || video.currentTime === 0) {
            setFromFilm(false)
            setPhase('cards')
          }
        }, FILM_START_MS),
      )
      void video?.play().catch(() => {
        setFromFilm(false)
        setPhase('cards')
      })
    } else {
      for (const [at, effect] of BEATS) {
        timers.push(window.setTimeout(() => tableSound.play(effect), at))
      }
      timers.push(window.setTimeout(() => setPhase('leaving'), CARDS_MS))
    }
    const skip = () => setPhase('leaving')
    window.addEventListener('keydown', skip)
    return () => {
      for (const timer of timers) window.clearTimeout(timer)
      window.removeEventListener('keydown', skip)
    }
  }, [phase])

  if (phase === 'gone') return null
  const playing = phase === 'film' || phase === 'cards'
  return (
    <div
      className={`river-intro ${phase}${fromFilm ? ' from-film' : ' dealt'}`}
      aria-hidden="true"
      onPointerDown={() =>
        setPhase((current) => (current === 'film' || current === 'cards' ? 'leaving' : current))
      }
    >
      {fromFilm && playing ? (
        <video
          ref={film}
          className="intro-film"
          muted
          playsInline
          preload="auto"
          onEnded={() => setPhase((current) => (current === 'film' ? 'cards' : current))}
        >
          {FILM_SOURCES.map(([src, type]) => (
            <source key={src} src={src} type={type} />
          ))}
        </video>
      ) : null}
      {phase === 'cards' ? (
        <>
          <div className="intro-light" />
          <div className="intro-frame">
            {(['h', 's'] as const).map((suit) => (
              <div key={suit} className={`intro-ace intro-ace-${suit}`}>
                <div className="intro-ace-turn">
                  <div className="intro-ace-face">
                    <PlayingCard card={{ rank: 'A', suit }} />
                  </div>
                  <div className="intro-ace-back" />
                </div>
              </div>
            ))}
          </div>
          <div className="intro-lockup">
            <span className="intro-mark" />
            <p className="intro-word">River</p>
            <p className="intro-tag">Premium poker</p>
          </div>
        </>
      ) : null}
    </div>
  )
}

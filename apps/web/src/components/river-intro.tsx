'use client'

import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react'
import { riverMusic } from '@/lib/river-music'
import { tableSound } from '@/lib/table-sound'
import './river-intro.css'

/**
 * The way into River: the river card, then the mark.
 *
 * On a wide screen it opens on a short macro film, everything close enough to touch: light
 * comes up on the felt over the name printed in it, a chip drops onto a stack and settles,
 * and one card slides in face down and lifts a corner on the ace of spades as the light goes.
 *
 * Out of the dark a brass line runs in like a river, climbs into the outline of the spade and
 * fills it; the name sets itself beneath; and the whole mark glides up into the menu's own,
 * landing on it as the curtain lifts, so the intro becomes the page rather than cutting to it.
 * A phone, or a screen that cannot start the film in time, gets the mark alone.
 *
 * It opens on a gate, the mark on black and an invitation to enter, because a browser lets
 * nothing sound until it is pressed. Every sound after it is cut to a motion on screen, and the
 * last, a rush into a low hit as the mark settles, lands on the first beat of the menu's theme.
 *
 * Once a visit, kept in this tab's session. Any press or key skips it once it is running, and
 * with reduced motion it never plays.
 */

const SEEN_KEY = 'river:intro-seen'
/** H.264 for every browser that has it; VP9 for the ones built without it. */
const FILM_SOURCES = [
  ['/intro/river-card.mp4', 'video/mp4'],
  ['/intro/river-card.webm', 'video/webm'],
] as const
/** Wide enough for a landscape film to be worth its weight. */
const FILM_QUERY = '(min-width: 900px) and (min-aspect-ratio: 4/3)'
/** How long the film may take to start before the mark plays alone. */
const FILM_START_MS = 2_500
/** The mark, from the first of the line to the name held in full. */
const IDENT_MS = 2_700
/** The glide into the menu's mark while the curtain lifts. */
const LAND_MS = 750
/** The fade when the intro is skipped. */
const LEAVE_MS = 320
/**
 * The river, then the spade: one stroke that comes in from far left, meanders, arrives at the
 * foot of the left lobe, climbs to the tip, runs down the right lobe and curls back into the
 * current. In the mark's own 200-unit space, so it lies exactly on the filled mark.
 */
const TRACE =
  'M-1500 150C-1300 95-1120 205-900 150S-560 92-380 140S-20 196 25 122' +
  'C22 78 79 52 100 12C121 52 178 78 175 122C173 153 139 167 111 151C95 141 75 128 52 131'

type Phase = 'deciding' | 'gate' | 'film' | 'ident' | 'landing' | 'leaving' | 'gone'

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
  const [landing, setLanding] = useState<CSSProperties>({})
  // Decided once per mount: the second run of this effect would read its own mark as seen.
  const decided = useRef(false)
  const film = useRef<HTMLVideoElement>(null)
  const lockup = useRef<HTMLDivElement>(null)
  // What the gate opens on: the film on a wide screen, the mark alone otherwise.
  const opening = useRef<'film' | 'ident'>('ident')
  const gate = useRef<HTMLButtonElement>(null)

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
    opening.current = window.matchMedia(FILM_QUERY).matches && !saveData() ? 'film' : 'ident'
    riverMusic.holdForIntro()
    setPhase('gate')
  }, [])

  // The press on the gate is the one the browser needs before anything may sound.
  const enter = useCallback(() => {
    tableSound.unlock()
    riverMusic.unlock()
    setPhase(opening.current)
  }, [])
  const skip = useCallback(() => {
    riverMusic.skipIntro()
    setPhase('leaving')
  }, [])

  useEffect(() => {
    if (phase === 'leaving' || phase === 'landing') {
      const gone = window.setTimeout(
        () => setPhase('gone'),
        phase === 'landing' ? LAND_MS : LEAVE_MS,
      )
      return () => window.clearTimeout(gone)
    }
    if (phase === 'gate') {
      gate.current?.focus()
      const key = (event: KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') return
        enter()
      }
      window.addEventListener('keydown', key)
      return () => window.removeEventListener('keydown', key)
    }
    if (phase !== 'film' && phase !== 'ident') return
    const timers: number[] = []
    let frame = 0
    if (phase === 'film') {
      const video = film.current
      // A film that has not begun in time is not waited for: the mark plays alone.
      timers.push(
        window.setTimeout(() => {
          if (!video || video.currentTime === 0) setPhase('ident')
        }, FILM_START_MS),
      )
      void video?.play().catch(() => setPhase('ident'))
      // The film's score follows its own clock: it starts where the picture actually is.
      const listen = () => {
        if (video && video.currentTime > 0) {
          riverMusic.playCue('intro-film', video.currentTime)
          return
        }
        frame = window.requestAnimationFrame(listen)
      }
      frame = window.requestAnimationFrame(listen)
    } else {
      // The mark's own score, and the theme's first downbeat on the moment it settles.
      riverMusic.landAt(performance.now() + IDENT_MS + LAND_MS)
      riverMusic.playCue('intro-mark')
      timers.push(
        window.setTimeout(() => {
          // Land on the menu's own mark: the same lockup, measured where it sits.
          const from = lockup.current?.getBoundingClientRect()
          const to = document
            .querySelector('.club-home-header .club-wordmark')
            ?.getBoundingClientRect()
          if (from && to && from.width > 0) {
            setLanding({
              '--land-x': `${to.left + to.width / 2 - (from.left + from.width / 2)}px`,
              '--land-y': `${to.top + to.height / 2 - (from.top + from.height / 2)}px`,
            } as CSSProperties)
          }
          setPhase('landing')
        }, IDENT_MS),
      )
    }
    window.addEventListener('keydown', skip)
    return () => {
      for (const timer of timers) window.clearTimeout(timer)
      window.cancelAnimationFrame(frame)
      window.removeEventListener('keydown', skip)
    }
  }, [phase, enter, skip])

  if (phase === 'gone') return null
  const showIdent = phase === 'ident' || phase === 'landing'
  return (
    <div
      className={`river-intro ${phase}`}
      aria-hidden={phase === 'gate' ? undefined : true}
      onPointerDown={() => {
        if (phase === 'film' || phase === 'ident') skip()
      }}
    >
      <div className="intro-curtain" />
      {phase === 'gate' ? (
        <button ref={gate} type="button" className="intro-gate" onClick={enter}>
          <span className="intro-gate-mark" aria-hidden="true" />
          <span className="intro-gate-call">
            <span className="intro-gate-tap">Tap to enter</span>
            <span className="intro-gate-click">Click to enter</span>
          </span>
        </button>
      ) : null}
      {phase === 'film' ? (
        <video
          ref={film}
          className="intro-film"
          muted
          playsInline
          preload="auto"
          onEnded={() => setPhase((current) => (current === 'film' ? 'ident' : current))}
        >
          {FILM_SOURCES.map(([src, type]) => (
            <source key={src} src={src} type={type} />
          ))}
        </video>
      ) : null}
      {showIdent ? (
        <div className="intro-ident">
          {/* The menu's own lockup classes, so the mark lands on its twin at every size. */}
          <div ref={lockup} className="club-wordmark intro-lockup" style={landing}>
            <span className="club-home-mark intro-mark">
              <span className="intro-mark-fill" />
              <span className="intro-mark-sheen" />
              <svg className="intro-trace" viewBox="0 0 200 200" aria-hidden="true">
                <path d={TRACE} pathLength={1} />
              </svg>
            </span>
            <p className="club-wordmark-name intro-name">
              {[...'River'].map((letter, index) => (
                <span key={letter + String(index)} style={{ '--i': index } as CSSProperties}>
                  {letter}
                </span>
              ))}
            </p>
            <p className="club-home-tagline intro-tag">Premium poker</p>
          </div>
        </div>
      ) : null}
    </div>
  )
}

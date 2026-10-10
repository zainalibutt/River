'use client'

import type { EconomyStatus } from '@river/engine'
import { useCallback, useEffect, useState } from 'react'

/**
 * Daily chips, where a player can see them: on the menu's player capsule.
 *
 * The rules and the grant are the server's (see app/api/daily). This only shows what the
 * server says can be claimed, claims it with one press, and says when the next one opens.
 * Nothing pops up and nothing stands between a player and their first hand.
 */

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; status: EconomyStatus }
  | { kind: 'claiming'; status: EconomyStatus }
  | { kind: 'claimed'; delta: number; status: EconomyStatus }
  | { kind: 'unavailable' }

/** A wrapped present in the menu's brass line: the box, its lid, the ribbon and the bow. */
function GiftMark() {
  return (
    <svg className="club-daily-gift" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="10.5" width="17" height="10.5" rx="1.4" />
      <g className="club-daily-gift-lid">
        <rect x="2.5" y="7" width="19" height="3.5" rx="1" />
        <path d="M12 7C10.2 3.6 6.6 3.4 6.9 5.5 7.1 6.9 10 7 12 7Zm0 0c1.8-3.4 5.4-3.6 5.1-1.5C16.9 6.9 14 7 12 7Z" />
      </g>
      <path d="M12 7v14" />
    </svg>
  )
}

function untilText(atMs: number, nowMs: number): string {
  const minutes = Math.max(1, Math.round((atMs - nowMs) / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

export function DailyChips({
  accessToken,
  onBalance,
}: {
  /** A fresh token for the signed-in or guest player. */
  accessToken: () => Promise<string>
  /** The new bankroll after a claim, for the capsule's count. */
  onBalance: (balance: number) => void
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [now, setNow] = useState(() => Date.now())

  const call = useCallback(
    async (method: 'GET' | 'POST') => {
      const response = await fetch('/api/daily', {
        method,
        headers: { authorization: `Bearer ${await accessToken()}` },
        cache: 'no-store',
      })
      if (!response.ok) throw new Error(`daily chips ${response.status}`)
      return response.json() as Promise<
        | { status: EconomyStatus }
        | { kind: 'granted'; delta: number; balance: number; status: EconomyStatus }
        | { kind: 'already-claimed'; status: EconomyStatus }
      >
    },
    [accessToken],
  )

  useEffect(() => {
    let cancelled = false
    call('GET')
      .then((body) => {
        if (!cancelled && 'status' in body) setPhase({ kind: 'ready', status: body.status })
      })
      .catch(() => {
        if (!cancelled) setPhase({ kind: 'unavailable' })
      })
    return () => {
      cancelled = true
    }
  }, [call])

  // The countdown to the next claim, a minute at a time.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  if (phase.kind === 'loading' || phase.kind === 'unavailable') return null
  const status = phase.status
  const claim = async () => {
    if (phase.kind !== 'ready') return
    setPhase({ kind: 'claiming', status })
    try {
      const body = await call('POST')
      if ('kind' in body && body.kind === 'granted') {
        onBalance(body.balance)
        setPhase({ kind: 'claimed', delta: body.delta, status: body.status })
      } else {
        setPhase({ kind: 'ready', status: body.status })
      }
    } catch {
      setPhase({ kind: 'ready', status })
    }
  }

  return (
    <div className="club-daily" aria-live="polite">
      <div className="club-capsule-label">Daily chips</div>
      {phase.kind === 'claimed' ? (
        <div className="club-daily-line">
          <strong>+{phase.delta.toLocaleString('en-GB')}</strong>
          <span className="club-capsule-sub">
            Day {status.daily.streakDay} · next in {untilText(status.daily.nextAtMs, now)}
          </span>
        </div>
      ) : status.daily.claimable ? (
        <div className="club-daily-line">
          {/* A present to open rather than a figure to read: the amount is the surprise,
              and stays in the button's name for anyone who cannot see the icon. */}
          <button
            type="button"
            className="club-daily-claim"
            aria-label={`Claim ${status.daily.amount.toLocaleString('en-GB')}`}
            title={`Claim ${status.daily.amount.toLocaleString('en-GB')} chips`}
            disabled={phase.kind === 'claiming'}
            onClick={() => void claim()}
          >
            <GiftMark />
          </button>
          <span className="club-capsule-sub">
            {status.daily.streakDay > 1 ? `Day ${status.daily.streakDay} streak` : 'Day 1'}
          </span>
        </div>
      ) : (
        <div className="club-daily-line">
          <span className="club-daily-waiting">
            <GiftMark />
          </span>
          <span className="club-capsule-sub">Next in {untilText(status.daily.nextAtMs, now)}</span>
        </div>
      )}
    </div>
  )
}

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
          <button
            type="button"
            className="club-daily-claim"
            disabled={phase.kind === 'claiming'}
            onClick={() => void claim()}
          >
            Claim {status.daily.amount.toLocaleString('en-GB')}
          </button>
          <span className="club-capsule-sub">
            {status.daily.streakDay > 1 ? `Day ${status.daily.streakDay} streak` : 'Day 1'}
          </span>
        </div>
      ) : (
        <div className="club-daily-line">
          <span className="club-capsule-sub">Next in {untilText(status.daily.nextAtMs, now)}</span>
        </div>
      )}
    </div>
  )
}

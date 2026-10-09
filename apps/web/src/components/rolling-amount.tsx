'use client'

import { useEffect, useRef, useState } from 'react'
import { formatAmount } from '@/lib/presentation'
import { tableNow } from '@/lib/table-clock'
import { useReducedMotion } from '@/lib/use-reduced-motion'

/** How long a number takes to count to its new value. */
const ROLL_MS = 480

/**
 * A number that counts to its new value rather than jumping: a pot paid into a stack
 * reads as chips arriving, and a bet as chips leaving. On the table's clock, so the
 * motion lab slows it with everything else; with reduced motion it simply changes.
 */
export function useRollingNumber(target: number): number {
  const still = useReducedMotion()
  const [shown, setShown] = useState(target)
  const current = useRef(target)
  useEffect(() => {
    if (still || current.current === target) {
      current.current = target
      setShown(target)
      return
    }
    const from = current.current
    const startAt = tableNow()
    let frame = 0
    const tick = () => {
      const t = Math.min(1, Math.max(0, (tableNow() - startAt) / ROLL_MS))
      const value = from + (target - from) * (1 - (1 - t) ** 3)
      current.current = value
      setShown(value)
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, still])
  return Math.round(shown)
}

/** An amount, counted up or down to each new value. */
export function RollingAmount({
  value,
  abbreviated,
  bigBlind,
}: {
  value: number
  abbreviated: boolean
  bigBlind: number | null
}) {
  return <>{formatAmount(useRollingNumber(value), abbreviated, bigBlind)}</>
}

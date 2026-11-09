'use client'

import { useRef, useState } from 'react'
import { useDialogFocus } from '@/lib/use-dialog-focus'
import { useReducedMotion } from '@/lib/use-reduced-motion'

/** How long the wheel turns before it settles on the server's segment. */
export const WHEEL_SPIN_MS = 3_600
/** Whole turns before it settles: enough to read as a spin, not so many it blurs. */
const TURNS = 5

/**
 * The rotation that brings `segment` under the pointer at the top, after whole turns.
 * Segment 0 starts at twelve o'clock and they run clockwise.
 */
export function wheelRotation(segment: number, count: number, turns = TURNS): number {
  const slice = 360 / count
  return turns * 360 - (segment * slice + slice / 2)
}

function short(amount: number): string {
  return amount >= 1_000 ? `${amount / 1_000}K` : String(amount)
}

/** One point on the rim, for the slice paths. */
function rim(angle: number, radius: number): [number, number] {
  const radians = ((angle - 90) * Math.PI) / 180
  return [100 + radius * Math.cos(radians), 100 + radius * Math.sin(radians)]
}

/**
 * The daily wheel. It never chooses anything: the server has already decided the
 * segment from a keyed hash of the player and the day, and the wheel only turns to it.
 * The odds are on the face of it - every segment the same size - and in words below.
 */
export function DailyWheel({
  prizes,
  onSpin,
  onClose,
}: {
  prizes: readonly number[]
  /** Claims today's spin; resolves with the segment the server chose, or null if refused. */
  onSpin: () => Promise<{ segment: number; delta: number } | null>
  onClose: () => void
}) {
  const reduced = useReducedMotion()
  const dialog = useRef<HTMLElement | null>(null)
  useDialogFocus(dialog, onClose)
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'spinning'; rotation: number }
    | { kind: 'won'; rotation: number; delta: number }
    | { kind: 'failed' }
  >({ kind: 'idle' })

  const spin = async () => {
    if (state.kind !== 'idle') return
    // Turn at once so the press feels answered; settle where the server says.
    setState({ kind: 'spinning', rotation: 720 })
    const result = await onSpin()
    if (result === null) {
      setState({ kind: 'failed' })
      return
    }
    setState({ kind: 'spinning', rotation: wheelRotation(result.segment, prizes.length) })
    window.setTimeout(
      () =>
        setState({
          kind: 'won',
          rotation: wheelRotation(result.segment, prizes.length),
          delta: result.delta,
        }),
      reduced ? 0 : WHEEL_SPIN_MS,
    )
  }

  const rotation = state.kind === 'spinning' || state.kind === 'won' ? state.rotation : 0
  const slice = 360 / prizes.length

  return (
    <div className="modal-backdrop club-wheel-backdrop" role="presentation">
      <section
        ref={dialog}
        className="club-wheel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="club-wheel-title"
        tabIndex={-1}
      >
        <button type="button" className="club-wheel-close" onClick={onClose}>
          Close
        </button>
        <h2 id="club-wheel-title">Daily spin</h2>
        <div className="club-wheel-stage">
          <span className="club-wheel-pointer" aria-hidden="true" />
          <svg
            className="club-wheel-face"
            viewBox="0 0 200 200"
            aria-hidden="true"
            style={{
              transform: `rotate(${rotation}deg)`,
              transitionDuration: reduced || rotation === 0 ? '0ms' : `${WHEEL_SPIN_MS}ms`,
            }}
          >
            {prizes.map((prize, index) => {
              const [x1, y1] = rim(index * slice, 96)
              const [x2, y2] = rim((index + 1) * slice, 96)
              const [tx, ty] = rim(index * slice + slice / 2, 62)
              return (
                <g key={prize}>
                  <path
                    d={`M100 100 L${x1} ${y1} A96 96 0 0 1 ${x2} ${y2} Z`}
                    className={`club-wheel-slice slice-${index % 2}`}
                  />
                  <text
                    x={tx}
                    y={ty}
                    className="club-wheel-label"
                    transform={`rotate(${index * slice + slice / 2} ${tx} ${ty})`}
                  >
                    {short(prize)}
                  </text>
                </g>
              )
            })}
            <circle cx="100" cy="100" r="14" className="club-wheel-hub" />
          </svg>
        </div>
        <p className="club-wheel-result" role="status">
          {state.kind === 'won'
            ? `+${state.delta.toLocaleString('en-GB')} chips`
            : state.kind === 'failed'
              ? 'The spin did not go through. Try again in a moment.'
              : state.kind === 'spinning'
                ? 'Spinning…'
                : 'One free spin a day.'}
        </p>
        {state.kind === 'won' ? (
          <button type="button" className="club-wheel-spin" onClick={onClose}>
            Collect
          </button>
        ) : (
          <button
            type="button"
            className="club-wheel-spin"
            disabled={state.kind === 'spinning'}
            onClick={() => (state.kind === 'failed' ? setState({ kind: 'idle' }) : void spin())}
          >
            {state.kind === 'failed' ? 'Back' : 'Spin'}
          </button>
        )}
        <p className="club-wheel-odds">
          Five equal segments, {short(prizes[0] ?? 0)} to {short(prizes.at(-1) ?? 0)}: each is a 1
          in {prizes.length} chance. Play chips only.
        </p>
      </section>
    </div>
  )
}

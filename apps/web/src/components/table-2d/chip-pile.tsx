import { readableStacks } from '@river/engine'

/**
 * A pile of chips standing on the felt, seen from a seat at the table.
 *
 * Chips carry magnitude, not value - a rich stack is visibly taller than a short one, and
 * the number beside it carries the amount. Each denomination stands in its own column, as a
 * dealer builds a pile, drawn as one body, one set of edge lines and one face per column so a
 * table of piles stays a few hundred shapes rather than a thousand.
 */

const RADIUS = 13
const THICKNESS = 3.1
const LEAN = 0.46

function shade(hex: string, amount: number): string {
  const value = Number.parseInt(hex, 16)
  const channel = (shift: number) =>
    Math.max(0, Math.min(255, Math.round(((value >> shift) & 255) * amount)))
  return `rgb(${channel(16)} ${channel(8)} ${channel(0)})`
}

export function ChipPile({
  amount,
  maxChips = 14,
  className,
}: {
  amount: number
  maxChips?: number
  className?: string
}) {
  const stacks = readableStacks(amount, maxChips).slice(0, 4)
  if (stacks.length === 0) return null
  const ry = RADIUS * LEAN
  const pitch = RADIUS * 1.86
  const tallest = Math.max(...stacks.map((stack) => stack.count))
  const width = pitch * (stacks.length - 1) + RADIUS * 2 + 2
  const height = tallest * THICKNESS + ry * 2 + 2
  const base = height - ry - 1
  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      style={{ marginLeft: -width / 2, marginTop: -base }}
    >
      {stacks.map((stack, column) => {
        const cx = RADIUS + 1 + column * pitch
        const top = base - (stack.count - 1) * THICKNESS - THICKNESS
        const colour = stack.denomination.colour
        const side = shade(colour, 0.62)
        const face = `#${colour}`
        const light = colour === 'f2efe6' ? '#7d6f5c' : 'rgb(247 243 236 / 78%)'
        const body = `M${cx - RADIUS} ${top}v${base - top}a${RADIUS} ${ry} 0 0 0 ${RADIUS * 2} 0v${-(base - top)}Z`
        let seams = ''
        for (let chip = 1; chip < stack.count; chip += 1) {
          const y = base - chip * THICKNESS
          seams += `M${cx - RADIUS} ${y}a${RADIUS} ${ry} 0 0 0 ${RADIUS * 2} 0`
        }
        return (
          <g key={stack.denomination.value}>
            <path d={body} fill={side} />
            <path
              d={body}
              fill="none"
              stroke={light}
              strokeWidth={THICKNESS * 0.7}
              strokeDasharray="2.2 4.6"
              opacity={0.5}
            />
            {seams === '' ? null : (
              <path d={seams} fill="none" stroke="rgb(0 0 0 / 38%)" strokeWidth={0.8} />
            )}
            <ellipse cx={cx} cy={top} rx={RADIUS} ry={ry} fill={face} />
            <ellipse
              cx={cx}
              cy={top}
              rx={RADIUS - 1.2}
              ry={ry - 0.6}
              fill="none"
              stroke={light}
              strokeWidth={1.8}
              strokeDasharray="2.4 3.6"
            />
            <ellipse
              cx={cx}
              cy={top}
              rx={RADIUS * 0.56}
              ry={ry * 0.56}
              fill={shade(colour, colour === '16161b' ? 2.2 : 1.12)}
              stroke="rgb(0 0 0 / 22%)"
              strokeWidth={0.6}
            />
          </g>
        )
      })}
    </svg>
  )
}

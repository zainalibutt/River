import { type BotPersonality, personalityPool } from '@river/engine'
import { authoredNovelSeats } from './bot-learning-novel-v3.js'
import { authoredShiftSeats } from './bot-learning-shift-v2.js'
import type { SessionEntrant, SessionTableSpec } from './bot-session-benchmark.js'
import { HELD_OUT_STYLES, heldOutStylePolicy } from './bot-style-opponents.js'

/**
 * Who sits where in the session campaigns.
 *
 * The focal seat rotates through the four OG characters. Style players borrow
 * other characters only for a name and an id; their policy decides. The
 * ordinary seats are River's rookies and novices on the live policy, so the
 * focal OG is never also one of its opponents.
 */
export const SESSION_CAST = {
  focalOgs: [9, 10, 11, 12],
  headsUpOpponent: 0,
  headsUpOrdinary: 4,
  nineStyleSeats: [0, 2, 3, 7],
  nineOrdinarySeats: [1, 4, 6, 8],
  nineOrdinaryOnly: [0, 1, 2, 3, 4, 5, 6, 7],
} as const

export const SESSION_CAMPAIGN = {
  headsUp: { sessions: 200, handsPerSession: 100 },
  nine: { sessions: 200, handsPerSession: 60 },
} as const

const cast = personalityPool()

function person(index: number): BotPersonality {
  const found = cast[index]
  if (found === undefined) throw new Error(`session cast ${index} missing`)
  return found
}

export function focalRotation(): readonly BotPersonality[] {
  return SESSION_CAST.focalOgs.map(person)
}

const focal = (): SessionEntrant => ({ personality: person(SESSION_CAST.focalOgs[0]) })

export function heldOutTables(): readonly SessionTableSpec[] {
  return HELD_OUT_STYLES.flatMap((style) => [
    {
      name: `heads-up-${style}`,
      style,
      entrants: [
        focal(),
        { personality: person(SESSION_CAST.headsUpOpponent), policy: heldOutStylePolicy(style) },
      ],
    },
    {
      name: `nine-${style}`,
      style,
      entrants: [
        focal(),
        ...SESSION_CAST.nineStyleSeats.map((index) => ({
          personality: person(index),
          policy: heldOutStylePolicy(style),
        })),
        ...SESSION_CAST.nineOrdinarySeats.map((index) => ({ personality: person(index) })),
      ],
    },
  ])
}

export function ordinaryTables(): readonly SessionTableSpec[] {
  return [
    {
      name: 'heads-up-ordinary',
      style: 'ordinary',
      entrants: [focal(), { personality: person(SESSION_CAST.headsUpOrdinary) }],
    },
    {
      name: 'nine-ordinary',
      style: 'ordinary',
      entrants: [
        focal(),
        ...SESSION_CAST.nineOrdinaryOnly.map((index) => ({ personality: person(index) })),
      ],
    },
  ]
}

/**
 * Development tables for tuning a candidate: the authored styles from the
 * earlier forecasting experiments (docs/design/29 and 31), never the held-out
 * five above.
 */
export function developmentTables(): readonly SessionTableSpec[] {
  const shift = authoredShiftSeats([0, 2, 3, 7])
  const novel = authoredNovelSeats([0, 2, 3, 7])
  const ordinary = SESSION_CAST.nineOrdinarySeats.map((index) => ({ personality: person(index) }))
  const headsUp = [...shift, ...novel].map((seat) => ({
    name: `heads-up-${seat.policy?.id ?? 'unknown'}`,
    style: seat.policy?.id ?? 'unknown',
    entrants: [focal(), { ...seat, personality: person(SESSION_CAST.headsUpOpponent) }],
  }))
  return [
    ...headsUp,
    {
      name: 'nine-shift-styles',
      style: 'shift-styles',
      entrants: [focal(), ...shift, ...ordinary],
    },
    {
      name: 'nine-novel-styles',
      style: 'novel-styles',
      entrants: [focal(), ...novel, ...ordinary],
    },
  ]
}

export function campaignSize(table: SessionTableSpec) {
  return table.entrants.length === 2 ? SESSION_CAMPAIGN.headsUp : SESSION_CAMPAIGN.nine
}

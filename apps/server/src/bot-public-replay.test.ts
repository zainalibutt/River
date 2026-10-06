import { personalityPool } from '@river/engine'
import { describe, expect, it } from 'vitest'
import { pokerGuardPolicy } from './bot-poker-guard.js'
import { publicDecisions } from './bot-public-replay.js'
import { type FocalDecisionPoint, runSessions } from './bot-session-benchmark.js'

const cast = personalityPool()
const person = (index: number) => {
  const found = cast[index]
  if (found === undefined) throw new Error('cast missing')
  return found
}

function focalHands(): FocalDecisionPoint[][] {
  const hands = new Map<string, FocalDecisionPoint[]>()
  runSessions({
    seed: 'replay-test',
    sessions: 2,
    handsPerSession: 40,
    table: {
      name: 'heads-up',
      style: 'plain',
      entrants: [{ personality: person(10) }, { personality: person(0) }],
    },
    focalPolicy: pokerGuardPolicy,
    onFocalDecision: (point) => {
      const key = `${point.session}:${point.hand}`
      hands.set(key, [...(hands.get(key) ?? []), point])
    },
  })
  return [...hands.values()]
}

describe('rebuilding a hand from what the table shows', () => {
  it('reproduces every earlier view the focal seat was given, exactly', () => {
    let compared = 0
    const streets = new Set<string>()
    for (const points of focalHands()) {
      const last = points.at(-1) as FocalDecisionPoint
      const current = last.observation
      const focalId = current.actor.playerId
      const decisions = publicDecisions(current, (playerId) =>
        playerId === focalId
          ? {
              opponents: current.opponents,
              ...(current.opponentStats === undefined
                ? {}
                : { opponentStats: current.opponentStats }),
              tilt: current.tilt,
            }
          : {},
      )
      expect(decisions).not.toBeNull()
      expect(decisions).toHaveLength(current.actions?.length ?? -1)
      for (const point of points.slice(0, -1)) {
        const rebuilt = decisions?.[point.prefix.length]
        expect(rebuilt?.taken.seat).toBe(point.observation.actor.seat)
        expect({
          ...rebuilt?.observation,
          actor: { ...rebuilt?.observation.actor, hole: point.observation.actor.hole },
        }).toEqual(point.observation)
        compared += 1
        streets.add(point.observation.street)
      }
    }
    expect(compared).toBeGreaterThan(40)
    expect([...streets].sort()).toEqual(['flop', 'preflop', 'river', 'turn'])
  })

  it('refuses a history whose chips do not add up', () => {
    const points = focalHands().find((hand) => (hand.at(-1)?.prefix.length ?? 0) >= 3)
    const current = points?.at(-1)?.observation
    if (current?.actions === undefined) throw new Error('no hand with three moves')
    expect(publicDecisions(current)).not.toBeNull()
    const tampered = current.actions.map((entry, index) =>
      index === 1 ? { ...entry, amountCommitted: (entry.amountCommitted ?? 0) + 1 } : entry,
    )
    expect(publicDecisions({ ...current, actions: tampered })).toBeNull()
  })
})

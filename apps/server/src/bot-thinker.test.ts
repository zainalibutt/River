import { personalityPool } from '@river/engine'
import { describe, expect, it } from 'vitest'
import { botPlayerId } from './bot-service.js'
import { openSessionHand } from './bot-session-benchmark.js'
import { isSolvedRiver, workerRiverThinker } from './bot-thinker.js'

const cast = personalityPool()
const person = (index: number) => {
  const found = cast[index]
  if (found === undefined) throw new Error('cast missing')
  return found
}

/** Two OGs checked and called down to a river decision. */
function riverSpot() {
  const entrants = [{ personality: person(10) }, { personality: person(11) }]
  const ids = entrants.map((entrant) => botPlayerId(entrant.personality.id))
  const { room } = openSessionHand('thinker-test', 0, 0, 0, entrants, ids)
  for (let step = 0; step < 40; step += 1) {
    const table = room.viewFor('')
    const actor = table.currentActor?.playerId
    if (actor === undefined) throw new Error('the hand ended before the river')
    if (table.street === 'river') {
      const personality = entrants[ids.indexOf(actor)]?.personality
      if (personality === undefined) throw new Error('unknown actor')
      return { room, view: room.viewFor(actor), actor, personality }
    }
    const legal = room.viewFor(actor).legal
    const action = legal?.check.enabled ? { kind: 'check' as const } : { kind: 'call' as const }
    if (!room.submit({ kind: 'act', playerId: actor, action }).ok) throw new Error('refused')
  }
  throw new Error('no river')
}

describe('a thinker on a worker thread', () => {
  it('only takes two-player river decisions of the OG', () => {
    const { view, actor, personality } = riverSpot()
    expect(isSolvedRiver(view, actor, personality)).toBe(true)
    expect(isSolvedRiver({ ...view, street: 'turn' }, actor, personality)).toBe(false)
    expect(isSolvedRiver(view, actor, { ...personality, skill: 'rookie' })).toBe(false)
  })

  it('answers a river decision with a legal move from the solver', async () => {
    const thinker = workerRiverThinker({ execArgv: ['--import', 'tsx'] })
    try {
      const { room, view, actor, personality } = riverSpot()
      const action = await thinker.think(
        {
          view,
          playerId: actor,
          personality,
          seed: 7,
          options: { roomId: room.id, publicActions: room.currentActions(), opponentSummaries: [] },
        },
        60_000,
      )
      expect(action).not.toBeNull()
      expect(room.submit({ kind: 'act', playerId: actor, action: action as never }).ok).toBe(true)
    } finally {
      await thinker.close()
    }
  }, 120_000)

  it('gives null when the deadline passes first', async () => {
    const thinker = workerRiverThinker({ execArgv: ['--import', 'tsx'] })
    try {
      const { room, view, actor, personality } = riverSpot()
      const action = await thinker.think(
        {
          view,
          playerId: actor,
          personality,
          seed: 7,
          options: { roomId: room.id, publicActions: room.currentActions(), opponentSummaries: [] },
        },
        1,
      )
      expect(action).toBeNull()
    } finally {
      await thinker.close()
    }
  }, 60_000)
})

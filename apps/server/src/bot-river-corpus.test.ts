import { type BotPolicy, personalityPool } from '@river/engine'
import { describe, expect, it } from 'vitest'
import { collectRiverDecisionCorpus } from './bot-river-corpus.js'

const riverBettor: BotPolicy = {
  id: 'corpus-river-bettor',
  version: 1,
  decide(context) {
    const { observation } = context
    const decision =
      observation.street === 'river' &&
      observation.legal.raiseTo.enabled &&
      observation.amountToCall === 0
        ? { kind: 'raiseTo' as const, to: observation.legal.raiseTo.min }
        : observation.legal.check
          ? { kind: 'check' as const }
          : observation.legal.call.enabled
            ? { kind: 'call' as const }
            : { kind: 'fold' as const }
    return {
      policyId: this.id,
      policyVersion: this.version,
      observationVersion: 1,
      decision,
      fallbackReason: null,
    }
  },
}

const riverCaller: BotPolicy = {
  id: 'corpus-river-caller',
  version: 1,
  decide(context) {
    const { legal } = context.observation
    const decision = legal.check
      ? { kind: 'check' as const }
      : legal.call.enabled
        ? { kind: 'call' as const }
        : { kind: 'fold' as const }
    return {
      policyId: this.id,
      policyVersion: this.version,
      observationVersion: 1,
      decision,
      fallbackReason: null,
    }
  },
}

const riverFolder: BotPolicy = {
  id: 'corpus-river-folder',
  version: 1,
  decide(context) {
    const baseline = riverCaller.decide(context)
    return {
      ...baseline,
      policyId: this.id,
      decision:
        context.observation.street === 'river' && context.observation.amountToCall > 0
          ? { kind: 'fold' as const }
          : baseline.decision,
    }
  },
}

const cast = personalityPool()
const first = cast[0]
const second = cast[1]
if (first === undefined || second === undefined) throw new Error('corpus test cast missing')

describe('offline river-decision corpus', () => {
  it('joins only public showdown cards after replay, never into the pre-action observation', () => {
    const options = {
      seed: 'revealed-river-corpus',
      hands: 12,
      seats: [
        { personality: first, policy: riverBettor },
        { personality: second, policy: riverCaller },
      ],
    }
    const rows = collectRiverDecisionCorpus(options)
    expect(rows).toEqual(collectRiverDecisionCorpus(options))
    expect(
      collectRiverDecisionCorpus({
        ...options,
        onHandComplete({ view }) {
          for (const seat of view.seats) seat.hole?.splice(0)
        },
      }),
    ).toEqual(rows)
    expect(rows).toHaveLength(12)
    expect(rows.every((row) => row.action.kind === 'call')).toBe(true)
    expect(rows.every((row) => row.labelStatus === 'revealed_call')).toBe(true)
    expect(rows.every((row) => [0, 0.5, 1].includes(row.callPotShare ?? -1))).toBe(true)
    expect(rows.every((row) => row.observation.actor.hole.length === 2)).toBe(true)
    expect(rows.every((row) => !('opponentHole' in row.observation))).toBe(true)
    expect(rows.every((row) => !('opponentHole' in row))).toBe(true)
  })

  it('does not invent a showdown label for river folds', () => {
    const rows = collectRiverDecisionCorpus({
      seed: 'folded-river-corpus',
      hands: 6,
      seats: [
        { personality: first, policy: riverBettor },
        { personality: second, policy: riverFolder },
      ],
    })
    expect(rows).toHaveLength(6)
    expect(rows.every((row) => row.action.kind === 'fold')).toBe(true)
    expect(rows.every((row) => row.labelStatus === 'not_called' && row.callPotShare === null)).toBe(
      true,
    )
  })
})

import { type BotPolicy, personalityPool } from '@river/engine'
import { describe, expect, it } from 'vitest'
import { collectBenchmarkRiverPublicHistory } from './bot-river-public-history.js'
import { botPlayerId } from './bot-service.js'

const bettor: BotPolicy = {
  id: 'public-history-bettor',
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

const caller: BotPolicy = {
  id: 'public-history-caller',
  version: 1,
  decide(context) {
    const { legal } = context.observation
    return {
      policyId: this.id,
      policyVersion: this.version,
      observationVersion: 1,
      decision: legal.check
        ? { kind: 'check' }
        : legal.call.enabled
          ? { kind: 'call' }
          : { kind: 'fold' },
      fallbackReason: null,
    }
  },
}

const folder: BotPolicy = {
  ...caller,
  id: 'public-history-folder',
  decide(context) {
    const baseline = caller.decide(context)
    return {
      ...baseline,
      policyId: this.id,
      decision:
        context.observation.street === 'river' && context.observation.amountToCall > 0
          ? { kind: 'fold' }
          : baseline.decision,
    }
  },
}

const [first, second] = personalityPool()
if (first === undefined || second === undefined) throw new Error('public history cast missing')
const bettorId = botPlayerId(first.id)

describe('accepted public river opportunity history', () => {
  it('records only prior accepted bets and publicly shown categories', () => {
    const options = {
      seed: 'accepted-river-history',
      hands: 12,
      seats: [
        { personality: first, policy: bettor },
        { personality: second, policy: caller },
      ],
    }
    const collector = collectBenchmarkRiverPublicHistory(options)
    expect(collector.historyBefore(bettorId, 0)).toEqual({
      opportunities: 0,
      bets: 0,
      sizeCounts: { small: 0, medium: 0, large: 0 },
      revealedBetCategories: [],
    })
    expect(collector.historyBefore(bettorId, 6).opportunities).toBe(6)
    const history = collector.historyBefore(bettorId, 12)
    expect(history.opportunities).toBe(12)
    expect(history.bets).toBe(12)
    expect(history.sizeCounts).toBeDefined()
    expect(
      (history.sizeCounts?.small ?? 0) +
        (history.sizeCounts?.medium ?? 0) +
        (history.sizeCounts?.large ?? 0),
    ).toBe(12)
    expect(history.revealedBetCategories).toHaveLength(12)
    expect(JSON.stringify(history)).not.toContain('hole')
    expect(collectBenchmarkRiverPublicHistory(options).historyBefore(bettorId, 12)).toEqual(history)
  })

  it('does not invent revealed hand strength for river folds', () => {
    const collector = collectBenchmarkRiverPublicHistory({
      seed: 'unshown-river-history',
      hands: 6,
      seats: [
        { personality: first, policy: bettor },
        { personality: second, policy: folder },
      ],
    })
    const history = collector.historyBefore(bettorId, 6)
    expect(history.opportunities).toBe(6)
    expect(history.bets).toBe(6)
    expect(history.revealedBetCategories).toEqual([])
  })
})

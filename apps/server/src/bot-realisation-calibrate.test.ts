import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type BotPolicy, mulberry32 } from '@river/engine'
import { describe, expect, it } from 'vitest'
import { HAND_CLASSES } from './bot-preflop-solve-equity.js'
import { DEFAULT_HAND_REALISATION, realisationFactor } from './bot-preflop-solve-realisation.js'
import { tablePreflopPolicy } from './bot-preflop-tables.js'
import {
  handSeed,
  handStartNet,
  recordCalibrationHand,
  writeCalibrationShard,
} from './bot-realisation-calibrate.js'
import { fitRealisation, type RealisationObservation } from './bot-realisation-fit.js'

const options = {
  seed: 'calibration-test',
  worker: 3,
  depth: 100,
  equitySamples: 8,
  policyId: 'test-only',
}
const fold: BotPolicy = {
  id: 'test-fold',
  version: 1,
  decide({ observation: o }) {
    return {
      policyId: this.id,
      policyVersion: 1,
      observationVersion: 1,
      fallbackReason: null,
      decision: o.legal.check
        ? o.legal.raiseTo.enabled
          ? { kind: 'raiseTo', to: o.legal.raiseTo.min }
          : { kind: 'check' }
        : { kind: 'fold' },
    }
  },
}
const policies = (base = fold) => {
  const make = (): BotPolicy => {
    const table = tablePreflopPolicy(base).policy
    return {
      ...table,
      decide(context) {
        return { ...table.decide(context), policyId: table.id }
      },
    }
  }
  return [make(), make()] as const
}
describe('realisation collection', () => {
  it('records both positions and later folds with blind-inclusive chip origin', () => {
    const pair = policies()
    const hands = Array.from({ length: 16 }, (_, i) => recordCalibrationHand(options, i, pair))
    expect(hands.some((h) => h.preflopTerminal)).toBe(true)
    expect(hands.some((h) => h.postflopFold)).toBe(true)
    for (const h of hands.filter((h) => h.reachedFlopLeaf)) {
      expect(h.observations).toHaveLength(2)
      const [a, b] = h.observations as [RealisationObservation, RealisationObservation]
      expect(new Set([a.position, b.position])).toEqual(new Set(['ip', 'oop']))
      expect(a.netFromHandStartBb + b.netFromHandStartBb).toBeCloseTo(0, 10)
      for (const o of [a, b]) {
        expect(o.potBb).toBe(2 * o.ownPreflopContributionBb)
        expect(o.spr).toBe((o.effectiveStackBb - o.ownPreflopContributionBb) / o.potBb)
        expect(o.equityVsOpponentRange).toBeGreaterThanOrEqual(0)
        expect(o.equityVsOpponentRange).toBeLessThanOrEqual(1)
      }
      if (h.postflopFold) {
        const loser = required([a, b].find((o) => o.netFromHandStartBb < 0))
        expect(loser.netFromHandStartBb + loser.ownPreflopContributionBb).toBe(0)
      }
    }
    // A 100bb buy-in, including blinds: lose 2.5bb preflop + 3bb postflop.
    expect(handStartNet(9450, 10000, 100)).toBe(-5.5)
    expect(handStartNet(11000, 10000, 100) + 2.5).toBe(12.5)
    // Uncalled chips are already back in finalStack, never counted twice.
    expect(handStartNet(10500, 10000, 100)).toBe(5)
  })
  it('keeps negative continuation returns when a player invests on the flop then folds', () => {
    const laterFold: BotPolicy = {
      ...fold,
      decide(context) {
        const o = context.observation
        const envelope = fold.decide(context)
        return {
          ...envelope,
          decision:
            o.street === 'flop' && o.legal.call.enabled ? { kind: 'call' } : envelope.decision,
        }
      },
    }
    const pair = policies(laterFold)
    const hands = Array.from({ length: 16 }, (_, i) => recordCalibrationHand(options, i, pair))
    const folds = hands.filter((h) => h.postflopFold)
    expect(folds.length).toBeGreaterThan(0)
    for (const h of folds) {
      const loser = required(h.observations.find((o) => o.netFromHandStartBb < 0))
      expect(loser.netFromHandStartBb + loser.ownPreflopContributionBb).toBeLessThan(0)
      expect(
        h.observations.reduce((s, o) => s + o.netFromHandStartBb + o.ownPreflopContributionBb, 0),
      ).toBeCloseTo(loser.potBb)
    }
  })
  it('replays byte-identical shards after interruption and independently of execution order', () => {
    const dir = mkdtempSync(join(process.cwd(), 'out-realisation-test-'))
    try {
      const pair = policies()
      const play = (i: number) => recordCalibrationHand(options, i, pair)
      const a = join(dir, 'a.jsonl'),
        b = join(dir, 'b.jsonl')
      writeCalibrationShard(a, 5, 5, play)
      const expected = readFileSync(a, 'utf8')
      writeFileSync(`${b}.part`, 'interrupted garbage')
      writeCalibrationShard(b, 5, 5, play)
      expect(readFileSync(b, 'utf8')).toBe(expected)
      expect(
        writeCalibrationShard(b, 5, 5, () => {
          throw new Error('must skip')
        }),
      ).toBe(false)
      expect(recordCalibrationHand(options, 8, pair)).toEqual(
        recordCalibrationHand(options, 8, policies()),
      )
      expect(handSeed('x', 1, 4)).not.toBe(handSeed('x', 2, 4))
      const c = join(dir, 'c.jsonl')
      expect(() =>
        writeCalibrationShard(c, 5, 5, (i) => {
          if (i === 7) throw new Error('interrupted')
          return play(i)
        }),
      ).toThrow('interrupted')
      expect(existsSync(c)).toBe(false)
      writeCalibrationShard(c, 5, 5, play)
      expect(readFileSync(c, 'utf8')).toBe(expected)
      writeFileSync(c, 'corrupt')
      expect(() => writeCalibrationShard(c, 5, 5, play)).toThrow('corrupt')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
describe('realisation fitting', () => {
  function synthetic(noisy = false): RealisationObservation[] {
    const truth = structuredClone(DEFAULT_HAND_REALISATION)
    Object.assign(truth.features, { pair: 0.12, suited: 0.15, connected: 0.1, highCard: 0.09 })
    for (const pot of Object.values(truth.pots)) {
      Object.assign(pot.ip, { base: 0.81, equitySlope: 0.41 })
      Object.assign(pot.oop, { base: 0.61, equitySlope: 0.51 })
    }
    const rng = mulberry32(42)
    return Array.from({ length: 1800 }, (_, i) => {
      const handClass = required(HAND_CLASSES[Math.floor(rng() * HAND_CLASSES.length)]).name
      const equity = 0.22 + 0.55 * rng()
      const position = i % 2 ? 'ip' : 'oop'
      const potType = required(
        (['limped', 'single-raised', 'three-bet-plus'] as const)[Math.floor(i / 2) % 3],
      )
      const contribution = potType === 'limped' ? 1 : potType === 'single-raised' ? 2.5 : 9
      const depth = i % 7 ? 100 : 200
      const pot = 2 * contribution
      const prediction =
        equity *
        realisationFactor(handClass, equity, position, potType, (depth - contribution) / pot, truth)
      return {
        schema: 'river-realisation-observation-v1',
        handId: `synthetic-${i}`,
        postflopPolicyId: 'test',
        opponentPolicyId: 'test',
        equityTableHash: 'test',
        nodeId: 'test',
        handClass,
        position,
        potType,
        effectiveStackBb: depth,
        potBb: pot,
        ownPreflopContributionBb: contribution,
        equityVsOpponentRange: equity,
        netFromHandStartBb: pot * (prediction + (noisy ? (rng() - 0.5) * 0.1 : 0)) - contribution,
        weight: 0.5 + rng() * 2,
      }
    })
  }
  it('recovers all 16 coefficients from weighted synthetic returns', () => {
    const fit = fitRealisation(synthetic())
    expect(fit.converged).toBe(true)
    expect(fit.weightedSSE).toBeLessThan(1e-8)
    for (const pot of Object.values(fit.config.pots)) {
      expect(pot.ip.base).toBeCloseTo(0.81, 4)
      expect(pot.ip.equitySlope).toBeCloseTo(0.41, 4)
      expect(pot.oop.base).toBeCloseTo(0.61, 4)
      expect(pot.oop.equitySlope).toBeCloseTo(0.51, 4)
    }
    expect(fit.config.features.pair).toBeCloseTo(0.12, 4)
    expect(fit.config.features.suited).toBeCloseTo(0.15, 4)
    expect(fit.config.features.connected).toBeCloseTo(0.1, 4)
    expect(fit.config.features.highCard).toBeCloseTo(0.09, 4)
  })
  it('reports uncertainty and respects parameter bounds without clipping negative returns', () => {
    const data = synthetic(true)
    required(data[0]).netFromHandStartBb = -40
    const fit = fitRealisation(data)
    expect(fit.parameters.every((p) => p.standardError === null || p.standardError >= 0)).toBe(true)
    expect(fit.parameters.some((p) => p.standardError !== null)).toBe(true)
    expect(fit.config.features.pair).toBeGreaterThanOrEqual(0)
    expect(fit.weightedSSE).toBeGreaterThan(100)
    expect(() => fitRealisation([...data, required(data[0])])).toThrow('duplicate')
    expect(() => fitRealisation([{ ...required(data[0]), weight: 0 }])).toThrow(
      'invalid observation',
    )
    expect(() =>
      fitRealisation([required(data[0]), { ...required(data[1]), opponentPolicyId: 'different' }]),
    ).toThrow('pool')
  })
  it('does not invent standard errors for missing pot-type coverage', () => {
    const fit = fitRealisation(synthetic().filter((o) => o.potType === 'limped'))
    expect(fit.identifiable).toBe(false)
    expect(fit.parameters.every((p) => p.standardError === null)).toBe(true)
  })
})

function required<T>(value: T): NonNullable<T> {
  if (value === null || value === undefined) throw new Error('missing required calibration value')
  return value
}

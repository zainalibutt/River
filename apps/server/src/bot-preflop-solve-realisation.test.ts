import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { bestResponseCertificate } from './bot-preflop-solve-br.js'
import { type DealModel, PreflopTrainer } from './bot-preflop-solve-cfr.js'
import { type makePack, reachedFrequencies } from './bot-preflop-solve-output.js'
import {
  DEFAULT_HAND_REALISATION,
  DEFAULT_REALISATION,
  flopContext,
  type HandRealisation,
  handFeatures,
  type PotType,
  parseRealisation,
  realisationFactor,
} from './bot-preflop-solve-realisation.js'
import { runPreflop } from './bot-preflop-solve-run.js'
import { preflopTree, terminalUtility } from './bot-preflop-solve-tree.js'

const pots: PotType[] = ['limped', 'single-raised', 'three-bet-plus']
const config = DEFAULT_HAND_REALISATION
describe('hand-dependent preflop realisation', () => {
  it('rejects conflicting flags and protects v1 and paths outside the worktree before solving', () => {
    expect(() => runPreflop(['--flat', '--realisation', 'unused.json'])).toThrow(
      'mutually exclusive',
    )
    expect(() => runPreflop(['--oop', '0.8'])).toThrow('require --flat')
    expect(() => runPreflop(['--output-dir', 'apps/server/preflop/v1'])).toThrow(
      'v1 packs are preserved',
    )
    expect(() => runPreflop(['--output-dir', '../outside'])).toThrow('inside the worktree')
    expect(() => runPreflop(['--realisation'])).toThrow('missing --realisation')
  })
  it('is bounded and monotone in equity, with IP >= OOP, for every hand and pot/SPR', () => {
    const ranks = 'AKQJT98765432'
    const hands = [...ranks].flatMap((a, i) =>
      [...ranks].flatMap((b, j) =>
        i > j ? [] : [i === j ? a + b : `${a}${b}s`, ...(i === j ? [] : [`${a}${b}o`])],
      ),
    )
    for (const hand of hands)
      for (const pot of pots)
        for (const spr of [0, 0.5, 2, 20, 100]) {
          let previousIp = 0
          let previousOop = 0
          for (let i = 0; i <= 20; i += 1) {
            const ip = realisationFactor(hand, i / 20, 'ip', pot, spr, config)
            const oop = realisationFactor(hand, i / 20, 'oop', pot, spr, config)
            expect(ip).toBeGreaterThanOrEqual(previousIp)
            expect(oop).toBeGreaterThanOrEqual(previousOop)
            expect(ip).toBeGreaterThanOrEqual(oop)
            expect(oop).toBeGreaterThanOrEqual(config.bounds.min)
            expect(ip).toBeLessThanOrEqual(config.bounds.max)
            if (spr === 0) expect([ip, oop]).toEqual([1, 1])
            previousIp = ip
            previousOop = oop
          }
        }
  }, 60_000)
  it('rewards suitedness/connectivity/pairs and reduces the weak-hand tax at low SPR', () => {
    const r = (hand: string, spr = 20) =>
      realisationFactor(hand, 0.4, 'oop', 'single-raised', spr, config)
    expect(r('76s')).toBeGreaterThan(r('76o'))
    expect(r('76o')).toBeGreaterThan(r('72o'))
    expect(r('77')).toBeGreaterThan(r('72o'))
    expect(r('72o', 1)).toBeGreaterThan(r('72o', 20))
    expect(realisationFactor('72o', 0.4, 'oop', 'limped', 20, config)).toBeGreaterThan(r('72o'))
    expect(handFeatures('A2s', config).connected).toBe(0.5)
    expect(handFeatures('AA', config).connected).toBe(0)
    // Public illustrative ~62% EQR for 72o at 30% equity. Not an exact HU datum.
    expect(realisationFactor('72o', 0.3, 'oop', 'single-raised', 19.5, config)).toBeCloseTo(0.63, 2)
    expect(flopContext([1, 1], 100)).toEqual({ potType: 'limped', spr: 49.5 })
    expect(flopContext([4, 4], 100)).toEqual({ potType: 'single-raised', spr: 12 })
    expect(flopContext([9, 9], 100)).toEqual({ potType: 'three-bet-plus', spr: 91 / 18 })
    expect(terminalUtility({ kind: 'all-in', paid: [100, 100] }, 0, 0.6, config)).toBeCloseTo(
      20,
      12,
    )
    expect(() => terminalUtility({ kind: 'flop', paid: [1, 1] }, 0, 0.6, config)).toThrow(
      'hand and depth',
    )
  })
  it('accepts serialised replacement parameters and rejects invalid or misspelled calibrations', () => {
    expect(parseRealisation(JSON.parse(JSON.stringify(config)))).toEqual(config)
    const replacement: HandRealisation = {
      ...config,
      features: { ...config.features, suited: 0.2 },
    }
    const parsed = parseRealisation(JSON.parse(JSON.stringify(replacement))) as HandRealisation
    expect(realisationFactor('76s', 0.4, 'oop', 'single-raised', 20, parsed)).toBeGreaterThan(
      realisationFactor('76s', 0.4, 'oop', 'single-raised', 20, config),
    )
    for (const value of [
      null,
      [],
      {},
      { ...config, model: 'typo' },
      { ...config, extra: 1 },
      { ...config, bounds: { min: 0, max: 1.5 } },
      { ...config, equity: { floor: 0.8, ceiling: 0.2, power: 1 } },
      { ...config, sprHalfLife: 0 },
      { ...config, features: { ...config.features, suited: -1 } },
      {
        ...config,
        pots: {
          ...config.pots,
          limped: { ip: { base: 0, equitySlope: 0 }, oop: { base: 1, equitySlope: 1 } },
        },
      },
      { ip: Number.NaN, oop: 1 },
      { ip: 0, oop: 1 },
    ])
      expect(() => parseRealisation(value)).toThrow()
    expect(() => realisationFactor('72o', Number.NaN, 'oop', 'limped', 1, config)).toThrow()
    expect(() => realisationFactor('72o', 0.4, 'oop', 'limped', -1, config)).toThrow()
    expect(() => realisationFactor('AAo', 0.4, 'oop', 'limped', 1, config)).toThrow()
  })
  it('a flat-factor mutation materially changes BB folding in a cache-independent regression game', () => {
    const model = JSON.parse(
      readFileSync(new URL('../preflop/v2/mutation-fixture.json', import.meta.url), 'utf8'),
    ) as DealModel
    const tree = preflopTree(100)
    const result = [config, DEFAULT_REALISATION].map((factors) => {
      const trainer = new PreflopTrainer(tree, model, factors)
      trainer.step(1500)
      const policy = trainer.average()
      const certificate = bestResponseCertificate(tree, model, policy, factors)
      expect(certificate.exploitabilityBb).toBeLessThan(0.005)
      return reachedFrequencies(tree, model, policy).get('button/raise-2.5')
        ?.frequencies[0] as number
    })
    expect((result[0] as number) - (result[1] as number)).toBeGreaterThan(0.05)
  })
  it.each([100, 200])(
    'v2 %i bb preserves v1 and materially changes the exported full-game defence',
    (depth) => {
      const pack = JSON.parse(
        readFileSync(new URL(`../preflop/v2/${depth}bb.json`, import.meta.url), 'utf8'),
      ) as ReturnType<typeof makePack>
      const old = JSON.parse(
        readFileSync(new URL(`../preflop/v1/${depth}bb.json`, import.meta.url), 'utf8'),
      ) as ReturnType<typeof makePack>
      expect(pack.version).toBe('river-hu-preflop-v2')
      expect(old.version).toBe('river-hu-preflop-v1')
      expect(pack.metadata.continuation.factors).toEqual(config)
      expect(pack.metadata.solver.targetMet).toBe(true)
      expect(pack.metadata.solver.certificate.exploitabilityBb).toBeLessThan(0.001)
      expect(pack.metadata.representation.comboVsClassBrMaxDifferenceBb).toBeLessThan(1e-8)
      expect(
        (pack.headlines.bbVsOpen2_5?.fold as number) - (old.headlines.bbVsOpen2_5?.fold as number),
      ).toBeGreaterThan(0.1)
    },
  )
})

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { type Card, cardKey, makeDeck, mulberry32, parseCard } from '@river/engine'
import { describe, expect, it } from 'vitest'
import { HAND_CLASSES, scoreSeven } from './bot-preflop-solve-equity.js'
import { DEFAULT_HAND_REALISATION, realisationFactor } from './bot-preflop-solve-realisation.js'
import { loadPreflopPack, preflopClass } from './bot-preflop-tables.js'
import {
  fitRealisation,
  type RealisationObservation,
  realisationError,
} from './bot-realisation-fit.js'
import {
  calibrationTerminals,
  recordSolverFlop,
  sampleCalibrationSpot,
  solverCalibrationRows,
  writeSolverShard,
} from './bot-realisation-solver-calibrate.js'
import {
  compatibleMasses,
  type RangeCombo,
  type RiverSpot,
  solveRiver,
} from './bot-river-solver.js'
import { COMBOS } from './bot-river-value-data.js'

const cards = (text: string) => text.split(' ').map(parseCard)
const held = (text: string, weight: number): RangeCombo => ({
  hole: cards(text) as [Card, Card],
  weight,
})
const spot: RiverSpot = {
  board: cards('Ah Kd 7s'),
  pot: 500,
  stack: 9750,
  ranges: [
    [held('Ac Qc', 0.2), held('8h 8d', 0.8)],
    [held('As Qd', 0.3), held('Kc Qc', 0.7), held('6h 5h', 0.6)],
  ],
  betSizes: [],
  allIn: false,
  maxRaises: 0,
}
const terminal = {
  depth: 100,
  paid: [2.5, 2.5] as const,
  id: 'button/raise-2.5/call',
  stratum: 'open-2.5',
}

/** Independent (holding, opponent, remaining 45 choose 2) numerical oracle. */
function pairEquity(a: RangeCombo, b: RangeCombo) {
  const blocked = new Set([...spot.board, ...a.hole, ...b.hole].map(cardKey))
  if (blocked.size !== 7) return null
  const deck = makeDeck().filter((c) => !blocked.has(cardKey(c)))
  let won = 0,
    count = 0
  for (let i = 0; i < deck.length; i++)
    for (let j = i + 1; j < deck.length; j++) {
      const board = [...spot.board, deck[i] as Card, deck[j] as Card]
      const x = scoreSeven(Int32Array.from([...a.hole, ...board].map(cardKey)))
      const y = scoreSeven(Int32Array.from([...b.hole, ...board].map(cardKey)))
      won += x > y ? 1 : x === y ? 0.5 : 0
      count++
    }
  expect(count).toBe(990)
  return won / count
}

describe('solver realisation calibration', () => {
  it('records compatible-mass CFVs once, pot units, hand-start origin and exact flop equity', () => {
    const solution = solveRiver(spot, 2, undefined, (_node, p, hands, _self, opponent, out) => {
      const mass = compatibleMasses(hands[p], hands[p === 0 ? 1 : 0], opponent)
      // Negative continuation values are legitimate and must survive recording.
      out.set(mass.map((m) => m * spot.pot * (p === 0 ? -0.2 : 1.2)))
    })
    const rows = solverCalibrationRows(solution, terminal, 'tiny', 'test')
    expect(rows).toHaveLength(5)
    for (const row of rows) {
      const p = row.position === 'oop' ? 0 : 1
      const a = spot.ranges[p].find(
        (h) =>
          h.hole
            .map(cardKey)
            .sort((a, b) => a - b)
            .join('-') === row.holdingId,
      ) as RangeCombo
      let mass = 0,
        won = 0
      for (const b of spot.ranges[p === 0 ? 1 : 0]) {
        const e = pairEquity(a, b)
        if (e !== null) {
          mass += b.weight
          won += b.weight * e
        }
      }
      expect(row.equityVsOpponentRange).toBeCloseTo(won / mass, 10)
      expect(row.compatibleMass).toBeCloseTo(mass, 12)
      expect(row.weight).toBe(a.weight)
      expect(row.rootValuePots).toBeCloseTo(p === 0 ? -0.2 : 1.2, 12)
      expect((row.rootCFVChips as number) / mass / 100).toBeCloseTo(p === 0 ? -1 : 6, 12)
      expect(row.netFromHandStartBb).toBeCloseTo(p === 0 ? -3.5 : 3.5, 12)
      expect(row.realisedFraction).toBeCloseTo(
        (row.rootValuePots as number) / row.equityVsOpponentRange,
        12,
      )
      expect(row.spr).toBe(19.5)
    }
    expect(() => fitRealisation(rows)).not.toThrow()
    expect(() => fitRealisation([...rows, rows[0] as RealisationObservation])).toThrow('duplicate')
    expect(() => fitRealisation(rows.map((r) => ({ ...r, rootValuePots: 99 })))).toThrow(
      'units or origin',
    )
  }, 30_000)

  it('reconstructs production table reaches, covers each depth/open size, and separates worker seeds', () => {
    const terminals = [100, 200].flatMap((d) => calibrationTerminals(loadPreflopPack(d)))
    const seen = new Set<string>()
    for (let i = 0; i < 12; i++) {
      const sample = sampleCalibrationSpot(terminals, 'test', 0, i)
      expect(sample).toEqual(sampleCalibrationSpot(terminals, 'test', 0, i))
      expect(sample.spot.board).not.toEqual(
        sampleCalibrationSpot(terminals, 'test', 1, i).spot.board,
      )
      seen.add(`${sample.terminal.depth}:${sample.terminal.stratum}`)
      const first = sample.spot.ranges[0][0] as RangeCombo
      let reach = 1
      for (const { node, indices } of sample.terminal.trace.line)
        if (node.player === 1) {
          // Independently multiply the OOP row for this physical holding's class.
          reach *= sample.terminal.trace.pack.nodes
            .find((n) => n.id === node.id)
            ?.classes.find((c) => c.hand === preflopClass(first.hole))?.frequencies[
            indices[0] as number
          ] as number
        }
      expect(first.weight).toBeCloseTo(reach, 14)
      expect(
        sample.spot.ranges.every((r) =>
          r.every(
            (h) => !h.hole.some((c) => sample.spot.board.some((b) => cardKey(c) === cardKey(b))),
          ),
        ),
      ).toBe(true)
    }
    expect(seen.size).toBe(12)
  }, 30_000)

  it('replays the 40-round per-turn production solve and complete shards deterministically', () => {
    const sample = {
      key: 'tiny-production',
      terminal: { ...terminal } as ReturnType<typeof calibrationTerminals>[number],
      spot,
    }
    const network = () =>
      [new Float64Array(COMBOS).fill(0.4), new Float64Array(COMBOS).fill(0.6)] as const
    const rows = recordSolverFlop(sample, network, 'test-per-turn')
    expect(recordSolverFlop(sample, network, 'test-per-turn')).toEqual(rows)
    expect(
      rows
        .filter((r) => r.position === 'oop')
        .every((r) => Math.abs((r.rootValuePots as number) - 0.4) < 1e-10),
    ).toBe(true)
    const dir = mkdtempSync(join(process.cwd(), 'out-solver-test-'))
    const target = resolve(dir)
    if (!/^out-solver-test-[^\\/]+$/.test(relative(process.cwd(), target)))
      throw new Error('unexpected cleanup target')
    try {
      const a = join(dir, 'a.jsonl'),
        b = join(dir, 'b.jsonl')
      const record = (i: number) => rows.map((r) => ({ ...r, handId: `tiny-${i}` }))
      writeSolverShard(a, 8, 2, record)
      writeFileSync(`${b}.part`, 'interrupted bytes')
      expect(() =>
        writeSolverShard(b, 8, 2, () => {
          throw new Error('interrupted')
        }),
      ).toThrow('interrupted')
      expect(existsSync(b)).toBe(false)
      writeSolverShard(b, 8, 2, record)
      expect(readFileSync(a, 'utf8')).toBe(readFileSync(b, 'utf8'))
      expect(
        writeSolverShard(b, 8, 2, () => {
          throw new Error('must skip')
        }),
      ).toBe(false)
      writeFileSync(b, 'corrupted')
      expect(() => writeSolverShard(b, 8, 2, record)).toThrow('corrupt')
    } finally {
      rmSync(target, { recursive: true, force: true })
    }
  }, 30_000)

  it('recovers known parameters from many holdings sharing independent flop clusters', () => {
    const truth = structuredClone(DEFAULT_HAND_REALISATION)
    Object.assign(truth.features, { pair: 0.12, suited: 0.15, connected: 0.1, highCard: 0.09 })
    for (const p of Object.values(truth.pots)) {
      Object.assign(p.ip, { base: 0.81, equitySlope: 0.41 })
      Object.assign(p.oop, { base: 0.61, equitySlope: 0.51 })
    }
    const rng = mulberry32(53)
    const data: RealisationObservation[] = Array.from({ length: 1800 }, (_, i) => {
      const handClass = (HAND_CLASSES[Math.floor(rng() * 169)] as { name: string }).name
      const e = 0.22 + 0.55 * rng(),
        position = i % 2 ? 'ip' : 'oop'
      const potType = (['limped', 'single-raised', 'three-bet-plus'] as const)[
        Math.floor(i / 30) % 3
      ] as 'limped' | 'single-raised' | 'three-bet-plus'
      const contribution = potType === 'limped' ? 1 : potType === 'single-raised' ? 2.5 : 9
      const depth = i % 7 ? 100 : 200,
        potBb = 2 * contribution
      const value =
        e *
        realisationFactor(handClass, e, position, potType, (depth - contribution) / potBb, truth)
      return {
        schema: 'river-realisation-observation-v1',
        handId: `flop-${Math.floor(i / 30)}`,
        holdingId: `holding-${i}`,
        postflopPolicyId: 'synthetic',
        opponentPolicyId: 'synthetic',
        equityTableHash: 'synthetic',
        nodeId: 'test',
        handClass,
        position,
        potType,
        effectiveStackBb: depth,
        potBb,
        ownPreflopContributionBb: contribution,
        equityVsOpponentRange: e,
        netFromHandStartBb: potBb * value - contribution,
        weight: 0.5 + rng(),
      }
    })
    const fit = fitRealisation(data)
    expect(fit.hands).toBe(60)
    expect(fit.observations).toBe(1800)
    expect(fit.converged).toBe(true)
    for (const p of Object.values(fit.config.pots)) {
      expect(p.ip.base).toBeCloseTo(0.81, 4)
      expect(p.oop.base).toBeCloseTo(0.61, 4)
      expect(p.ip.equitySlope).toBeCloseTo(0.41, 4)
      expect(p.oop.equitySlope).toBeCloseTo(0.51, 4)
    }
    for (const name of ['pair', 'suited', 'connected', 'highCard'] as const)
      expect(fit.config.features[name]).toBeCloseTo(truth.features[name], 4)
    expect(fit.parameters.every((p) => p.standardError !== null)).toBe(true)
    expect(realisationError(data, fit.config).rmsePots).toBeLessThan(1e-6)
    expect(fitRealisation(data)).toEqual(fit)
    const noisy = data.map((o, i) => ({
      ...o,
      netFromHandStartBb: o.netFromHandStartBb + o.potBb * 0.03 * Math.sin(Math.floor(i / 30)),
    }))
    const clustered = fitRealisation(noisy)
    const replicated = fitRealisation(
      noisy.flatMap((o) =>
        ['a', 'b'].map((suffix) => ({
          ...o,
          holdingId: `${o.holdingId}-${suffix}`,
          weight: o.weight / 2,
        })),
      ),
    )
    expect(replicated.hands).toBe(60)
    expect(replicated.observations).toBe(3600)
    expect(clustered.parameters.some((p) => (p.standardError ?? 0) > 0.001)).toBe(true)
    for (let i = 0; i < clustered.parameters.length; i++) {
      expect(replicated.parameters[i]?.standardError).toBeCloseTo(
        clustered.parameters[i]?.standardError as number,
        7,
      )
    }
  })
})

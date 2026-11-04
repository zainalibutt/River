import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { PreflopPack } from './bot-preflop-tables.js'

export const priorDigest = (data: string | Uint8Array) =>
  createHash('sha256').update(data).digest('hex')

export interface OpponentPrior {
  schema: 'river-opponent-preflop-prior-v1'
  packVersion: 'v3'
  alpha: number
  inputs: { file: string; sha256: string }[]
  packs: { depth: number; sha256: string }[]
  diagnostics: {
    hands: number
    countedHands: number
    missingHole: number
    invalidHistory: number
    untranslatedSteps: number
    reconstructedSteps: number
    noObservationHands: number
    opponentSteps: number
    noOpponentDecisionHands: number
  }
  nodes: {
    depth: number
    nodeKey: string
    /** Arrays are indexed by the exported decision node's action index. */
    classes: { hand: string; reach: number; counts: number[]; frequencies: number[] }[]
  }[]
}

/** Node IDs are the exported tree paths used verbatim by tracePreflop. */
export function priorFrequency(
  prior: OpponentPrior | null,
  depth: number,
  nodeKey: string,
  hand: string,
  action: number,
): number | undefined {
  return prior?.nodes
    .find((node) => node.depth === depth && node.nodeKey === nodeKey)
    ?.classes.find((row) => row.hand === hand)?.frequencies[action]
}

export function validateOpponentPrior(
  value: unknown,
  available: readonly PreflopPack[],
): OpponentPrior {
  const prior = value as OpponentPrior
  const bad = () => {
    throw new Error('invalid RIVER_OPPONENT_PREFLOP_PRIOR')
  }
  if (
    prior?.schema !== 'river-opponent-preflop-prior-v1' ||
    prior.packVersion !== 'v3' ||
    !Number.isFinite(prior.alpha) ||
    prior.alpha <= 0 ||
    !Array.isArray(prior.inputs) ||
    !Array.isArray(prior.packs) ||
    !Array.isArray(prior.nodes) ||
    !prior.diagnostics ||
    Array.isArray(prior.diagnostics) ||
    [
      'hands',
      'countedHands',
      'missingHole',
      'invalidHistory',
      'untranslatedSteps',
      'reconstructedSteps',
      'noObservationHands',
      'opponentSteps',
      'noOpponentDecisionHands',
    ].some((key) => !Number.isSafeInteger((prior.diagnostics as Record<string, number>)[key])) ||
    Object.values(prior.diagnostics).some((n) => !Number.isSafeInteger(n) || n < 0)
  )
    return bad()
  for (const input of prior.inputs)
    if (!input || typeof input.file !== 'string' || !/^[a-f0-9]{64}$/.test(input.sha256)) bad()
  const depths = new Set<number>()
  for (const source of prior.packs) {
    const pack = available.find((p) => p.metadata.effectiveStackBb === source?.depth)
    if (!pack || depths.has(source.depth) || priorDigest(JSON.stringify(pack)) !== source.sha256)
      bad()
    depths.add(source.depth)
  }
  const seen = new Set<string>()
  for (const node of prior.nodes) {
    if (!node || !depths.has(node.depth)) return bad()
    const key = `${node.depth}:${node.nodeKey}`
    const table = available
      .find((p) => p.metadata.effectiveStackBb === node.depth)
      ?.nodes.find((n) => n.id === node.nodeKey)
    if (
      !table ||
      seen.has(key) ||
      !Array.isArray(node.classes) ||
      node.classes.length !== table.classes.length
    )
      return bad()
    seen.add(key)
    const hands = new Set<string>()
    for (const row of node.classes) {
      const base = table.classes.find((r) => r.hand === row?.hand)
      if (
        !base ||
        hands.has(row.hand) ||
        !Number.isSafeInteger(row.reach) ||
        row.reach < 0 ||
        !Array.isArray(row.counts) ||
        !Array.isArray(row.frequencies) ||
        row.counts.length !== base.frequencies.length ||
        row.frequencies.length !== base.frequencies.length
      )
        return bad()
      hands.add(row.hand)
      if (Math.abs(row.counts.reduce((sum, n) => sum + n, 0) - row.reach) > 1e-8) bad()
      for (const [k, frequency] of row.frequencies.entries()) {
        const count = row.counts[k] as number
        const expected =
          (count + prior.alpha * (base.frequencies[k] as number)) / (row.reach + prior.alpha)
        if (
          !Number.isFinite(count) ||
          count < 0 ||
          !Number.isFinite(frequency) ||
          frequency < 0 ||
          frequency > 1 ||
          Math.abs(frequency - expected) > 1e-10
        )
          bad()
      }
    }
  }
  return prior
}

const loaded = new Map<string, OpponentPrior>()
/** Called at policy construction, so malformed opt-ins fail before play. */
export function opponentPriorFromEnvironment(
  available: readonly PreflopPack[],
): OpponentPrior | null {
  const file = process.env.RIVER_OPPONENT_PREFLOP_PRIOR
  if (file === undefined) return null
  if (file === '') throw new Error('empty RIVER_OPPONENT_PREFLOP_PRIOR')
  if (process.env.RIVER_PREFLOP_PACK && process.env.RIVER_PREFLOP_PACK !== 'v3')
    throw new Error('RIVER_OPPONENT_PREFLOP_PRIOR requires the v3 pack')
  let prior = loaded.get(file)
  if (!prior) {
    prior = validateOpponentPrior(JSON.parse(readFileSync(file, 'utf8')), available)
    loaded.set(file, prior)
  } else {
    // An injected/custom pack cannot reuse validation against another tree.
    validateOpponentPrior(prior, available)
  }
  return prior
}

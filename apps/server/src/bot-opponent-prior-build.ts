import { readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type BotObservationV1, parseCard } from '@river/engine'
import { type OpponentPrior, priorDigest, validateOpponentPrior } from './bot-opponent-prior.js'
import {
  loadPreflopPack,
  PREFLOP_DEPTHS,
  preflopClass,
  tracePreflop,
} from './bot-preflop-tables.js'
import { type PublicDecision, publicDecisions } from './bot-public-replay.js'
import { observationFor } from './bot-service.js'
import { slumbotMoves, slumbotRoom } from './bot-slumbot.js'

export interface PriorHand {
  action: string
  clientPos: 0 | 1
  slumbotHole: string[] | null
  hole?: string[]
  personality?: string
  aivatDecisions?: { observation: BotObservationV1 }[]
}

/** Reconstruct the final preflop suffix even when our last move ended the hand.
 * Use recorded public views where available, including their identity and action
 * objects: these are part of tracePreflop's off-tree seed. With no observations,
 * bot-slumbot-run's fixed room identity/hand number and personality suffice.
 */
export function opponentPriorHistory(hand: PriorHand) {
  const observations = (hand.aivatDecisions ?? []).map((d) => d.observation)
  const reference = observations.reduce<BotObservationV1 | undefined>(
    (best, at) => (!best || (at.actions?.length ?? 0) > (best.actions?.length ?? 0) ? at : best),
    undefined,
  )
  const ours =
    reference?.actor.playerId ?? (hand.personality ? `bot:${hand.personality}` : undefined)
  if (!ours || (hand.clientPos !== 0 && hand.clientPos !== 1)) throw new Error('missing identity')
  const theirs =
    reference?.seats.find((s) => s.playerId !== null && s.playerId !== ours)?.playerId ??
    'bot:slumbot'
  const room = slumbotRoom(
    {
      action: '',
      clientPos: hand.clientPos,
      hole: hand.hole?.map(parseCard) ?? reference?.actor.hole ?? [],
      board: [],
    },
    { ours, theirs },
  )
  const history: PublicDecision[] = []
  const recorded = reference ? publicDecisions(reference) : null
  let initial: BotObservationV1 | undefined
  const moves = slumbotMoves(hand.action.split('/')[0] ?? '')
  let reconstructed = 0
  for (const move of moves) {
    const actor = room.viewFor('').currentActor?.playerId
    if (!actor) throw new Error('action after terminal')
    const observation = observationFor(
      room.viewFor(actor),
      actor,
      undefined,
      room.id,
      room.currentActions(),
    )
    if (!observation) throw new Error('missing replay observation')
    const at = {
      ...observation,
      roomId: reference?.roomId ?? observation.roomId,
      handNumber: reference?.handNumber ?? observation.handNumber,
    }
    initial ??= at
    const action =
      move.action.kind === 'raiseTo' && move.action.to >= at.actor.stack + at.actor.betStreet
        ? { kind: 'allIn' as const }
        : move.action
    if (!room.submit({ kind: 'act', playerId: actor, action }).ok)
      throw new Error('invalid replay action')
    const taken = room.currentActions()?.at(-1) ?? room.recentHands(1)[0]?.actions.at(-1)
    if (!taken) throw new Error('missing replay action')
    const original = recorded?.[history.length]
    if (original && JSON.stringify(original.taken) !== JSON.stringify(taken))
      throw new Error('observation/ACPC mismatch')
    history.push(original ?? { observation: at, taken })
    if (!original) reconstructed++
  }
  if (!initial) throw new Error('empty preflop')
  return {
    observation: reference ?? initial,
    history,
    ours,
    reconstructed,
    noObservation: !reference,
  }
}

export function buildOpponentPrior(
  inputs: readonly { file: string; content: string }[],
  alpha = 20,
): OpponentPrior {
  if (!Number.isFinite(alpha) || alpha <= 0) throw new Error('alpha must be positive')
  const available = PREFLOP_DEPTHS.map((depth) => loadPreflopPack(depth, 'v3'))
  const prior: OpponentPrior = {
    schema: 'river-opponent-preflop-prior-v1',
    packVersion: 'v3',
    alpha,
    inputs: inputs.map(({ file, content }) => ({
      file: basename(file),
      sha256: priorDigest(content),
    })),
    packs: available.map((pack) => ({
      depth: pack.metadata.effectiveStackBb,
      sha256: priorDigest(JSON.stringify(pack)),
    })),
    diagnostics: {
      hands: 0,
      countedHands: 0,
      missingHole: 0,
      invalidHistory: 0,
      untranslatedSteps: 0,
      reconstructedSteps: 0,
      noObservationHands: 0,
      opponentSteps: 0,
      noOpponentDecisionHands: 0,
    },
    nodes: [],
  }
  for (const input of inputs)
    for (const text of input.content.split(/\r?\n/)) {
      if (!text.trim()) continue
      // Invalid JSON is a corrupt input, not an unreported skipped hand.
      const hand = JSON.parse(text) as PriorHand
      prior.diagnostics.hands++
      if (!Array.isArray(hand.slumbotHole) || hand.slumbotHole.length !== 2) {
        prior.diagnostics.missingHole++
        continue
      }
      let replay: ReturnType<typeof opponentPriorHistory>
      let handClass: string
      try {
        const hole = hand.slumbotHole.map(parseCard)
        if (hand.slumbotHole[0] === hand.slumbotHole[1]) throw new Error('duplicate hole card')
        handClass = preflopClass(hole)
        replay = opponentPriorHistory(hand)
      } catch {
        prior.diagnostics.invalidHistory++
        continue
      }
      prior.diagnostics.reconstructedSteps += replay.reconstructed
      prior.diagnostics.noObservationHands += Number(replay.noObservation)
      let counted = false
      // Prefixes retain any usable earlier evidence if a later abstract sequence
      // is unseen. Translation is exclusively tracePreflop's seeded translation.
      for (let index = 0; index < replay.history.length; index++) {
        const trace = tracePreflop(
          replay.observation,
          replay.history.slice(0, index + 1),
          available,
        )
        if (typeof trace === 'string') {
          prior.diagnostics.untranslatedSteps += replay.history.length - index
          break
        }
        const step = trace.line[index]
        if (!step || trace.players[step.node.player] === replay.ours) continue
        let node = prior.nodes.find(
          (n) => n.depth === trace.selection.depth && n.nodeKey === step.node.id,
        )
        if (!node) {
          const table = trace.pack.nodes.find((n) => n.id === step.node.id)
          if (!table) throw new Error('missing table node')
          node = {
            depth: trace.selection.depth,
            nodeKey: step.node.id,
            classes: table.classes.map((row) => ({
              hand: row.hand,
              reach: 0,
              counts: row.frequencies.map(() => 0),
              frequencies: [...row.frequencies],
            })),
          }
          prior.nodes.push(node)
        }
        const row = node.classes.find((r) => r.hand === handClass)
        const table = trace.pack.nodes
          .find((n) => n.id === step.node.id)
          ?.classes.find((r) => r.hand === handClass)
        if (!row || !table) throw new Error('missing table class')
        row.reach++
        // Aliased live actions represent a union. Split its one observation by
        // table conditional mass (uniform if zero), preserving total reach.
        const mass = step.indices.reduce((sum, k) => sum + (table.frequencies[k] as number), 0)
        for (const k of step.indices)
          row.counts[k] =
            (row.counts[k] as number) +
            (mass > 0 ? (table.frequencies[k] as number) / mass : 1 / step.indices.length)
        row.frequencies = row.counts.map(
          (count, k) => (count + alpha * (table.frequencies[k] as number)) / (row.reach + alpha),
        )
        prior.diagnostics.opponentSteps++
        counted = true
      }
      prior.diagnostics.countedHands += Number(counted)
      if (
        !counted &&
        replay.history.every((entry) => entry.observation.actor.playerId === replay.ours)
      )
        prior.diagnostics.noOpponentDecisionHands++
    }
  prior.nodes.sort((a, b) => a.depth - b.depth || a.nodeKey.localeCompare(b.nodeKey))
  return validateOpponentPrior(prior, available)
}

export function opponentOpenSummary(prior: OpponentPrior) {
  return prior.nodes
    .filter((node) => node.nodeKey === 'button')
    .map((node) => {
      const pack = loadPreflopPack(node.depth, 'v3')
      const tree = pack.metadata.tree
      if (tree.kind !== 'decision') throw new Error('missing button node')
      const k = tree.actions.findIndex((action) => action.label === 'raise-2')
      const reach = node.classes.reduce((sum, row) => sum + row.reach, 0)
      const opens = node.classes.reduce((sum, row) => sum + (row.counts[k] as number), 0)
      // Overall prior/table frequencies use physical-combo weights (6/4/12),
      // while the raw empirical rate uses the observed sample counts.
      const combos = (hand: string) => (hand.length === 2 ? 6 : hand.endsWith('s') ? 4 : 12)
      const average = (empirical: boolean) =>
        node.classes.reduce((sum, row) => {
          const base = pack.nodes
            .find((n) => n.id === node.nodeKey)
            ?.classes.find((r) => r.hand === row.hand)
          return (
            sum +
            combos(row.hand) * ((empirical ? row.frequencies[k] : base?.frequencies[k]) as number)
          )
        }, 0) / 1326
      return {
        depth: node.depth,
        nodeKey: node.nodeKey,
        actionIndex: k,
        reach,
        opens,
        empirical: opens / reach,
        smoothed: average(true),
        table: average(false),
      }
    })
}

export function buildOpponentPriorCli(args: string[]) {
  let out: string | undefined
  let alpha = 20
  const files: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string
    if (arg === '--out') out = args[++i]
    else if (arg === '--alpha') alpha = Number(args[++i])
    else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`)
    else files.push(arg)
  }
  if (!out || files.length === 0)
    throw new Error(
      'usage: tsx bot-opponent-prior-build.ts --out <prior.json> [--alpha 20] <hands.jsonl ...>',
    )
  if (files.some((file) => resolve(file) === resolve(out)))
    throw new Error('output would overwrite input')
  const prior = buildOpponentPrior(
    files.map((file) => ({ file, content: readFileSync(file, 'utf8') })),
    alpha,
  )
  writeFileSync(out, `${JSON.stringify(prior, null, 2)}\n`)
  console.log(
    JSON.stringify(
      { diagnostics: prior.diagnostics, open2bb: opponentOpenSummary(prior) },
      null,
      2,
    ),
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  buildOpponentPriorCli(process.argv.slice(2))

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseCard } from '@river/engine'
import { loadPreflopPack, type PreflopPack, tracePreflop } from './bot-preflop-tables.js'
import type { PublicDecision } from './bot-public-replay.js'
import { observationFor } from './bot-service.js'
import { slumbotMoves, slumbotRoom } from './bot-slumbot.js'

export interface PreflopLog {
  readonly action: string
  readonly clientPos: 0 | 1
}
type Status = 'exact' | 'translated' | 'unsupported'
const counts = () => ({ exact: 0, translated: 0, unsupported: 0, total: 0 })
export function replayPreflopTranslation(log: PreflopLog, available: readonly PreflopPack[]) {
  // The Slumbot adapter creates a fresh room with this public identity per hand.
  // Hole cards do not enter the mapper or its translation seed.
  const room = slumbotRoom(
    { action: '', clientPos: log.clientPos, hole: ['2c', '3d'].map(parseCard), board: [] },
    { ours: 'client', theirs: 'slumbot' },
  )
  const history: PublicDecision[] = []
  const results: { side: 'client' | 'slumbot'; raise: boolean; status: Status; prefix: Status }[] =
    []
  for (const move of slumbotMoves(log.action).filter((m) => m.street === 0)) {
    const id = room.viewFor('').currentActor?.playerId
    if (!id) throw new Error(`missing actor: ${log.action}`)
    const obs = observationFor(room.viewFor(id), id, undefined, room.id, room.currentActions())
    if (!obs) throw new Error('missing observation')
    const before = tracePreflop(obs, history, available)
    const action =
      move.action.kind === 'raiseTo' && move.action.to === 20_000
        ? ({ kind: 'allIn' } as const)
        : move.action
    if (!room.submit({ kind: 'act', playerId: id, action }).ok)
      throw new Error(`illegal preflop action: ${log.action}`)
    const taken = (room.currentActions() ?? room.recentHands(1)[0]?.actions)?.at(-1)
    if (!taken) throw new Error('missing taken action')
    history.push({ observation: obs, taken })
    const after = tracePreflop(obs, history, available)
    results.push({
      side: id === 'client' ? 'client' : 'slumbot',
      raise: move.action.kind === 'raiseTo',
      status:
        typeof after === 'string'
          ? 'unsupported'
          : after.offTree.includes(history.length - 1)
            ? 'translated'
            : 'exact',
      prefix:
        typeof before === 'string'
          ? 'unsupported'
          : before.offTree.length > 0
            ? 'translated'
            : 'exact',
    })
  }
  return results
}

export function auditPreflopLog(text: string) {
  const rows = text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as PreflopLog & { focal: string })
  const versions = Object.fromEntries(
    (['v2', 'v3'] as const).map((version) => {
      const all = counts()
      const slumbot = counts()
      const client = counts()
      const raises = counts()
      const slumbotRaises = counts()
      const clientDecisionPrefixes = counts()
      for (const log of rows)
        for (const entry of replayPreflopTranslation(log, [loadPreflopPack(200, version)])) {
          for (const counter of [
            all,
            entry.side === 'slumbot' ? slumbot : client,
            ...(entry.raise ? [raises] : []),
            ...(entry.raise && entry.side === 'slumbot' ? [slumbotRaises] : []),
          ]) {
            counter[entry.status]++
            counter.total++
          }
          if (entry.side === 'client') {
            clientDecisionPrefixes[entry.prefix]++
            clientDecisionPrefixes.total++
          }
        }
      return [version, { all, slumbot, client, raises, slumbotRaises, clientDecisionPrefixes }]
    }),
  )
  const slumbotSizes: Record<string, number> = {}
  for (const log of rows) {
    let actor = 1
    let raises = 0
    let previous = 1
    for (const move of slumbotMoves(log.action).filter((m) => m.street === 0)) {
      if (move.action.kind === 'raiseTo') {
        raises++
        const to = move.action.to / 100
        if (actor !== log.clientPos) {
          const stage = raises === 1 ? (actor === 1 ? 'open' : 'isolation') : `${raises + 1}-bet`
          const key = `${stage}: ${to} bb vs ${previous} bb`
          slumbotSizes[key] = (slumbotSizes[key] ?? 0) + 1
        }
        previous = to
      }
      actor = 1 - actor
    }
  }
  return {
    hands: rows.length,
    focals: [...new Set(rows.map((row) => row.focal))],
    versions,
    slumbotSizes,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const files = process.argv.slice(2)
  if (files.length === 0) throw new Error('provide completed Slumbot JSONL log paths')
  process.stdout.write(
    `${JSON.stringify(
      {
        note: 'Historical replay at 200 bb through tracePreflop and live legal actions. Exact is local to the translated prefix; unsupported includes subsequent actions after an abstraction terminal. Prefix counters classify each client decision by all preceding actions. No policy decisions or postflop solves.',
        files: files.map((file) => {
          const source = readFileSync(file, 'utf8')
          return {
            file: basename(file),
            sha256: createHash('sha256').update(source).digest('hex'),
            ...auditPreflopLog(source),
          }
        }),
      },
      null,
      2,
    )}\n`,
  )
}

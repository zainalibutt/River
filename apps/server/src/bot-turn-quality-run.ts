import { appendFileSync, readFileSync } from 'node:fs'
import { prepare, type RiverSpot, solveRiver } from './bot-river-solver.js'
import { RIVER_DATA_SETTINGS, sampleTurnEndSpot } from './bot-river-value-data.js'
import { TURN_POLICY_TUNING } from './bot-turn-policy.js'
import { actionValues, decisionLoss, riverAveragedShowdown } from './bot-turn-quality.js'
import { solveTurn } from './bot-turn-solver.js'
import { loadValueNetwork } from './bot-value-network.js'

// Usage: tsx bot-turn-quality-run.ts <out.jsonl> <spots> <worker> <workers> <run seed>
//          <reference rounds> <candidate rounds> <river network> <name=turn-end network> [...]
//
// The offline decision check (bot-turn-quality.ts) over random turn spots with
// v9a's bet menu, each spot `<run seed>:<index>`, every workers-th from worker.
// Each spot is solved as the reference, its closed betting valued by the river
// network averaged over the river cards, and once per candidate turn-end
// network. The first decision and the second player's decision after each first
// move are scored against the reference, and the spot's total weighs each second
// decision by how often the reference's first player makes the move before it.
// One JSON line per spot; a spot already in the file is skipped.
const [
  out,
  spotsText,
  workerText,
  workersText,
  runSeed,
  referenceText,
  candidateText,
  riverStem,
  ...named
] = process.argv.slice(2)
const spots = Number(spotsText)
const worker = Number(workerText)
const workers = Number(workersText)
const referenceRounds = Number(referenceText)
const candidateRounds = Number(candidateText)
const candidates = named.map((entry) => {
  const [name, stem] = entry.split('=')
  if (!name || !stem) throw new Error(`a candidate is name=network: ${entry}`)
  return { name, network: loadValueNetwork(stem) }
})
if (
  !out ||
  !runSeed ||
  !riverStem ||
  candidates.length === 0 ||
  ![spots, worker, workers, referenceRounds, candidateRounds].every(Number.isSafeInteger) ||
  worker < 0 ||
  worker >= workers
) {
  throw new Error(
    'usage: <out.jsonl> <spots> <worker> <workers> <run seed> <reference rounds> <candidate rounds> <river network> <name=turn-end network> [...]',
  )
}
const river = loadValueNetwork(riverStem)
const done = new Set<number>()
try {
  for (const line of readFileSync(out, 'utf8').split('\n')) {
    if (line.trim() !== '') done.add((JSON.parse(line) as { spot: number }).spot)
  }
} catch {
  // A new file.
}
for (let index = worker; index < spots; index += workers) {
  if (done.has(index)) continue
  const started = Date.now()
  const spot: RiverSpot = {
    ...sampleTurnEndSpot(`${runSeed}:${index}`, RIVER_DATA_SETTINGS),
    betSizes: TURN_POLICY_TUNING.betSizes,
    allIn: true,
    maxRaises: TURN_POLICY_TUNING.maxRaises,
  }
  const hands = [prepare(spot.ranges[0], spot.board), prepare(spot.ranges[1], spot.board)] as const
  const reference = solveRiver(spot, referenceRounds, undefined, riverAveragedShowdown(spot, river))
  const solved = candidates.map(({ name, network }) => ({
    name,
    solution: solveTurn(spot, candidateRounds, network),
  }))
  const scoring = riverAveragedShowdown(spot, river)
  const root = reference.tree
  if (root.kind !== 'action') continue
  const first = reference.strategy.get(root.history) as Float64Array
  const width = root.actions.length
  const total = hands[root.player].weights.reduce((sum, weight) => sum + weight, 0)
  const decisions = [
    { history: root.history, reached: 1 },
    ...root.children.flatMap((child, action) =>
      child.kind === 'action'
        ? [
            {
              history: child.history,
              reached:
                hands[root.player].weights.reduce(
                  (sum, weight, h) => sum + weight * (first[h * width + action] as number),
                  0,
                ) / total,
            },
          ]
        : [],
    ),
  ]
  const nodes = decisions.flatMap(({ history, reached }) => {
    const at = actionValues(reference, hands, scoring, history)
    if (at === undefined) return []
    return [
      {
        history,
        player: at.player,
        reached,
        reference: decisionLoss(at, reference.strategy.get(history) as Float64Array),
        candidates: Object.fromEntries(
          solved.map(({ name, solution }) => [
            name,
            decisionLoss(at, solution.strategy.get(history) as Float64Array),
          ]),
        ),
      },
    ]
  })
  appendFileSync(
    out,
    `${JSON.stringify({ spot: index, stackToPot: spot.stack / spot.pot, ms: Date.now() - started, nodes })}\n`,
  )
}

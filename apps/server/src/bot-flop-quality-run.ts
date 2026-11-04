import { appendFileSync, readFileSync } from 'node:fs'
import { teacherShowdown, turnSolvedTeacher } from './bot-flop-quality.js'
import { solveFlop } from './bot-flop-solver.js'
import { prepare, type RiverSpot } from './bot-river-solver.js'
import { RIVER_DATA_SETTINGS, sampleFlopEndSpot } from './bot-river-value-data.js'
import { TURN_POLICY_TUNING } from './bot-turn-policy.js'
import { actionValues, decisionLoss } from './bot-turn-quality.js'
import { loadValueNetwork } from './bot-value-network.js'

// Usage: tsx bot-flop-quality-run.ts <out.jsonl> <spots> <worker> <workers> <run seed>
//          <turn-end network> <turn cards> <reference flop network> <name=flop network> [...]
//
// The flop decision check (bot-flop-quality.ts) over random flop spots with the
// live bet menu, each spot `<run seed>:<index>`, every workers-th from worker.
// Each spot is solved with the reference flop network; its closed betting is
// valued once by the teacher (the turn solved over `turn cards` turn cards,
// 0 for all), and each candidate network's solve is scored against those values
// at the first decision and at the second player's decision after each first
// move, as the turn check scores the turn. One JSON line per spot; a spot
// already in the file is skipped.
const [
  out,
  spotsText,
  workerText,
  workersText,
  runSeed,
  turnStem,
  turnCardsText,
  referenceStem,
  ...named
] = process.argv.slice(2)
const spots = Number(spotsText)
const worker = Number(workerText)
const workers = Number(workersText)
const turnCards = Number(turnCardsText)
const candidates = named.map((entry) => {
  const [name, stem] = entry.split('=')
  if (!name || !stem) throw new Error(`a candidate is name=network: ${entry}`)
  return { name, network: loadValueNetwork(stem) }
})
if (
  !out ||
  !runSeed ||
  !turnStem ||
  !referenceStem ||
  candidates.length === 0 ||
  ![spots, worker, workers, turnCards].every(Number.isSafeInteger) ||
  worker < 0 ||
  worker >= workers
) {
  throw new Error(
    'usage: <out.jsonl> <spots> <worker> <workers> <run seed> <turn-end network> <turn cards> <reference flop network> <name=flop network> [...]',
  )
}
const turnNetwork = loadValueNetwork(turnStem)
const reference = loadValueNetwork(referenceStem)
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
  const seed = `${runSeed}:${index}`
  const spot: RiverSpot = {
    ...sampleFlopEndSpot(seed, RIVER_DATA_SETTINGS),
    betSizes: TURN_POLICY_TUNING.betSizes,
    allIn: true,
    maxRaises: TURN_POLICY_TUNING.maxRaises,
  }
  const hands = [prepare(spot.ranges[0], spot.board), prepare(spot.ranges[1], spot.board)] as const
  const solved = solveFlop(spot, TURN_POLICY_TUNING.iterations, reference)
  const scoring = teacherShowdown(
    solved,
    hands,
    turnSolvedTeacher(turnNetwork, turnCards, seed),
    reference,
  )
  const others = candidates.map(({ name, network }) => ({
    name,
    solution: solveFlop(spot, TURN_POLICY_TUNING.iterations, network),
  }))
  const root = solved.tree
  if (root.kind !== 'action') continue
  const first = solved.strategy.get(root.history) as Float64Array
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
    const at = actionValues(solved, hands, scoring, history)
    if (at === undefined) return []
    return [
      {
        history,
        player: at.player,
        reached,
        reference: decisionLoss(at, solved.strategy.get(history) as Float64Array),
        candidates: Object.fromEntries(
          others.map(({ name, solution }) => [
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

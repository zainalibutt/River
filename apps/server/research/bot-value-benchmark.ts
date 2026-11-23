import { type Card, cardKey, makeDeck, parseCard } from '@river/engine'
import { perTurnShowdown } from '../src/bot-flop-turn-leaves.js'
import {
  type RangeCombo,
  type RiverNode,
  type RiverSpot,
  solveRiver,
} from '../src/bot-river-solver.js'
import { perRiverShowdown } from '../src/bot-turn-river-leaves.js'
import { loadValueNetwork } from '../src/bot-value-network.js'
import {
  closeValueNetworkWorkers,
  valueNetworkBackend,
  valueNetworkThreads,
} from '../src/bot-value-simd.js'

// Reusable bounded CLI (set RIVER_VALUE_BACKEND=ts or wasm before each process):
// cmd /c npx tsx apps/server/research/bot-value-benchmark.ts turn <model-stem> 100
// cmd /c npx tsx apps/server/research/bot-value-benchmark.ts flop <model-stem> 25
const [street, stem, count, scheme = 'cfr+'] = process.argv.slice(2)
const iterations = Number(count)
if (
  (street !== 'turn' && street !== 'flop') ||
  !stem ||
  !Number.isSafeInteger(iterations) ||
  iterations < 1 ||
  (scheme !== 'cfr+' && scheme !== 'dcfr')
) {
  throw new Error('usage: bot-value-benchmark.ts turn|flop <model-stem> <iterations> [cfr+|dcfr]')
}
const board = (street === 'turn' ? 'Ah Kd 7s 4c' : 'Ah Kd 7s').split(' ').map(parseCard)
const blocked = new Set(board.map(cardKey))
const deck = makeDeck().filter((card) => !blocked.has(cardKey(card)))
const range: RangeCombo[] = []
for (let a = 0; a < deck.length; a += 1) {
  for (let b = a + 1; b < deck.length; b += 1) {
    range.push({ hole: [deck[a] as Card, deck[b] as Card], weight: 1 })
  }
}
const spot: RiverSpot = {
  board,
  pot: 100,
  stack: 400,
  ranges: [range, range],
  betSizes: [0.66],
  maxRaises: 1,
  allIn: true,
}
const network = loadValueNetwork(stem)
const backend = valueNetworkBackend(network)
const start = performance.now()
const leaves = street === 'turn' ? perRiverShowdown(spot, network) : perTurnShowdown(spot, network)
const ready = performance.now()
const solution = solveRiver(spot, iterations, undefined, leaves, undefined, undefined, { scheme })
const done = performance.now()
let actions = 0
let showdowns = 0
const countTree = (node: RiverNode) => {
  if (node.kind === 'action') {
    actions += 1
    node.children.forEach(countTree)
  } else if (node.kind === 'showdown') showdowns += 1
}
countTree(solution.tree)
console.log(
  JSON.stringify({
    node: process.version,
    street,
    backend,
    threads: valueNetworkThreads(network),
    requestedThreads: process.env.RIVER_VALUE_THREADS ?? '1',
    scheme,
    stem,
    iterations,
    holdings: range.length,
    pot: spot.pot,
    stack: spot.stack,
    betSizes: spot.betSizes,
    maxRaises: spot.maxRaises,
    allIn: spot.allIn,
    actions,
    showdowns,
    preparationSeconds: (ready - start) / 1000,
    solveSeconds: (done - ready) / 1000,
    totalSeconds: (done - start) / 1000,
    rssMiB: process.memoryUsage().rss / 1048576,
  }),
)
closeValueNetworkWorkers(network)

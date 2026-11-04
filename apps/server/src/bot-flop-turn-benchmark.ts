import { type Card, mulberry32, parseCard } from '@river/engine'
import { flopShowdown } from './bot-flop-solver.js'
import { createTurnPromiseRecord, perTurnShowdown } from './bot-flop-turn-leaves.js'
import { type RiverNode, type RiverSpot, solveRiver } from './bot-river-solver.js'
import type { RiverValueNetwork } from './bot-value-network.js'

// Bounded manual timing: cmd /c npx tsx apps/server/src/bot-flop-turn-benchmark.ts
const cards = (s: string) => s.split(' ').map(parseCard)
const held = (s: string, weight = 1) => ({ hole: cards(s) as [Card, Card], weight })
const spot: RiverSpot = {
  board: cards('Ah Kd 7s'),
  pot: 100,
  stack: 400,
  ranges: [
    [held('8s 8h'), held('Qc Jc', 2), held('5d 6d'), held('As 2s')],
    [held('7c 7d'), held('Kc Qh', 3), held('8c 9c'), held('Th Jh')],
  ],
  betSizes: [0.66],
  maxRaises: 1,
  allIn: true,
}
const rng = mulberry32(8173)
const network: RiverValueNetwork = {
  buckets: 128,
  layers: [385, 512, 512, 512].map((columns, i) => {
    const rows = i === 3 ? 256 : 512
    return {
      columns,
      rows,
      weight: Float32Array.from(
        { length: rows * columns },
        () => (rng() - 0.5) / Math.sqrt(columns),
      ),
      bias: Float32Array.from({ length: rows }, () => rng() - 0.5),
      slope: i === 3 ? null : 0.2,
    }
  }),
}
const iterations = 10
for (const kind of ['flop-end', 'turn-start'] as const) {
  const record = createTurnPromiseRecord()
  const start = performance.now()
  const leaves =
    kind === 'flop-end' ? flopShowdown(spot, network) : perTurnShowdown(spot, network, record)
  const ready = performance.now()
  const solution = solveRiver(spot, iterations, undefined, leaves)
  const done = performance.now()
  let actions = 0
  let closed = 0
  const count = (node: RiverNode) => {
    if (node.kind === 'action') {
      actions += 1
      node.children.forEach(count)
    } else if (node.kind === 'showdown') closed += 1
  }
  count(solution.tree)
  console.log(
    JSON.stringify({
      kind,
      iterations,
      actions,
      closed,
      recorded: record.leaves.size,
      preparationMs: ready - start,
      solveMs: done - ready,
      totalMs: done - start,
    }),
  )
}

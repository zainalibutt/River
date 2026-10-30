import { readFileSync } from 'node:fs'
import { type Card, cardKey, handScore, makeDeck, parseCard } from '@river/engine'
import { describe, expect, it } from 'vitest'
import { flopRunouts, solveFlop } from './bot-flop-solver.js'
import { prepare, type RangeCombo, type RiverSpot } from './bot-river-solver.js'
import { runoutShowdownTable } from './bot-turn-solver.js'
import { type ValueNetworkDescription, valueNetworkFrom } from './bot-value-network.js'

const cards = (text: string) => text.split(' ').map(parseCard)
const combo = (text: string, weight = 1): RangeCombo => ({
  hole: cards(text) as [Card, Card],
  weight,
})
const fixture = JSON.parse(
  readFileSync(new URL('../models/river-value-parity.fixture.json', import.meta.url), 'utf8'),
) as ValueNetworkDescription & { weights: number[] }
const network = valueNetworkFrom(fixture, Float32Array.from(fixture.weights))
const flop: RiverSpot = {
  board: cards('Ah Kd 7s'),
  pot: 100,
  stack: 400,
  ranges: [
    [combo('8s 8h'), combo('Qc Jc', 2), combo('5d 6d'), combo('As 2s')],
    [combo('7c 7d'), combo('Kc Qh', 3), combo('8c 9c'), combo('Th Jh')],
  ],
  betSizes: [0.66],
  allIn: true,
  maxRaises: 1,
}

describe('flop runouts', () => {
  it('are the same for the same flop and never repeat a pair', () => {
    const first = flopRunouts(flop.board, 40)
    const again = flopRunouts(flop.board, 40)
    expect(first).toHaveLength(40)
    expect(first.map((runout) => [...runout.ranks].join())).toEqual(
      again.map((runout) => [...runout.ranks].join()),
    )
    expect(new Set(first.map((runout) => [...runout.ranks].join())).size).toBe(40)
  })

  it('settle an all-in as the exact showdown when every runout is used', () => {
    const hands = [
      prepare(flop.ranges[0], flop.board),
      prepare(flop.ranges[1], flop.board),
    ] as const
    const runouts = flopRunouts(flop.board, 1176)
    expect(runouts).toHaveLength(1176)
    const table = runoutShowdownTable(runouts, hands)
    // Brute force: Qc Jc against Kc Qh over every turn and river they both leave.
    const blocked = new Set([...flop.board, ...cards('Qc Jc Kc Qh')].map(cardKey))
    const live = makeDeck().filter((card) => !blocked.has(cardKey(card)))
    let won = 0
    let seen = 0
    for (let a = 0; a < live.length; a += 1) {
      for (let b = a + 1; b < live.length; b += 1) {
        const board = [...flop.board, live[a] as Card, live[b] as Card]
        const mine = handScore([...cards('Qc Jc'), ...board])
        const theirs = handScore([...cards('Kc Qh'), ...board])
        won += mine > theirs ? 1 : mine === theirs ? 0.5 : 0
        seen += 1
      }
    }
    const qj = hands[0].combos.findIndex(
      (entry) => entry.hole.map(cardKey).join() === cards('Qc Jc').map(cardKey).join(),
    )
    const kq = hands[1].combos.findIndex(
      (entry) => entry.hole.map(cardKey).join() === cards('Kc Qh').map(cardKey).join(),
    )
    const opponent = new Float64Array(hands[1].combos.length)
    opponent[kq] = 1
    const out = table.won(0, opponent, new Float64Array(hands[0].combos.length))
    expect(out[qj]).toBeCloseTo(won / seen, 5)
  }, 30_000)
})

describe('a flop solved with a network valuing the turn', () => {
  it('gives every holding a strategy, and the same one each time', () => {
    const first = solveFlop(flop, 30, network)
    const again = solveFlop(flop, 30, network, undefined, 60)
    expect(first.strategy.size).toBeGreaterThan(1)
    for (const [history, table] of first.strategy) {
      expect([...(again.strategy.get(history) ?? [])]).toEqual([...table])
      expect(Buffer.from((again.strategy.get(history) as Float64Array).buffer)).toEqual(
        Buffer.from(table.buffer),
      )
      const width = table.length / 4
      for (let h = 0; h < 4; h += 1) {
        let sum = 0
        for (let a = 0; a < width; a += 1) sum += table[h * width + a] as number
        expect(sum).toBeCloseTo(1, 9)
      }
    }
  })

  it('refuses a board that is not a flop', () => {
    expect(() => solveFlop({ ...flop, board: cards('Ah Kd 7s 4c') }, 10, network)).toThrow(
      /three-card board/,
    )
  })
})

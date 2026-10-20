import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { cardKey, parseCard } from '@river/engine'
import { expect, it } from 'vitest'
import { COMBOS, encodeRiverRecord } from './bot-river-value-data.js'
import { expectedStrengthRanks, turnRivers } from './bot-turn-end-data.js'

it('validates cache hashes on restart and rejects incomplete source records', () => {
  // Mutation killed: omit the output hash check when deciding to skip a shard.
  const root = join(process.cwd(), 'art', 'out')
  mkdirSync(root, { recursive: true })
  const directory = mkdtempSync(join(root, 'd3-cache-test-'))
  if (!directory.startsWith(`${root}${sep}`)) throw new Error('unexpected test directory')
  try {
    const board = ['As', '8s', '4h'].map(parseCard)
    const ranks = expectedStrengthRanks(turnRivers(board))
    const raw = encodeRiverRecord({
      board: [...board.map(cardKey), 255, 255],
      pot: 100,
      stack: 200,
      spot: 0,
      worker: 0,
      iterations: 0,
      exploitability: 0,
      solveMs: 0,
      ranges: [new Float32Array(COMBOS), new Float32Array(COMBOS)],
      values: [new Float32Array(COMBOS), new Float32Array(COMBOS)],
      strengthRank: ranks,
    })
    writeFileSync(
      join(directory, 'manifest.json'),
      JSON.stringify({ kind: 'flop-end', d3Snapshot: 1 }),
    )
    const source = join(directory, 'flopend-w00-00000.bin')
    const side = source.replace(/\.bin$/, '.flop-buckets-v1-32x4')
    writeFileSync(source, raw)
    const run = () =>
      execFileSync(
        process.execPath,
        ['--import', 'tsx', 'apps/server/src/bot-flop-buckets-run.ts', directory],
        { stdio: 'pipe' },
      )
    run()
    const expected = readFileSync(side)
    expect(expected.length).toBe(COMBOS)
    expect(run().length).toBe(0)
    const corrupt = Buffer.from(expected)
    corrupt[0] = (corrupt[0] as number) === 255 ? 0 : 255
    writeFileSync(side, corrupt)
    run()
    expect(readFileSync(side)).toEqual(expected)
    writeFileSync(source, raw.subarray(0, raw.length - 1))
    expect(() => run()).toThrow('incomplete shard')
  } finally {
    rmSync(directory, { recursive: true })
  }
}, 15000)

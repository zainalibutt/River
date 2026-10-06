import { personalityPool } from '@river/engine'
import { pokerStrongCandidatePolicy } from './bot-poker-strong.js'
import { collectRiverDecisionCorpus } from './bot-river-corpus.js'

const pool = personalityPool()
const cases = [
  { name: 'heads-up', cast: [9, 4] },
  { name: 'mixed-nine', cast: [9, 0, 1, 4, 5, 6, 10, 11, 2] },
  { name: 'tough-nine', cast: [9, 10, 11, 12, 4, 5, 6, 7, 8] },
] as const

const reports = cases.map(({ name, cast }) => {
  const seats = cast.map((index) => {
    const personality = pool[index]
    if (personality === undefined) throw new Error('corpus audit cast missing')
    return { personality, policy: pokerStrongCandidatePolicy }
  })
  const rows = collectRiverDecisionCorpus({
    seed: `river-corpus-${name}`,
    hands: 800,
    seats,
  })
  return {
    table: name,
    hands: 800,
    headsUpRiverFacing: rows.length,
    revealedCalls: rows.filter((row) => row.labelStatus === 'revealed_call').length,
    unrevealedCalls: rows.filter((row) => row.labelStatus === 'unrevealed_call').length,
    unlabelledNonCalls: rows.filter((row) => row.labelStatus === 'not_called').length,
    calledPotShares: rows
      .filter((row) => row.labelStatus === 'revealed_call')
      .map((row) => row.callPotShare),
  }
})

process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`)

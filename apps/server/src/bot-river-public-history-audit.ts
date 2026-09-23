import { personalityPool } from '@river/engine'
import { collectBenchmarkRiverPublicHistory } from './bot-river-public-history.js'
import { botPlayerId } from './bot-service.js'

const pool = personalityPool()
const first = pool[0]
const expert = pool[9]
if (first === undefined || expert === undefined) throw new Error('audit cast missing')
const hands = 300
const casts = [
  { name: 'heads-up', personalities: [first, expert] },
  { name: 'nine-seat', personalities: pool.slice(0, 9) },
] as const

const reports = casts.map(({ name, personalities }) => {
  const collector = collectBenchmarkRiverPublicHistory({
    seed: `river-public-history-${name}`,
    hands,
    seats: personalities.map((personality) => ({ personality })),
  })
  const players = personalities.map((personality) => {
    const history = collector.historyBefore(botPlayerId(personality.id), hands)
    return {
      playerId: personality.id,
      opportunities: history.opportunities,
      bets: history.bets,
      publiclyRevealedBets: history.revealedBetCategories?.length ?? 0,
    }
  })
  return {
    table: name,
    hands,
    totalOpportunities: players.reduce((sum, player) => sum + player.opportunities, 0),
    totalBets: players.reduce((sum, player) => sum + player.bets, 0),
    totalRevealedBets: players.reduce((sum, player) => sum + player.publiclyRevealedBets, 0),
    players,
  }
})

process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`)

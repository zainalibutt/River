import { personalityPool } from '@river/engine'
import { runBotBenchmark } from './bot-benchmark.js'
import { pokerGuardPolicy } from './bot-poker-guard.js'
import { pokerStrongCandidatePolicy } from './bot-poker-strong.js'
import { botPlayerId } from './bot-service.js'

const pool = personalityPool()
const cast = [9, 0, 1, 4, 5, 6, 10, 11]
const seats = cast.map((index, entrant) => {
  const personality = pool[index]
  if (personality === undefined) throw new Error('all-in audit cast missing')
  return { personality, policy: entrant === 0 ? pokerStrongCandidatePolicy : pokerGuardPolicy }
})
const focal = seats[0]?.personality.id
if (focal === undefined) throw new Error('all-in audit focal bot missing')
const allIns: { hole: string; stackToPot: number; amountToCall: number; stack: number }[] = []
runBotBenchmark({
  seed: 'strong-preflop-allin-audit',
  hands: 1_200,
  seats,
  onDecision({ observation, action, actorId }) {
    if (actorId !== botPlayerId(focal) || observation.street !== 'preflop') return
    if (action.kind !== 'allIn') return
    allIns.push({
      hole: observation.actor.hole.map((card) => `${card.rank}${card.suit}`).join(''),
      stackToPot: observation.actor.stack / Math.max(1, observation.pot),
      amountToCall: observation.amountToCall,
      stack: observation.actor.stack,
    })
  },
})
process.stdout.write(
  `${JSON.stringify(
    {
      count: allIns.length,
      deepStackCount: allIns.filter((entry) => entry.stackToPot > 3).length,
      samples: allIns.slice(0, 20),
    },
    null,
    2,
  )}\n`,
)

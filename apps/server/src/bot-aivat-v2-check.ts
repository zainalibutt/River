import { writeFileSync } from 'node:fs'
import { type Card, parseCard } from '@river/engine'
import { type AivatRangeState, aivatCorrection } from './bot-aivat.js'
import { enumerableAivatToy } from './bot-aivat-toy.js'
import { frozenNetworkHeuristic } from './bot-aivat-v2.js'
import { observationFor } from './bot-service.js'
import { slumbotRoom } from './bot-slumbot.js'

// Bounded export/inference smoke, not a strength or Slumbot precision estimate.
const [root, out] = process.argv.slice(2)
if (!root || !out) throw new Error('usage: <model-root> <out.json>')
const heuristic = frozenNetworkHeuristic(root)
const pair = (text: string) => text.split(' ').map(parseCard) as [Card, Card]
const state: AivatRangeState = {
  actorPlayer: 0,
  ranges: [
    [
      { hole: pair('As Ah'), weight: 1 },
      { hole: pair('4c 5c'), weight: 1 },
    ],
    [
      { hole: pair('Ks Kh'), weight: 1 },
      { hole: pair('4d 5d'), weight: 1 },
    ],
  ],
}
const rows = (['flop', 'turn', 'river'] as const).map((street, index) => {
  const room = slumbotRoom(
    {
      action: ['ck/', 'ck/kk/', 'ck/kk/kk/'][index] as string,
      clientPos: 0,
      hole: pair('As Ah'),
      board: '2c 3d 7h 9s Jc'
        .split(' ')
        .slice(0, index + 3)
        .map(parseCard),
    },
    { ours: 'bot:hero', theirs: 'bot:other' },
  )
  const observation = observationFor(room.viewFor('bot:hero'), 'bot:hero')
  if (!observation) throw new Error('missing smoke observation')
  const actions = [{ kind: 'check' }, { kind: 'raiseTo', to: 100 }, { kind: 'allIn' }] as const
  const choices = actions.map((action, index) => ({
    action: String(index),
    probability: [0.2, 0.3, 0.5][index] as number,
    value: heuristic.value(observation, action, state),
  }))
  const meanCorrection = choices.reduce(
    (sum, choice) =>
      sum + choice.probability * aivatCorrection({ kind: 'action', choices, taken: choice.action }),
    0,
  )
  const toy = enumerableAivatToy((hero, action) =>
    heuristic.value(
      {
        ...observation,
        actor: { ...observation.actor, hole: pair(['4c 5c', 'Ks Kh', 'As Ah'][hero] ?? 'As Ah') },
      },
      action === 'check' ? { kind: 'check' } : { kind: 'raiseTo', to: 100 },
      state,
    ),
  )
  if (Math.abs(meanCorrection) > 1e-10 || Math.abs(toy.bias) > 1e-12)
    throw new Error('network smoke centering failed')
  return { street, choices, meanCorrection, toy }
})
writeFileSync(
  out,
  `${JSON.stringify(
    {
      heuristic: heuristic.id,
      specificationSha256: heuristic.specificationSha256,
      qualification:
        'synthetic-public-state-export-smoke-only; fixture ranges, no strength evidence',
      rows,
    },
    null,
    2,
  )}\n`,
)
process.stdout.write(`${JSON.stringify({ out, streets: rows.length, passed: true })}\n`)

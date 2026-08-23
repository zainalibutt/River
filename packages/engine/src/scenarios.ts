import type { BotSkill } from './bots.js'
import type { Card } from './cards.js'
import { parseCard } from './cards.js'
import { STAKE_250_500 } from './config.js'
import type { SessionSeatDef } from './session.js'
import { SoloSession } from './session.js'

const FIXED_SEED = 'river-scenarios'

export function deckOf(text: string): Card[] {
  return text.split(' ').map((token) => parseCard(token))
}

export function huSeats(botSkill: BotSkill): SessionSeatDef[] {
  return [
    { id: 'you', name: 'You', botSkill: null },
    { id: 'p2', name: label(botSkill), botSkill },
  ]
}

export function nineSeats(botSkill: BotSkill): SessionSeatDef[] {
  const base = label(botSkill)
  return [
    { id: 'you', name: 'You', botSkill: null },
    { id: 'p2', name: base, botSkill },
    { id: 'p3', name: `${base} 2`, botSkill },
    { id: 'p4', name: `${base} 3`, botSkill },
    { id: 'p5', name: `${base} 4`, botSkill },
    { id: 'p6', name: `${base} 5`, botSkill },
    { id: 'p7', name: `${base} 6`, botSkill },
    { id: 'p8', name: `${base} 7`, botSkill },
    { id: 'p9', name: `${base} 8`, botSkill },
  ]
}

function label(skill: BotSkill): string {
  switch (skill) {
    case 'rookie':
      return 'Rookie'
    case 'novice':
      return 'Novice'
    default:
      return 'OG'
  }
}

export function scenarioSession(
  seats: SessionSeatDef[],
  cards: Card[],
  stacks?: Record<string, number>,
): SoloSession {
  return new SoloSession({
    seats,
    rngSeed: FIXED_SEED,
    stake: STAKE_250_500,
    fixedDeck: cards,
    ...(stacks === undefined ? {} : { stacks }),
  })
}

export function awaitingHuman(): SoloSession {
  const cards = deckOf('As 2c 7d 3h 4h 5h 6h 9c Qd')
  return scenarioSession(huSeats('rookie'), cards)
}

export function showdownHand(): SoloSession {
  const cards = deckOf('As 2c Ac 3d 4c 5d 6c Ks Qd')
  return scenarioSession(huSeats('rookie'), cards)
}

export function splitPotHand(): SoloSession {
  const cards = deckOf('As Ah 2c 2d Kc Kh Qs 3c 9h')
  return scenarioSession(huSeats('rookie'), cards)
}

export function uncontestedWinHand(): SoloSession {
  const cards = deckOf('As 2c Ad 3d 4c 5d 6c 7d 8c')
  return scenarioSession(huSeats('rookie'), cards)
}

export function bustHand(): SoloSession {
  const cards = deckOf('Ah Jd Qh 2c Ks Kc 7d 3s 9h')
  return scenarioSession(huSeats('rookie'), cards, { you: 100_000, p2: 250 })
}

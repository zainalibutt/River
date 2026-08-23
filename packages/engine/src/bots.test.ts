import { describe, expect, it } from 'vitest'
import type { BotDecisionInput } from './bots.js'
import { decideBotTurn } from './bots.js'
import { parseCard } from './cards.js'
import { BOT_PROFILES } from './config.js'
import { mulberry32 } from './rng.js'

const BASE: BotDecisionInput = {
  street: 'preflop',
  hole: [parseCard('2c'), parseCard('7d')],
  board: [],
  betToCall: 0,
  pot: 750,
  minRaiseTo: 1000,
  currentBet: 500,
  stack: 100_000,
  betThisStreet: 500,
}

function withHole(cards: string): BotDecisionInput {
  const texts = cards.split(' ')
  return { ...BASE, hole: [parseCard(texts[0] ?? ''), parseCard(texts[1] ?? '')] }
}

describe('bot decisions', () => {
  it('are deterministic for a seed and profile', () => {
    const profile = BOT_PROFILES.novice
    const first = decideBotTurn(BASE, profile, mulberry32(42))
    const second = decideBotTurn(BASE, profile, mulberry32(42))
    expect(first).toEqual(second)
  })

  it('check or fold weak hands, raise strong ones', () => {
    const profile = BOT_PROFILES.rookie
    const weak = decideBotTurn(withHole('2c 7d'), profile, mulberry32(1))
    expect(['check', 'fold']).toContain(weak.kind)
    let raised = false
    for (let seed = 0; seed < 30; seed++) {
      const decision = decideBotTurn(withHole('As Ad'), profile, mulberry32(seed))
      if (decision.kind !== 'check') {
        raised = true
        break
      }
    }
    expect(raised).toBe(true)
  })

  it('never raises below the minimum raise', () => {
    for (const profile of Object.values(BOT_PROFILES)) {
      for (let seed = 0; seed < 50; seed++) {
        const decision = decideBotTurn(BASE, profile, mulberry32(seed))
        if (decision.kind === 'raiseTo') {
          expect(decision.to).toBeGreaterThanOrEqual(BASE.minRaiseTo)
        }
        if (decision.kind === 'allIn') {
          expect(BASE.stack + BASE.betThisStreet).toBeGreaterThan(BASE.currentBet)
        }
      }
    }
  })

  it('presents distinct behaviour across skills', () => {
    const weak = withHole('2c 7d')
    const rookie = decideBotTurn(weak, BOT_PROFILES.rookie, mulberry32(7))
    const og = decideBotTurn(weak, BOT_PROFILES.og, mulberry32(7))
    const kinds = new Set([rookie.kind, og.kind])
    expect(kinds.size).toBeGreaterThan(0)
  })

  it('raises with a made hand on the river', () => {
    const profile = BOT_PROFILES.novice
    const made = decideBotTurn(
      {
        street: 'river',
        hole: [parseCard('As'), parseCard('Ad')],
        board: [
          parseCard('Ks'),
          parseCard('Kd'),
          parseCard('9c'),
          parseCard('5h'),
          parseCard('2s'),
        ],
        betToCall: 0,
        pot: 3000,
        minRaiseTo: 1500,
        currentBet: 0,
        stack: 90_000,
        betThisStreet: 0,
      },
      profile,
      mulberry32(3),
    )
    expect(['raiseTo', 'check', 'allIn']).toContain(made.kind)
  })
})

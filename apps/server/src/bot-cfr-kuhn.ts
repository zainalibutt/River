import type { CfrGame } from './bot-cfr.js'

/**
 * Kuhn poker, the smallest poker game with bluffing: a deck of jack, queen and
 * king, one card each, an ante of one chip, one betting round with a single
 * one-chip bet. Its equilibrium is known exactly, which makes it the check
 * that a solver is right before it is trusted with anything larger.
 */
export interface KuhnState {
  /** The two players' cards, 0 jack, 1 queen, 2 king; empty before the deal. */
  readonly cards: readonly number[]
  /** Moves so far: `p` pass or check, `b` bet or call. */
  readonly history: string
}

const TERMINAL = new Set(['pp', 'bp', 'bb', 'pbp', 'pbb'])

export const kuhnPoker: CfrGame<KuhnState> = {
  initial: () => ({ cards: [], history: '' }),
  isTerminal: (state) => TERMINAL.has(state.history),
  utility: (state) => {
    const [first, second] = state.cards as [number, number]
    const firstWins = first > second
    switch (state.history) {
      case 'bp':
        return 1
      case 'pbp':
        return -1
      case 'pp':
        return firstWins ? 1 : -1
      default:
        return firstWins ? 2 : -2
    }
  },
  isChance: (state) => state.cards.length === 0,
  chanceOutcomes: () => {
    const deals: { state: KuhnState; probability: number }[] = []
    for (let first = 0; first < 3; first += 1) {
      for (let second = 0; second < 3; second += 1) {
        if (first !== second)
          deals.push({ state: { cards: [first, second], history: '' }, probability: 1 / 6 })
      }
    }
    return deals
  },
  player: (state) => (state.history.length % 2 === 0 ? 0 : 1),
  actions: () => ['p', 'b'],
  play: (state, action) => ({ cards: state.cards, history: state.history + action }),
  infoSet: (state) => `${state.cards[state.history.length % 2]}:${state.history}`,
}

/** The first player's value at every Kuhn equilibrium. */
export const KUHN_GAME_VALUE = -1 / 18

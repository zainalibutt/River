import type { HandRank } from './evaluator.js'
import { compareRanks, HandCategory } from './evaluator.js'

const WORDS = [
  '',
  '',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'jack',
  'queen',
  'king',
  'ace',
] as const

const PLURALS = [
  '',
  '',
  'twos',
  'threes',
  'fours',
  'fives',
  'sixes',
  'sevens',
  'eights',
  'nines',
  'tens',
  'jacks',
  'queens',
  'kings',
  'aces',
] as const

const SHORTS = ['', '', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const

export function nameHand(rank: HandRank): string {
  switch (rank.category) {
    case HandCategory.HIGH_CARD:
      return `${wordTitle(rank.ranks[0])} high`
    case HandCategory.PAIR:
      return `Pair of ${plural(rank.ranks[0])}`
    case HandCategory.TWO_PAIR:
      return `Two pair, ${plural(rank.ranks[0])} and ${plural(rank.ranks[1])}`
    case HandCategory.THREE_OF_A_KIND:
      return `Trip ${plural(rank.ranks[0])}`
    case HandCategory.STRAIGHT:
      return `${wordTitle(rank.ranks[0])}-high straight`
    case HandCategory.FLUSH:
      return `Flush, ${word(rank.ranks[0])} high`
    case HandCategory.FULL_HOUSE:
      return `${pluralTitle(rank.ranks[0])} full of ${plural(rank.ranks[1])}`
    case HandCategory.FOUR_OF_A_KIND:
      return `Quad ${plural(rank.ranks[0])}`
    case HandCategory.STRAIGHT_FLUSH:
      return rank.ranks[0] === 14
        ? 'Royal flush'
        : `${wordTitle(rank.ranks[0])}-high straight flush`
  }
}

export function shortName(rank: HandRank): string {
  switch (rank.category) {
    case HandCategory.HIGH_CARD:
      return `${wordTitle(rank.ranks[0])} high`
    case HandCategory.PAIR:
      return `Pair ${short(rank.ranks[0])}s`
    case HandCategory.TWO_PAIR:
      return `Two pair, ${short(rank.ranks[0])}${short(rank.ranks[1])}`
    case HandCategory.THREE_OF_A_KIND:
      return `Trip ${short(rank.ranks[0])}s`
    case HandCategory.STRAIGHT:
      return `${short(rank.ranks[0])}-high str8`
    case HandCategory.FLUSH:
      return `Flush, ${short(rank.ranks[0])} high`
    case HandCategory.FULL_HOUSE:
      return `${pluralTitle(rank.ranks[0])} full`
    case HandCategory.FOUR_OF_A_KIND:
      return `Quad ${short(rank.ranks[0])}s`
    case HandCategory.STRAIGHT_FLUSH:
      return rank.ranks[0] === 14 ? 'Royal flush' : `Str8 flush ${short(rank.ranks[0])}`
  }
}

export function beats(a: HandRank, b: HandRank): 'a' | 'b' | 'tie' {
  const comparison = compareRanks(a, b)
  return comparison > 0 ? 'a' : comparison < 0 ? 'b' : 'tie'
}

const PRIMARY_COUNTS: Record<number, number> = {
  [HandCategory.HIGH_CARD]: 1,
  [HandCategory.PAIR]: 1,
  [HandCategory.TWO_PAIR]: 2,
  [HandCategory.THREE_OF_A_KIND]: 1,
  [HandCategory.STRAIGHT]: 1,
  [HandCategory.FLUSH]: 1,
  [HandCategory.FULL_HOUSE]: 1,
  [HandCategory.FOUR_OF_A_KIND]: 1,
  [HandCategory.STRAIGHT_FLUSH]: 1,
}

export function kickerMattered(a: HandRank, b: HandRank): boolean {
  if (a.category !== b.category) return false
  const primary = PRIMARY_COUNTS[a.category] ?? a.ranks.length
  for (let i = 0; i < primary; i += 1) {
    if ((a.ranks[i] ?? -1) !== (b.ranks[i] ?? -1)) return false
  }
  return compareRanks(a, b) !== 0
}

function word(rank: number | undefined): string {
  return WORDS[rank ?? 0] ?? String(rank)
}

function wordTitle(rank: number | undefined): string {
  const value = word(rank)
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`
}

function plural(rank: number | undefined): string {
  return PLURALS[rank ?? 0] ?? String(rank)
}

function pluralTitle(rank: number | undefined): string {
  const value = plural(rank)
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`
}

function short(rank: number | undefined): string {
  return SHORTS[rank ?? 0] ?? String(rank)
}

import { championPersonality, personalityPool } from '@river/engine'

/**
 * The rules a chosen name keeps to.
 *
 * A member chooses a name once and keeps it: no other account can hold it in
 * any mix of capitals, so it is also how somebody finds them. These rules run
 * twice from this one place - in the menu as the name is typed, and in the
 * server route that makes the claim - and the database holds the shape as a
 * backstop (claim_display_name, in the locked_player_names migration).
 */

export const NAME_SHORTEST = 3
export const NAME_LONGEST = 16

export type NameProblem = 'short' | 'long' | 'start' | 'characters' | 'reserved' | 'unsuitable'

/**
 * Names that would read as somebody they are not: the house, the table's own
 * words, and every bot, the champion included.
 */
const RESERVED: ReadonlySet<string> = new Set([
  'admin',
  'administrator',
  'anonymous',
  'dealer',
  'developer',
  'guest',
  'host',
  'member',
  'moderator',
  'null',
  'player',
  'playriver',
  'river',
  'root',
  'staff',
  'support',
  'system',
  'undefined',
  'you',
  ...[...personalityPool(), championPersonality()].map((bot) => bot.name.toLowerCase()),
])

/** Words that claim an office anywhere in a name. */
const OFFICE = /admin|moderator|official/

/**
 * Words no name may contain, however it is spelt. Kept to roots that are
 * rarely inside an innocent word, so the price of the list is a few names
 * like Scunthorpe rather than ordinary ones.
 */
const UNSUITABLE: readonly string[] = [
  'asshole',
  'bitch',
  'bollock',
  'cocksuck',
  'cunt',
  'dickhead',
  'fagg',
  'fuck',
  'hitler',
  'nazi',
  'nigg',
  'paedo',
  'pedophile',
  'porn',
  'rapist',
  'retard',
  'shit',
  'slut',
  'twat',
  'wanker',
  'whore',
]

/** Digits standing in for the letters they look like. */
const LOOKALIKE: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '9': 'g',
}

/** What is wrong with `name` as a chosen name, or null when nothing is. */
export function nameProblem(name: string): NameProblem | null {
  if (name.length < NAME_SHORTEST) return 'short'
  if (name.length > NAME_LONGEST) return 'long'
  if (!/^[A-Za-z]/.test(name)) return 'start'
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) return 'characters'
  const lower = name.toLowerCase()
  if (RESERVED.has(lower) || OFFICE.test(lower)) return 'reserved'
  const read = [...lower.replaceAll('_', '')].map((letter) => LOOKALIKE[letter] ?? letter).join('')
  if (UNSUITABLE.some((word) => read.includes(word))) return 'unsuitable'
  return null
}

const PROBLEM_TEXT: Readonly<Record<NameProblem, string>> = {
  short: `At least ${NAME_SHORTEST} characters.`,
  long: `At most ${NAME_LONGEST} characters.`,
  start: 'Start with a letter.',
  characters: 'Letters, numbers and underscores only.',
  reserved: 'That name is reserved.',
  unsuitable: 'Choose a different name.',
}

export function describeNameProblem(problem: NameProblem): string {
  return PROBLEM_TEXT[problem]
}

/** Everything a name check or claim can come to. */
export type NameStatus = 'available' | 'claimed' | 'taken' | 'locked' | NameProblem

const NAME_STATUSES: ReadonlySet<string> = new Set<NameStatus>([
  'available',
  'claimed',
  'taken',
  'locked',
  'short',
  'long',
  'start',
  'characters',
  'reserved',
  'unsuitable',
])

export function isNameStatus(value: unknown): value is NameStatus {
  return typeof value === 'string' && NAME_STATUSES.has(value)
}

/** The line shown under the name box for a status. */
export function describeNameStatus(status: NameStatus, name: string): string {
  switch (status) {
    case 'available':
      return `${name} is free.`
    case 'claimed':
      return `${name} is yours.`
    case 'taken':
      return `${name} is taken.`
    case 'locked':
      return 'You have already chosen your name.'
    default:
      return describeNameProblem(status)
  }
}

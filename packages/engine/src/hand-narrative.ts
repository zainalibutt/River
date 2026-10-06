import type { HandAction, HandRecord, HandSeatResult } from './hand-history.js'

export interface ShowdownLine {
  seat: number
  hand: string | null
  won: boolean
}

const STREET_ORDER = ['preflop', 'flop', 'turn', 'river'] as const
type StreetTuple = (typeof STREET_ORDER)[number]
type Street = HandAction['street']

export function narrateHand(record: HandRecord, seat: number): string {
  if (!record.seats.some((entry) => entry.seat === seat)) {
    return 'Watched this one from the rail.'
  }
  const actions = seatActions(record, seat)
  const result = seatResult(record, seat)
  const delta = result?.delta ?? 0
  const showed = result?.showed ?? false
  const endStreet = finalStreet(record)

  const foldAction = lastFold(actions)
  if (foldAction !== null) {
    if (foldAction.street === 'preflop') {
      return raisedBefore(record, foldAction)
        ? 'Folded to a raise before the flop.'
        : 'Folded before the flop.'
    }
    return `Folded on the ${foldAction.street}.`
  }

  const journey = buildJourney(actions)
  const outcome = buildOutcome(delta, showed, endStreet, record)
  const assembled = [journey, outcome].filter((part) => part.length > 0).join(', ')
  return `${assembled.charAt(0).toUpperCase()}${assembled.slice(1)}.`
}

export function describeShowdown(record: HandRecord): readonly ShowdownLine[] {
  return record.results
    .filter((result) => result.showed)
    .map((result) => ({
      seat: result.seat,
      hand: null,
      won: result.delta > 0,
    }))
    .sort((a, b) => a.seat - b.seat)
}

export function actionSummary(
  record: HandRecord,
  seat: number,
): {
  vpip: boolean
  raises: number
  folded: boolean
  streetsSeen: number
} {
  if (!record.seats.some((entry) => entry.seat === seat)) {
    return { vpip: false, raises: 0, folded: false, streetsSeen: 0 }
  }
  const actions = seatActions(record, seat)
  const preflopActions = actions.filter((entry) => entry.street === 'preflop')
  const vpip = preflopActions.some(
    (entry) => entry.action.kind === 'call' || entry.action.kind === 'raiseTo',
  )
  const raises = actions.filter((entry) => entry.action.kind === 'raiseTo').length
  const foldAction = lastFold(actions)
  const folded = foldAction !== null
  const streetsSeen = folded
    ? streetIndex(foldAction.street) + 1
    : streetIndex(finalStreet(record)) + 1
  return { vpip, raises, folded, streetsSeen }
}

function seatActions(record: HandRecord, seat: number): HandAction[] {
  return record.actions.filter((entry) => entry.seat === seat)
}

function seatResult(record: HandRecord, seat: number): HandSeatResult | null {
  return record.results.find((entry) => entry.seat === seat) ?? null
}

function lastFold(actions: readonly HandAction[]): HandAction | null {
  for (let i = actions.length - 1; i >= 0; i -= 1) {
    const entry = actions[i]
    if (entry !== undefined && entry.action.kind === 'fold') return entry
  }
  return null
}

function raisedBefore(record: HandRecord, fold: HandAction): boolean {
  const foldIndex = record.actions.indexOf(fold)
  if (foldIndex === -1) return false
  for (let i = 0; i < foldIndex; i += 1) {
    const entry = record.actions[i]
    if (entry !== undefined && entry.action.kind === 'raiseTo') return true
  }
  return false
}

function buildJourney(actions: readonly HandAction[]): string {
  const parts: string[] = []
  const preflop = actions.filter((entry) => entry.street === 'preflop')
  if (preflop.some((entry) => entry.action.kind === 'raiseTo')) parts.push('Raised preflop')
  else if (preflop.some((entry) => entry.action.kind === 'call')) parts.push('Called preflop')
  else if (preflop.some((entry) => entry.action.kind === 'check')) parts.push('Checked preflop')

  const seen = highestStreet(actions)
  if (seen !== null && streetIndex(seen) > streetIndex('preflop')) {
    parts.push(`played to the ${seen}`)
  }
  return parts.join(', ')
}

function buildOutcome(
  delta: number,
  showed: boolean,
  endStreet: Street,
  record: HandRecord,
): string {
  const streetWord = endStreet === 'preflop' ? 'before the flop' : `on the ${endStreet}`
  if (delta > 0) {
    const uncontested = !record.results.some((result) => result.showed)
    return showed
      ? `won ${formatChips(delta)} at the showdown`
      : `won ${formatChips(delta)}${uncontested ? ' uncontested' : ''} ${streetWord}`
  }
  if (delta < 0) {
    return showed
      ? `lost ${formatChips(-delta)} at the showdown`
      : `lost ${formatChips(-delta)} ${streetWord}`
  }
  return showed ? `broke even at the showdown` : `broke even ${streetWord}`
}

function highestStreet(actions: readonly HandAction[]): Street | null {
  let best: Street | null = null
  for (const entry of actions) {
    if (best === null || streetIndex(entry.street) > streetIndex(best)) {
      best = entry.street
    }
  }
  return best
}

function finalStreet(record: HandRecord): Street {
  let best: Street | null = null
  for (const entry of record.actions) {
    if (best === null || streetIndex(entry.street) > streetIndex(best)) {
      best = entry.street
    }
  }
  return best ?? 'preflop'
}

function streetIndex(street: Street | StreetTuple): number {
  return STREET_ORDER.indexOf(street)
}

function formatChips(amount: number): string {
  const sign = amount < 0 ? '-' : ''
  const digits = String(Math.abs(Math.trunc(amount)))
  return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
}

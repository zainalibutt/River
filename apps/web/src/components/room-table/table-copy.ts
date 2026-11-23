import type { TurnAction } from '@river/engine'
import type { RoomEvent, RoomSeatView, RoomView } from '@river/server'
import type { SeatActionFlag } from '@/components/table-pieces'
import { DEFAULT_VENUE, type VenueId } from '@/lib/venue'
import type { VerifyResult } from '@/lib/verify'

export type KickState = { reason: 'host' | 'idle' | 'duplicate-session' } | null

export function emptyView(selfId = 'pending', venueId: VenueId = DEFAULT_VENUE): RoomView {
  return {
    venueId,
    handNumber: 0,
    phase: 'open',
    street: 'preflop',
    board: [],
    pot: 0,
    currentBet: 0,
    countdownMs: 0,
    seats: Array.from({ length: 9 }, (_, seat) => ({
      seat,
      playerId: null,
      name: null,
      stack: 0,
      betHand: 0,
      betStreet: 0,
      folded: false,
      allIn: false,
      hole: null,
      hasHole: false,
      sittingOut: false,
      busted: false,
      disconnected: false,
      dealer: false,
    })),
    currentActor: null,
    legal: null,
    turnDeadlineMs: null,
    turnBudgetMs: null,
    commit: null,
    revealedSeed: null,
    clientSeeds: null,
    message: null,
    revealed: false,
    selfId,
    challenges: [],
    hostPlayerId: '',
    inviteCode: '',
  }
}

export function verifyStatusLabel(status: VerifyResult['status']): string {
  switch (status) {
    case 'match':
      return 'Fairness verified, the seeds and the cards match'
    case 'mismatch':
      return 'Fairness check failed, the seeds or the cards do not match'
    case 'live':
      return 'Fairness commit published, seed still hidden'
    default:
      return 'Fairness commit not yet published'
  }
}

export function verifyHeadline(status: VerifyResult['status']): string {
  switch (status) {
    case 'match':
      return 'This hand checks out.'
    case 'mismatch':
      return 'This hand does not check out.'
    case 'live':
      return 'The deck was locked before the deal.'
    default:
      return 'No hand committed yet.'
  }
}

export function verifyCopy(status: VerifyResult['status']): string {
  switch (status) {
    case 'match':
      return 'Recomputed in your browser: the revealed seed hashes to the commit published before the deal, and the deck it makes with every player seed deals each card you saw. Nobody could have chosen this deck after seeing a card.'
    case 'mismatch':
      return 'The revealed seeds do not match what was committed before the deal, or the deck they make does not deal the cards on this table. Do not keep playing at this table.'
    case 'live':
      return 'The commit is published and the server seed stays hidden until the hand settles. Your own seed is mixed in, so the deck is not the server’s alone.'
    default:
      return 'A commit appears when the next hand begins.'
  }
}

/**
 * What the player is holding, under the board.
 *
 * It reads from the view's own seat rather than being pushed by the server,
 * so it can never say something the player is not entitled to see - the hole
 * cards are only in the view at all when they are theirs.
 */
export function orderedSeats(view: RoomView): RoomSeatView[] {
  const heroIndex = view.seats.findIndex((seat) => seat.playerId === view.selfId)
  if (heroIndex < 0) return view.seats
  return [...view.seats.slice(heroIndex), ...view.seats.slice(0, heroIndex)]
}

export function eventNotice(events: RoomEvent[], selfId: string): string | null {
  for (const event of [...events].reverse()) {
    if (event.kind === 'identityUpgraded' && event.playerId === selfId) return 'Progress saved.'
    if (event.kind === 'reconnected' && event.playerId === selfId) return 'Reconnected.'
    if (event.kind === 'awayPlayed')
      return `${event.playerId === selfId ? 'You were' : 'A player was'} AWAY.`
    if (
      event.kind === 'kicked' &&
      event.playerId !== selfId &&
      event.reason !== 'duplicate-session'
    ) {
      return 'A player left the table.'
    }
  }
  return null
}

export function flagForAction(action: TurnAction): SeatActionFlag {
  switch (action.kind) {
    case 'check':
      return { label: 'CHECK', tone: 'quiet' }
    case 'call':
      return { label: 'CALL', tone: 'commit' }
    case 'raiseTo':
      return { label: 'RAISE', tone: 'commit' }
    case 'allIn':
      return { label: 'ALL IN', tone: 'danger' }
    case 'fold':
      return { label: 'FOLD', tone: 'danger' }
  }
}

export function actionFlagsAfter(
  current: ReadonlyMap<string, SeatActionFlag>,
  events: readonly RoomEvent[],
): ReadonlyMap<string, SeatActionFlag> {
  let next: Map<string, SeatActionFlag> | null = null
  const writable = () => {
    next ??= new Map(current)
    return next
  }
  for (const event of events) {
    if (event.kind === 'handStarted' || event.kind === 'street' || event.kind === 'between') {
      next = new Map()
      continue
    }
    if (event.kind === 'awaiting') {
      writable().delete(event.playerId)
      continue
    }
    if (event.kind === 'acted' || event.kind === 'timedOut' || event.kind === 'awayPlayed') {
      writable().set(event.playerId, flagForAction(event.action))
    }
  }
  return next ?? current
}

/**
 * Two different questions, and they were being answered by one number.
 *
 * Whether you need to sit down is about the seats taken now. Whether the table
 * can deal is about the seats taken once bots arrive, and bots arrive on the
 * deal rather than as people do. Answering the second with the first told
 * somebody sitting alone at a bot table to wait for a player who was never
 * coming, and hid the button that would have brought nine.
 */
export function waitingCopy(
  view: RoomView,
  seatedCount: number,
  botSeats: number,
  isHost: boolean,
): string | null {
  if (view.phase === 'seeding') return 'Securing the deck…'
  if (view.phase !== 'open') return null
  if (seatedCount === 0) return 'Taking your seat…'
  if (seatedCount + botSeats < 2) return 'Waiting for one more player.'
  if (!isHost) return 'Waiting for the host to deal.'
  // With bots filling the seats there is no group to wait for.
  // Bots sit down on the deal, so until then the felt looks empty: say who is coming.
  if (botSeats === 1) return 'Table is ready. Press DEAL and your opponent sits down.'
  if (botSeats > 1) return `Table is ready. Press DEAL and ${botSeats} players sit down.`
  return 'Table is ready. DEAL when your group is seated.'
}

export function kickCopy(reason: Exclude<KickState, null>['reason']): string {
  if (reason === 'host') return 'The host removed you from the table.'
  if (reason === 'idle') return 'You were removed for inactivity.'
  return 'This table is open in another window.'
}

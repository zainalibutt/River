export type TableStatus = 'open' | 'in-hand' | 'full' | 'empty'

export type VenueId = 'rooftop' | 'basement' | 'suite'

export interface TableSummary {
  roomId: string
  venueId: VenueId
  stakeId: string
  smallBlind: number
  bigBlind: number
  seatsTaken: number
  seatsTotal: number
  handNumber: number
  status: TableStatus
  hasPassword: boolean
}

export interface LobbyFilter {
  venueId?: VenueId
  maxBigBlind?: number
  hideFull?: boolean
  hideEmpty?: boolean
}

export type LobbySort = 'seats-desc' | 'stake-asc' | 'stake-desc' | 'venue'

const VENUE_ORDER: readonly VenueId[] = ['rooftop', 'basement', 'suite']

const DEFAULT_BUY_IN_BLIND_MULTIPLIER = 200

export function tableStatus(
  seatsTaken: number,
  seatsTotal: number,
  handNumber: number,
  inHand: boolean,
): TableStatus {
  if (seatsTaken >= seatsTotal) return 'full'
  if (seatsTaken === 0) return 'empty'
  if (inHand || handNumber > 0) return 'in-hand'
  return 'open'
}

export function filterTables(
  tables: readonly TableSummary[],
  filter: LobbyFilter,
): readonly TableSummary[] {
  return tables.filter((table) => {
    if (filter.venueId !== undefined && table.venueId !== filter.venueId) return false
    if (filter.maxBigBlind !== undefined && table.bigBlind > filter.maxBigBlind) return false
    if (filter.hideFull === true && table.status === 'full') return false
    if (filter.hideEmpty === true && table.status === 'empty') return false
    return true
  })
}

export function sortTables(
  tables: readonly TableSummary[],
  sort: LobbySort,
): readonly TableSummary[] {
  const indexed = tables.map((table, index) => ({ table, index }))
  indexed.sort((a, b) => {
    const diff = compareForSort(a.table, b.table, sort)
    return diff !== 0 ? diff : a.index - b.index
  })
  return indexed.map((entry) => entry.table)
}

function compareForSort(a: TableSummary, b: TableSummary, sort: LobbySort): number {
  switch (sort) {
    case 'seats-desc':
      return b.seatsTaken - a.seatsTaken
    case 'stake-asc':
      return a.bigBlind - b.bigBlind
    case 'stake-desc':
      return b.bigBlind - a.bigBlind
    case 'venue':
      return VENUE_ORDER.indexOf(a.venueId) - VENUE_ORDER.indexOf(b.venueId)
  }
}

export function bestTableFor(
  tables: readonly TableSummary[],
  bankroll: number,
): TableSummary | null {
  let best: TableSummary | null = null
  for (const table of tables) {
    if (bankroll < defaultBuyIn(table.bigBlind)) continue
    if (best === null) {
      best = table
      continue
    }
    const bestHasPlayers = best.seatsTaken > 0
    const tableHasPlayers = table.seatsTaken > 0
    if (tableHasPlayers && !bestHasPlayers) {
      best = table
      continue
    }
    if (tableHasPlayers === bestHasPlayers && table.seatsTaken > best.seatsTaken) {
      best = table
    }
  }
  return best
}

function defaultBuyIn(bigBlind: number): number {
  return DEFAULT_BUY_IN_BLIND_MULTIPLIER * bigBlind
}

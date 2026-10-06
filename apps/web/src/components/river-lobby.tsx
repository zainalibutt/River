'use client'

import type { LobbySort, TableSummary } from '@river/engine'
import { filterTables, sortTables } from '@river/engine'
import { useMemo, useState } from 'react'
import { VENUE_ORDER, type VenueId, venueOf } from '@/lib/venue'

interface RiverLobbyProps {
  tables: readonly TableSummary[]
  connected: boolean
  onJoin: (roomId: string, venueId: VenueId) => void
  onRefresh: () => void
}

const SORTS: { id: LobbySort; label: string }[] = [
  { id: 'seats-desc', label: 'BUSIEST' },
  { id: 'stake-asc', label: 'LOW STAKES' },
  { id: 'stake-desc', label: 'HIGH STAKES' },
  { id: 'venue', label: 'BY VENUE' },
]

function statusLabel(table: TableSummary): string {
  switch (table.status) {
    case 'full':
      return 'FULL'
    case 'in-hand':
      return 'IN HAND'
    case 'empty':
      return 'EMPTY'
    default:
      return 'OPEN'
  }
}

export function RiverLobby({ tables, connected, onJoin, onRefresh }: RiverLobbyProps) {
  const [venue, setVenue] = useState<VenueId | null>(null)
  const [sort, setSort] = useState<LobbySort>('seats-desc')
  const [hideFull, setHideFull] = useState(false)

  const rows = useMemo(
    () =>
      sortTables(
        filterTables(tables, {
          ...(venue === null ? {} : { venueId: venue }),
          hideFull,
        }),
        sort,
      ),
    [tables, venue, sort, hideFull],
  )

  return (
    <section className="lobby" aria-label="Table lobby">
      <header className="lobby-head">
        <h1>Choose a table</h1>
        <button type="button" onClick={onRefresh} disabled={!connected}>
          REFRESH
        </button>
      </header>

      <div className="lobby-filters">
        <fieldset aria-label="Filter by venue">
          <button
            type="button"
            className={venue === null ? 'chosen' : ''}
            aria-pressed={venue === null}
            onClick={() => setVenue(null)}
          >
            ALL VENUES
          </button>
          {VENUE_ORDER.map((id) => (
            <button
              key={id}
              type="button"
              className={venue === id ? 'chosen' : ''}
              aria-pressed={venue === id}
              onClick={() => setVenue(id)}
            >
              {venueOf(id).name}
            </button>
          ))}
        </fieldset>

        <fieldset aria-label="Sort tables">
          {SORTS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={sort === option.id ? 'chosen' : ''}
              aria-pressed={sort === option.id}
              onClick={() => setSort(option.id)}
            >
              {option.label}
            </button>
          ))}
        </fieldset>

        <label className="lobby-toggle">
          <input
            type="checkbox"
            checked={hideFull}
            onChange={(event) => setHideFull(event.target.checked)}
          />
          HIDE FULL
        </label>
      </div>

      {rows.length === 0 ? (
        <p className="lobby-empty">
          {tables.length === 0
            ? 'No tables running yet. Start one and share the code.'
            : 'No table matches those filters.'}
        </p>
      ) : (
        <ol className="lobby-list">
          {rows.map((table) => (
            <li key={table.roomId} className={`lobby-row ${table.status}`}>
              <span className="lobby-venue">{venueOf(table.venueId as VenueId).name}</span>
              <span className="lobby-stake">
                {table.smallBlind.toLocaleString()}/{table.bigBlind.toLocaleString()}
              </span>
              <span className="lobby-seats">
                {table.seatsTaken}/{table.seatsTotal}
              </span>
              <span className="lobby-status">{statusLabel(table)}</span>
              <button
                type="button"
                disabled={!connected || table.status === 'full'}
                onClick={() => onJoin(table.roomId, table.venueId as VenueId)}
              >
                {table.status === 'full' ? 'FULL' : 'SIT'}
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

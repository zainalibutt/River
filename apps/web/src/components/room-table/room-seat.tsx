import type { Card } from '@river/engine'
import type { RoomSeatView } from '@river/server'
import type { CSSProperties } from 'react'
import { ActionPin, PlayingCard, type SeatActionFlag, TurnWatch } from '@/components/table-pieces'
import { formatAmount } from '@/lib/presentation'

const seatPositions = [
  { x: 57, y: 78 },
  { x: 23, y: 76 },
  { x: 13, y: 55.9 },
  { x: 13.6, y: 33 },
  { x: 35.6, y: 18.1 },
  { x: 64.4, y: 18.1 },
  { x: 86.4, y: 33 },
  { x: 87, y: 55.9 },
  { x: 77, y: 76 },
] as const

export function RoomSeat({
  seat,
  index,
  active,
  local,
  timer,
  timerTotal,
  turnKey,
  actionFlag,
  shownCards,
  onSelect,
  anchorRef,
  projected,
  bigBlind,
}: {
  seat: RoomSeatView
  index: number
  active: boolean
  local: boolean
  timer: number | null
  timerTotal: number
  /** Changes once per turn, so the watch restarts only when a new turn does. */
  turnKey: string
  actionFlag: SeatActionFlag | null
  /** The hand this player showed at a showdown, face up over their head. */
  shownCards: readonly Card[] | null
  onSelect: () => void
  anchorRef: (element: HTMLElement | null) => void
  /** 3D projects this seat's position every frame, so React must not also set it. */
  projected: boolean
  bigBlind: number | null
}) {
  const position = seatPositions[index] ?? seatPositions[0]
  const style = projected
    ? undefined
    : ({
        '--seat-x': `${position.x}%`,
        '--seat-y': `${position.y}%`,
        '--chair-x': `${position.x}%`,
        '--chair-y': `${position.y}%`,
      } as CSSProperties)
  if (seat.playerId === null) {
    // An empty seat, and nothing over it. The table seats you when you arrive, so
    // a plate reading SIT was an instruction for something that already happened -
    // and the place markers still anchor here for whatever else points at a seat.
    return <article ref={anchorRef} className="seat open-seat" style={style} />
  }
  // One marker over a player, never two. The acting player shows the watch,
  // anyone who has acted this street shows what they did until the next card,
  // and a player all in from an earlier street keeps saying so. Your own seat
  // shows none of them: the action menu is yours, and a pin over your own head
  // would sit on top of it.
  let marker: React.ReactNode = null
  if (!local && shownCards !== null) {
    // A showdown. The cards on the felt are a few dozen pixels from the gameplay camera and
    // a flat card is fewer, so the hand a player shows is also held up where it can be read.
    marker = <ShownHand cards={shownCards} />
  } else if (!local && active && timer !== null) {
    marker = <TurnWatch key={turnKey} remainingMs={timer} budgetMs={timerTotal} />
  } else if (!local && actionFlag !== null) {
    marker = <ActionPin flag={actionFlag} amount={seat.betStreet} bigBlind={bigBlind} />
  } else if (!local && seat.allIn) {
    marker = <ActionPin flag={{ label: 'ALL IN', tone: 'danger' }} amount={null} />
  }
  const note = seat.disconnected
    ? 'Reconnecting'
    : seat.sittingOut
      ? 'Sitting out'
      : seat.folded
        ? 'Folded'
        : null
  return (
    <article
      ref={anchorRef}
      className={`seat-anchor${active ? ' active' : ''}${local ? ' hero-seat' : ''}${seat.folded ? ' folded' : ''}${seat.disconnected ? ' reconnecting' : ''}`}
      style={style}
    >
      <button
        className="seat-select"
        type="button"
        onClick={onSelect}
        aria-label={`Inspect ${seat.name}`}
      />
      {marker}
      {active && seat.playerId === 'bot:midas' ? (
        <span className="seat-thinking" role="status">
          Thinking…
        </span>
      ) : null}
      {seat.dealer ? (
        <span className="seat-dealer" role="img" aria-label="Dealer">
          D
        </span>
      ) : null}
      {/* Title and level are designed slots holding placeholders. The engine
          already models both; the table protocol does not carry them yet. */}
      <div className="seat-plate">
        <span className="seat-plate-name">{seat.name}</span>
        <span className="seat-plate-level">
          LEVEL <b>—</b>
        </span>
        <span className="seat-plate-title">—</span>
        <span className="seat-plate-chips">
          <i aria-hidden="true" />
          {formatAmount(seat.stack, !local, bigBlind)}
        </span>
        {note === null ? null : <span className="seat-plate-note">{note}</span>}
      </div>
    </article>
  )
}

function ShownHand({ cards }: { cards: readonly Card[] }) {
  return (
    <div
      className="seat-pin shown-hand"
      role="img"
      aria-label={`Showed ${cards.map((card) => `${card.rank}${card.suit}`).join(' ')}`}
    >
      {cards.map((card) => (
        <PlayingCard key={`${card.rank}${card.suit}`} card={card} />
      ))}
    </div>
  )
}

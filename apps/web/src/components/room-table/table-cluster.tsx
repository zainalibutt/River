import type { RoomView } from '@river/server'
import { RollingAmount } from '@/components/rolling-amount'
import { CardBack, PlayingCard } from '@/components/table-pieces'
import { readoutFor } from '@/lib/hand-readout'
import { formatAmount } from '@/lib/presentation'

const boardSlots = ['flop-one', 'flop-two', 'flop-three', 'turn', 'river'] as const

/**
 * Everything about your own position, in one cluster at the lower left.
 *
 * Your two cards, your chips, the board and the pot used to be spread across
 * the screen: the board and pot sat in the middle of the table over the felt,
 * and the hand sat on its own in the corner. They now read top to bottom as one
 * column, the way the reference groups them, and nothing sits over the table.
 *
 * Your cards stay face down until you press and hold them, or hold Space,
 * because in the room nobody reads their cards by leaving them face up. A folded
 * hand shows its faces greyed under a cross.
 */
export function TableCluster({
  view,
  peek,
  onPeek,
  compact,
  dealt,
  boardShown,
  showing,
  bigBlind,
}: {
  view: RoomView
  peek: boolean
  onPeek: (held: boolean) => void
  /** The 2D table carries the board and the pot on its felt, so the cluster keeps your hand. */
  compact: boolean
  /** Whether your cards have landed; the cluster shows them as they arrive, not before. */
  dealt: boolean
  /** Board cards the felt has turned face up, or null to read the whole board (3D). */
  boardShown: number | null
  /** Whether the showdown is telling your hand right now. */
  showing: boolean
  /** Amounts in this many chips to the big blind, or in chips when null. */
  bigBlind: number | null
}) {
  const hero = view.seats.find((seat) => seat.playerId === view.selfId)
  const holding = hero?.hasHole && hero.hole !== null && dealt
  const showFaces = holding && (peek || hero?.folded === true)
  // Named against the board the felt has turned over, never the board the server has dealt:
  // the view runs ahead of the felt, and a pair named early is the river given away.
  const visibleBoard = boardShown === null ? view.board : view.board.slice(0, boardShown)
  const readout = holding && showFaces ? readoutFor(hero?.hole ?? [], visibleBoard) : null
  return (
    <section
      className={`table-cluster${compact ? ' compact' : ''}${showing ? ' showing' : ''}`}
      aria-label={compact ? 'Your hand and chips' : 'Your hand, chips, board and pot'}
    >
      {hero?.hasHole && dealt ? (
        <button
          type="button"
          className={`hero-cards${peek ? ' peeking' : ''}${hero.folded ? ' folded' : ''}`}
          aria-label={peek ? 'Your cards' : 'Press and hold to look at your cards'}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            onPeek(true)
          }}
          onPointerUp={() => onPeek(false)}
          onPointerCancel={() => onPeek(false)}
          onLostPointerCapture={() => onPeek(false)}
        >
          {showFaces && hero.hole !== null
            ? hero.hole.map((card) => <PlayingCard key={`${card.rank}${card.suit}`} card={card} />)
            : [<CardBack key="first" />, <CardBack key="second" />]}
          {hero.folded ? <span className="fold-stamp" aria-hidden="true" /> : null}
          {/* The phone says it under its cards; the desktop said nothing, and
              face-down cards read as a hand nobody can see. */}
          {peek || hero.folded ? null : (
            <span className="hero-peek-hint" aria-hidden="true">
              HOLD TO PEEK
            </span>
          )}
        </button>
      ) : null}
      {hero === undefined ? null : (
        <p className="cluster-chips">
          <i aria-hidden="true" />
          <RollingAmount value={hero.stack} abbreviated bigBlind={bigBlind} />
        </p>
      )}
      {compact || view.board.length === 0 ? null : (
        <section
          className="cluster-board"
          aria-label={`${view.street}, ${view.board.length} community cards`}
        >
          {view.board.map((card, index) => (
            // The flop arrives as three cards in one message; each lands a beat
            // after the last so it reads as dealt rather than appearing at once.
            <div
              className="cluster-board-card"
              key={boardSlots[index] ?? `${card.rank}${card.suit}`}
              style={{ animationDelay: index < 3 ? `${index * 280}ms` : '0ms' }}
            >
              <PlayingCard card={card} />
            </div>
          ))}
        </section>
      )}
      {compact ? null : (
        <p
          className="cluster-pot"
          role="status"
          aria-label={`Pot ${formatAmount(view.pot, false, bigBlind)}`}
        >
          <i aria-hidden="true" />
          {formatAmount(view.pot, true, bigBlind)}
        </p>
      )}
      {readout === null ? null : <p className="cluster-readout">{readout.full}</p>}
    </section>
  )
}

'use client'

import type { Card } from '@river/engine'
import { type CSSProperties, type ReactNode, useState } from 'react'
import { formatAmount, rankLabel } from '@/lib/presentation'
import './table-pieces.css'

/**
 * The pieces every renderer of the table shares: the cards, a seat's action pin and the
 * acting player's watch. The HUD draws them over the 3D room and the 2D table draws them on
 * its felt, so there is one card and one watch rather than one per renderer.
 */

export type SeatActionFlag = {
  label: 'CHECK' | 'CALL' | 'RAISE' | 'ALL IN' | 'FOLD'
  tone: 'quiet' | 'commit' | 'danger'
}

const SUIT_NAME: Record<Card['suit'], string> = {
  s: 'spades',
  h: 'hearts',
  d: 'diamonds',
  c: 'clubs',
}

const RANK_NAME: Record<Card['rank'], string> = {
  '2': 'two',
  '3': 'three',
  '4': 'four',
  '5': 'five',
  '6': 'six',
  '7': 'seven',
  '8': 'eight',
  '9': 'nine',
  T: 'ten',
  J: 'jack',
  Q: 'queen',
  K: 'king',
  A: 'ace',
}

/**
 * The four suits, drawn rather than typed. A suit character comes from whichever font the
 * system has, and on some it is an emoji; drawn, a heart is the same heart everywhere.
 */
export function SuitMark({ suit, className }: { suit: Card['suit']; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" aria-hidden="true">
      {suit === 'h' ? (
        <path d="M50 90C19 66 5 48 5 30 5 15 16 5 30 5c9 0 16 5 20 13 4-8 11-13 20-13 14 0 25 10 25 25 0 18-14 36-45 60Z" />
      ) : suit === 'd' ? (
        <path d="M50 3c9 17 21 32 38 47-17 15-29 30-38 47-9-17-21-32-38-47C29 35 41 20 50 3Z" />
      ) : suit === 's' ? (
        <path d="M50 4c12 16 44 33 44 57 0 13-10 22-22 22-9 0-15-4-19-10 1 9 5 16 12 23H35c7-7 11-14 12-23-4 6-10 10-19 10C16 83 6 74 6 61 6 37 38 20 50 4Z" />
      ) : (
        <>
          <circle cx="50" cy="28" r="20" />
          <circle cx="27" cy="58" r="20" />
          <circle cx="73" cy="58" r="20" />
          <path d="M45 50h10c0 20 3 33 12 46H33c9-13 12-26 12-46Z" />
        </>
      )}
    </svg>
  )
}

/**
 * A card face: the rank and suit in two corners, and the suit large in the middle. Jacks,
 * queens and kings carry their letter framed instead of a portrait - a portrait is art the
 * table does not have, and a framed letter reads at any size.
 */
export function PlayingCard({ card, peek = false }: { card: Card; peek?: boolean }) {
  const rank = rankLabel(card.rank)
  const court = card.rank === 'J' || card.rank === 'Q' || card.rank === 'K'
  const kind = court ? ' court' : card.rank === 'A' ? ' ace' : ''
  return (
    <div
      className={`playing-card suit-${card.suit}${peek ? ' hero-card peeked' : ''}`}
      role="img"
      aria-label={`${RANK_NAME[card.rank]} of ${SUIT_NAME[card.suit]}`}
    >
      <div className={`rcard-face${kind}${rank.length > 1 ? ' wide' : ''}`}>
        <span className="rcard-index">
          <b>{rank}</b>
          <SuitMark suit={card.suit} />
        </span>
        <span className="rcard-centre">
          {court ? <b>{rank}</b> : null}
          <SuitMark suit={card.suit} />
        </span>
        <span className="rcard-index rcard-index-foot">
          <b>{rank}</b>
          <SuitMark suit={card.suit} />
        </span>
      </div>
    </div>
  )
}

/** The back every face-down card shows: wine, an engraved ground, a brass frame, the R. */
export function CardBack() {
  return (
    <div className="card-back" role="img" aria-label="Face-down card">
      <div className="rcard-back">
        <span className="rcard-monogram">R</span>
      </div>
    </div>
  )
}

export const PIN_ICON: Record<SeatActionFlag['label'], ReactNode> = {
  CALL: <path d="M12 19V6M6.5 11.5 12 6l5.5 5.5" />,
  RAISE: <path d="M12 21V11M7 15.5l5-5 5 5M7 9.5l5-5 5 5" />,
  CHECK: <path d="M5 12.5 9.5 17 19 7.5" />,
  FOLD: <path d="M7 7l10 10M17 7 7 17" />,
  'ALL IN': <path d="M12 21V9M7 13.5l5-5 5 5M6 4h12" />,
}

/** How an action reads as a class name: `all-in` rather than `ALL IN`. */
export function actionKind(flag: SeatActionFlag): string {
  return flag.label === 'ALL IN' ? 'all-in' : flag.label.toLowerCase()
}

/** The amount worth showing beside an action: what a call, raise or all-in put in. */
export function actionAmount(flag: SeatActionFlag, amount: number | null): number | null {
  const kind = actionKind(flag)
  return amount !== null && amount > 0 && (kind === 'call' || kind === 'raise' || kind === 'all-in')
    ? amount
    : null
}

export function ActionPin({
  flag,
  amount,
  bigBlind = null,
}: {
  flag: SeatActionFlag
  amount: number | null
  /** Amounts in this many chips to the big blind, or in chips when null. */
  bigBlind?: number | null
}) {
  const kind = actionKind(flag)
  const shown = actionAmount(flag, amount)
  return (
    <div
      className={`seat-pin action-pin ${kind}`}
      role="img"
      aria-label={
        shown === null ? flag.label : `${flag.label} ${formatAmount(shown, false, bigBlind)}`
      }
    >
      {shown === null ? null : (
        <b className="action-pin-amount">{formatAmount(shown, true, bigBlind)}</b>
      )}
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {PIN_ICON[flag.label]}
      </svg>
    </div>
  )
}

/**
 * The acting player's clock.
 *
 * The sweep is one CSS animation started at the point this turn had already
 * reached when the seat began acting. Driving the hand from the ticking
 * remaining-time state would re-render the dial every tick and step the hand in
 * visible jumps, and a turn that is already half gone when you join must show
 * half gone rather than start again.
 */
export function TurnWatch({ remainingMs, budgetMs }: { remainingMs: number; budgetMs: number }) {
  const [elapsed] = useState(() => Math.max(0, Math.min(budgetMs, budgetMs - remainingMs)))
  return (
    <div
      className="seat-pin turn-watch"
      role="timer"
      aria-label={`${Math.max(0, Math.ceil(remainingMs / 1000))} seconds to act`}
      style={
        { '--turn-budget': `${budgetMs}ms`, '--turn-elapsed': `-${elapsed}ms` } as CSSProperties
      }
    >
      <span className="turn-watch-face" aria-hidden="true">
        <span className="turn-watch-spent" />
        <span className="turn-watch-indices" />
        <span className="turn-watch-hand" />
      </span>
    </div>
  )
}

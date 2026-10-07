'use client'

import type { RoomSeatView, RoomView } from '@river/server'
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import {
  actionAmount,
  actionKind,
  CardBack,
  PIN_ICON,
  PlayingCard,
  type SeatActionFlag,
  TurnWatch,
} from '@/components/table-pieces'
import {
  advanceChoreography,
  boardShown,
  type CardChoreography,
  type CardPlace,
  type CardSprite,
  choreographyBusy,
  emptyChoreography,
  seatDealtAt,
  spriteFrame,
} from '@/lib/card-choreography'
import {
  applyMoment,
  betsAt,
  type ChipFlow,
  type ChipMoment,
  emptyChipFlow,
  flightProgress,
  flightsAt,
  type Pile,
  potAt,
  settleChipFlow,
  stackAdjustmentAt,
} from '@/lib/chip-flow'
import { formatAmount } from '@/lib/presentation'
import { accentFor } from '@/lib/seat-accents'
import type { ShowdownPlan } from '@/lib/showdown-plan'
import type { SeatBubble } from '@/lib/social'
import {
  type PlanePoint,
  planeOffset,
  planeStyle,
  project,
  type SeatSpots,
  type TableGeometry,
  tableLayout,
} from '@/lib/table-2d-geometry'
import { type SoundEffect, tableSound } from '@/lib/table-sound'
import { ChipPile } from './chip-pile'
import { Dealer, Shoe } from './dealer'
import './table-2d.css'

/**
 * The table as River v1 shows it: a felt tipped back from the player, a dealer at its head,
 * the players on placards round the rail.
 *
 * It draws the same table the 3D room draws, from the same room view and the same chip and
 * showdown schedules, so nothing about the game is decided here - only where things are and
 * how they move. The HUD over it (the action menu, the raise arc, the cluster that carries
 * your own hand) is shared with the 3D room and unchanged.
 */

/**
 * How far the felt has got through the hand: the board cards face up, and when the
 * showdown starts being told, on the page's performance clock.
 */
export interface TablePresentation {
  boardShown: number
  showdownStartsAt: number | null
}

export interface Table2DProps {
  view: RoomView
  geometry: TableGeometry
  chipMoments: readonly ChipMoment[]
  showdown: ShowdownPlan | null
  seatActions: ReadonlyMap<string, SeatActionFlag>
  turnRemaining: number | null
  /** Changes once per turn, so the watch restarts only when a new turn does. */
  turnKey: string
  onSelect: (seat: number) => void
  /** Tells the HUD when your two cards have landed, so the cluster shows them as they arrive. */
  onHeroDealt?: (landed: boolean) => void
  /** How much of the hand the felt has shown, as it changes. */
  onPresentation?: (presentation: TablePresentation) => void
  /** Lines said at the table, up for a moment over the speaker's placard. */
  bubbles?: readonly SeatBubble[]
  /**
   * Seats holding their cards up to look at them, their own and everybody else's.
   *
   * A read is half of what there is to see at a table, and it was happening
   * where nobody could: the cards lift at the seat that is looking, so the rest
   * of the table sees the look the way they would across a real felt.
   */
  heldPeeks?: readonly number[]
  /**
   * Whether the plates are held open (Tab or Shift). Otherwise a player is their
   * medallion alone - monogram, or the watch while they act - as in the 3D room.
   */
  platesHeld?: boolean
  /** Amounts in this many chips to the big blind, as Settings can ask, or in chips when null. */
  bigBlind?: number | null
  /** The seat whose hand the showdown is telling right now, lit until the next one. */
  showingSeat?: number | null
  phone?: boolean
}

/** The dealer stands a little larger than the players' placards: they are the table's host. */
const DEALER_SIZE = 1.2

/** How long the all-in moment holds the table, words and all. */
const ALL_IN_MS = 1_400

function initials(name: string | null): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return (words[0] ?? '?').slice(0, 1).toUpperCase()
  return `${(words[0] ?? '').slice(0, 1)}${(words[words.length - 1] ?? '').slice(0, 1)}`.toUpperCase()
}

function hash(text: string): number {
  let value = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index)
    value = Math.imul(value, 16777619)
  }
  return (value >>> 0) / 4294967295
}

/**
 * A length for an inline style, to the hundredth of a pixel. The browser keeps six figures
 * of a CSS number, so a longer one written on the server reads back shorter in the browser
 * and React takes the difference for a page that does not match.
 */
function px(value: number): string {
  return `${fixed(value)}px`
}

function fixed(value: number): number {
  return Math.round(value * 100) / 100
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t
}

/** The accent a seat's monogram ring takes: the 3D cast's silk colour, toned into the brass. */
function accentStyle(seat: number, heroSeat: number | null): CSSProperties | undefined {
  const accent = accentFor(seat, heroSeat)
  return accent === null ? undefined : ({ '--seat-accent': accent.hex } as CSSProperties)
}

export function Table2D(props: Table2DProps) {
  const { view, geometry } = props
  const bigBlind = props.bigBlind ?? null
  const heroSeat = view.seats.find((seat) => seat.playerId === view.selfId)?.seat ?? null
  const layout = useMemo(
    () => tableLayout(geometry, view.seats.length, heroSeat),
    [geometry, view.seats.length, heroSeat],
  )
  const spots = useMemo(() => new Map(layout.seats.map((spot) => [spot.seat, spot])), [layout])
  const dealerSeat = view.seats.find((seat) => seat.dealer)
  const dealFrom = layout.headsUp
    ? (spots.get(dealerSeat?.seat ?? 0)?.button ?? layout.shoe)
    : layout.shoe
  const styles = useMemo(() => planeStyle(geometry), [geometry])

  // The dealer's cards, moved on by each view the room sends.
  const choreography = useRef<CardChoreography>(emptyChoreography())
  const previous = useRef<RoomView | null>(null)
  const showdownStart = useRef<{ plan: ShowdownPlan; startedAt: number } | null>(null)
  // Chips, moved on by each moment the room table works out; the same schedule the 3D room plays.
  const flow = useRef<ChipFlow>(emptyChipFlow())
  const [schedule, setSchedule] = useState(0)
  const [now, setNow] = useState(() => (typeof performance === 'undefined' ? 0 : performance.now()))

  useEffect(() => {
    const at = performance.now()
    if (props.showdown === null) {
      showdownStart.current = null
    } else if (showdownStart.current?.plan !== props.showdown) {
      showdownStart.current = { plan: props.showdown, startedAt: at }
    }
    const before = previous.current
    const swept =
      before !== null &&
      before.handNumber === view.handNumber &&
      before.seats.some((seat) => seat.betStreet > 0)
    choreography.current = advanceChoreography(
      choreography.current,
      {
        handNumber: view.handNumber,
        phase: view.phase,
        board: view.board,
        seats: view.seats.map(({ seat, hasHole, folded, dealer }) => ({
          seat,
          hasHole,
          folded,
          dealer,
        })),
        revealed: view.revealed,
        swept,
        showdown: showdownStart.current,
      },
      at,
    )
    previous.current = view
    setSchedule((count) => count + 1)
  }, [view, props.showdown])

  // The all-in moment: the first shove of a hand lifts that player's placard, pulses the room
  // amber once and sets the words over the felt. Repeats inside one hand are not a moment.
  const allInHand = useRef(-1)
  const [allIn, setAllIn] = useState<{ seat: number; id: number } | null>(null)
  useEffect(() => {
    const seconds = performance.now() / 1000
    let next = flow.current
    for (const moment of props.chipMoments) {
      if (moment.serial > next.lastSerial && allInHand.current !== moment.handNumber) {
        const shove = moment.commits.find((commit) => commit.path === 'shove')
        if (shove !== undefined) {
          allInHand.current = moment.handNumber
          setAllIn({ seat: shove.seat, id: moment.serial })
        }
      }
      // A pot goes to its winner once the showdown that decides it has been told, and the
      // showdown waits for the board: the payout is timed from the felt, not the message.
      const startsAt = choreography.current.showdownStartsAt
      const plan = props.showdown
      const paid =
        moment.awards.length > 0 && startsAt !== null && plan !== null
          ? {
              ...moment,
              awardDelaySeconds: Math.max(
                moment.awardDelaySeconds ?? 0,
                (startsAt + plan.show.awardAtMs - seconds * 1000) / 1000,
              ),
            }
          : moment
      next = applyMoment(next, paid, seconds)
    }
    if (next !== flow.current) {
      flow.current = next
      setSchedule((count) => count + 1)
    }
  }, [props.chipMoments, props.showdown])
  useEffect(() => {
    if (allIn === null) return
    const timer = window.setTimeout(() => setAllIn(null), ALL_IN_MS)
    return () => window.clearTimeout(timer)
  }, [allIn])

  // One clock for the felt, running only while something on it is moving. Each frame also
  // plays whatever was scheduled since the last one, so a card is heard as it leaves the shoe.
  const heard = useRef(0)
  useEffect(() => {
    if (schedule === 0) return
    let frame = 0
    const tick = () => {
      const at = performance.now()
      for (const effect of soundsBetween(choreography.current, flow.current, heard.current, at)) {
        tableSound.play(effect)
      }
      heard.current = at
      flow.current = settleChipFlow(flow.current, at / 1000)
      setNow(at)
      if (choreographyBusy(choreography.current, at) || flow.current.flights.length > 0) {
        frame = requestAnimationFrame(tick)
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [schedule])

  // The cluster shows your hand when your second card lands, not before the deal reaches you.
  const heroLandedAt = heroSeat === null ? null : seatDealtAt(choreography.current, heroSeat)
  const heroLanded = heroLandedAt === null || now >= heroLandedAt
  const onHeroDealt = props.onHeroDealt
  useEffect(() => {
    onHeroDealt?.(heroLanded)
  }, [heroLanded, onHeroDealt])

  // What the felt has shown so far, for everything outside it that could give the hand away:
  // the hand named in the cluster, the showdown's captions and the payout.
  const shown = boardShown(choreography.current, now)
  const showdownStartsAt = choreography.current.showdownStartsAt
  const onPresentation = props.onPresentation
  useEffect(() => {
    onPresentation?.({ boardShown: shown, showdownStartsAt })
  }, [shown, showdownStartsAt, onPresentation])

  const seconds = now / 1000
  const chips = flow.current
  const bets = betsAt(chips, seconds)
  const pot = potAt(chips, seconds)
  const flights = flightsAt(chips, seconds)
  const routes = new Map<string, number>()
  const payees = new Set(
    flights.flatMap((flight) =>
      flight.to.kind === 'stack' && flight.to.seat !== null ? [flight.to.seat] : [],
    ),
  )

  const pileAt = (pile: Pile) => {
    if (pile.kind === 'pot') return project(geometry, layout.pot)
    const spot = pile.seat === null ? undefined : spots.get(pile.seat)
    if (spot === undefined) return project(geometry, layout.pot)
    return project(geometry, pile.kind === 'bet' ? spot.bet : spot.stack)
  }

  const placeOf = (place: CardPlace, id: string): { point: PlanePoint; rotate: number } => {
    if (place.kind === 'shoe') return { point: dealFrom, rotate: -8 }
    if (place.kind === 'muck') {
      const spin = hash(id)
      return {
        point: {
          u: layout.muck.u + (spin - 0.5) * 14,
          v: layout.muck.v + (hash(`${id}v`) - 0.5) * 10,
        },
        rotate: (spin - 0.5) * 40,
      }
    }
    if (place.kind === 'board') {
      return { point: layout.board[place.index] ?? layout.pot, rotate: 0 }
    }
    const spot = spots.get(place.seat)
    if (spot === undefined) return { point: layout.muck, rotate: 0 }
    return {
      point: spot.cards[place.index === 0 ? 0 : 1] ?? spot.cards[0],
      rotate: spot.facing + (place.index === 0 ? -6 : 6),
    }
  }

  // Which way the dealer's hand is going: toward the last card to leave the shoe.
  let pitch: 'left' | 'right' | 'centre' | null = null
  let latest = Number.NEGATIVE_INFINITY
  for (const sprite of choreography.current.sprites) {
    const move = sprite.moves.find(
      (entry) => entry.from.kind === 'shoe' && entry.startAt <= now && now - entry.startAt < 170,
    )
    if (move === undefined || move.startAt < latest) continue
    latest = move.startAt
    const target = placeOf(move.to, sprite.id).point
    pitch = target.u < -90 ? 'left' : target.u > 90 ? 'right' : 'centre'
  }

  const dealer = layout.dealer
  const shoe = project(geometry, layout.shoe)

  return (
    <div
      className={`t2d t2d-${geometry.orientation}${props.platesHeld ? ' t2d-plates-held' : ''}`}
      aria-hidden={geometry.orientation === 'portrait' ? undefined : true}
    >
      <div className="t2d-room" />
      <div className="t2d-scene" style={styles.scene}>
        <div className="t2d-plane" style={styles.plane}>
          <div className="t2d-rail" />
          <div className="t2d-stitch" style={{ inset: px(geometry.rail * 0.5) }} />
          <div className="t2d-felt" style={{ inset: px(geometry.rail) }} />
          <div className="t2d-inlay" style={{ inset: px(geometry.rail + 10) }} />
          <div className="t2d-betline" style={ellipseStyle(geometry, 0.71, 0.59)} />
          {view.seats.map((seat) => {
            // Where somebody could sit, inlaid in the felt by the rail.
            const spot = spots.get(seat.seat)
            if (seat.playerId !== null || spot === undefined) return null
            const [first, second] = spot.cards
            const at = { u: (first.u + second.u) / 2, v: (first.v + second.v) / 2 }
            return (
              <div
                key={`seat-mark-${seat.seat}`}
                className="t2d-seat-mark"
                aria-hidden="true"
                style={offsetStyle(at, geometry)}
              />
            )
          })}
          <div className="t2d-mark" style={offsetStyle(layout.mark, geometry)}>
            River
          </div>
          {view.seats.map((seat) => {
            if (!seat.dealer) return null
            const spot = spots.get(seat.seat)
            if (spot === undefined) return null
            return (
              <div
                key="button"
                className="t2d-button"
                role="img"
                aria-label={`Dealer: ${seat.name ?? 'player'}`}
                data-dealer-seat={seat.seat}
                style={offsetStyle(spot.button, geometry)}
              >
                D
              </div>
            )
          })}
          {choreography.current.sprites.map((sprite) => (
            <FeltCard
              key={sprite.id}
              sprite={sprite}
              now={now}
              geometry={geometry}
              placeOf={placeOf}
              size={sprite.kind === 'board' ? layout.boardCard : layout.holeCard}
              peeking={
                sprite.kind === 'hole' &&
                sprite.seat !== null &&
                (props.heldPeeks ?? []).includes(sprite.seat)
              }
            />
          ))}
        </div>
      </div>
      <div className="t2d-upright">
        {layout.headsUp ? null : (
          <Dealer
            pitch={pitch}
            style={{
              left: px(dealer.x),
              top: px(dealer.y),
              transform: `translate(-50%, -100%) scale(${fixed(dealer.scale * (geometry.orientation === 'portrait' ? 0.38 : DEALER_SIZE))})`,
            }}
          />
        )}
        {layout.headsUp ? null : (
          <Shoe
            style={{
              left: px(shoe.x),
              top: px(shoe.y),
              transform: `translate(-50%, -62%) scale(${fixed(shoe.scale * (geometry.orientation === 'portrait' ? 0.4 : 1))})`,
            }}
          />
        )}
        {pot > 0 ? (
          <PileAt
            at={pileAt({ kind: 'pot', seat: null })}
            amount={pot}
            label="POT"
            pot
            bigBlind={bigBlind}
          />
        ) : null}
        {[...bets].map(([seat, amount]) => (
          <PileAt
            key={`bet-${seat}`}
            at={pileAt({ kind: 'bet', seat })}
            amount={amount}
            bigBlind={bigBlind}
          />
        ))}
        {flights.map((flight) => {
          // A winner of a main pot and a side pot is paid twice at once, down the same route,
          // so a flight is its route, its start and how many have taken that route before it.
          const route = `flight-${flight.from.kind}${flight.from.seat}-${flight.to.kind}${flight.to.seat}-${flight.startAt}`
          const copy = routes.get(route) ?? 0
          routes.set(route, copy + 1)
          const from = pileAt(flight.from)
          const to = pileAt(flight.to)
          const t = flightProgress(flight, seconds)
          const at = {
            x: lerp(from.x, to.x, t),
            y: lerp(from.y, to.y, t) - Math.sin(Math.PI * t) * (flight.path === 'slide' ? 6 : 14),
            scale: lerp(from.scale, to.scale, t),
          }
          return (
            <PileAt
              key={`${route}-${copy}`}
              at={at}
              amount={flight.amount}
              moving
              bigBlind={bigBlind}
            />
          )
        })}
        {view.seats.map((seat) => {
          const spot = spots.get(seat.seat)
          if (spot === undefined || seat.seat === heroSeat) return null
          return (
            <Placard
              key={seat.seat}
              seat={seat}
              spot={spot}
              heroSeat={heroSeat}
              acting={view.currentActor?.playerId === seat.playerId && seat.playerId !== null}
              turnRemaining={props.turnRemaining}
              budgetMs={view.turnBudgetMs ?? 1}
              turnKey={props.turnKey}
              flag={seat.playerId === null ? null : (props.seatActions.get(seat.playerId) ?? null)}
              stack={seat.stack + stackAdjustmentAt(chips, seat.seat, seconds)}
              winning={payees.has(seat.seat)}
              showing={props.showingSeat === seat.seat}
              beat={allIn?.seat === seat.seat}
              onSelect={() => props.onSelect(seat.seat)}
              bigBlind={bigBlind}
              phone={props.phone ?? false}
              playerDealt={layout.headsUp}
            />
          )
        })}
        {(props.bubbles ?? []).map((bubble) => {
          const spot = spots.get(bubble.seat)
          if (spot === undefined || bubble.seat === heroSeat) return null
          const box = spot.placardBox
          return (
            <p
              key={bubble.id}
              className={`t2d-bubble ${bubble.kind}`}
              style={{ left: px(box.x + box.width / 2), top: px(box.y - 20) }}
            >
              {bubble.text}
            </p>
          )
        })}
        {allIn === null ? null : (
          <div key={allIn.id} className="t2d-allin">
            <span>ALL IN</span>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * The sounds of everything that began between two frames: a card leaving the shoe or going
 * in, a card turning, chips going out, in, or to a winner.
 */
function soundsBetween(
  cards: CardChoreography,
  chips: ChipFlow,
  from: number,
  to: number,
): SoundEffect[] {
  const out: SoundEffect[] = []
  const began = (at: number) => at > from && at <= to
  for (const sprite of cards.sprites) {
    for (const move of sprite.moves) {
      if (!began(move.startAt) || move.startAt === move.endAt) continue
      out.push('card_slide')
    }
    if (sprite.flipAt !== null && sprite.card !== null && began(sprite.flipAt))
      out.push('card_flip')
  }
  for (const flight of chips.flights) {
    if (!began(flight.startAt * 1000)) continue
    if (flight.to.kind === 'bet') out.push(flight.path === 'shove' ? 'chip_push' : 'chip_bet')
    else if (flight.to.kind === 'pot') out.push('chip_stack')
    else out.push('pot_push')
  }
  return out
}

function offsetStyle(point: PlanePoint, geometry: TableGeometry): CSSProperties {
  const at = planeOffset(geometry, point)
  return { left: px(at.left), top: px(at.top) }
}

/** An ellipse on the felt at a fraction of the felt inside the rail. */
function ellipseStyle(geometry: TableGeometry, across: number, deep: number): CSSProperties {
  const a = (geometry.a - geometry.rail) * across
  const b = (geometry.b - geometry.rail) * deep
  return {
    left: px(geometry.a - a),
    top: px(geometry.b - b),
    width: px(a * 2),
    height: px(b * 2),
  }
}

function FeltCard({
  sprite,
  now,
  geometry,
  placeOf,
  size,
  peeking = false,
}: {
  sprite: CardSprite
  now: number
  geometry: TableGeometry
  placeOf: (place: CardPlace, id: string) => { point: PlanePoint; rotate: number }
  size: { width: number; height: number }
  peeking?: boolean
}) {
  const frame = spriteFrame(sprite, now)
  if (frame === null) return null
  const from = placeOf(frame.from, sprite.id)
  const to = placeOf(frame.to, sprite.id)
  const point = {
    u: lerp(from.point.u, to.point.u, frame.travel),
    v: lerp(from.point.v, to.point.v, frame.travel),
  }
  const at = planeOffset(geometry, point)
  const rotate = lerp(from.rotate, to.rotate, frame.travel)
  // A card turns over on the felt: it narrows to its edge, and the face comes up as it widens.
  const edge = Math.max(0.04, Math.abs(Math.cos(Math.PI * frame.turn)))
  const faceUp = frame.turn >= 0.5 && sprite.card !== null
  const moving = frame.travel < 1
  return (
    <div
      className={`t2d-card t2d-card-${sprite.kind}${moving ? ' moving' : ''}${peeking ? ' peeking' : ''}`}
      style={{
        left: px(at.left),
        top: px(at.top),
        width: px(size.width),
        height: px(size.height),
        // Lifted at one corner and turned a little in, which is what a player
        // looking at their cards does with them.
        transform: `translate(-50%, -50%) rotate(${fixed(rotate + (peeking ? 11 : 0))}deg) scaleX(${fixed(edge)})${peeking ? ' scale(1.1)' : ''}`,
      }}
    >
      {faceUp && sprite.card !== null ? <PlayingCard card={sprite.card} /> : <CardBack />}
    </div>
  )
}

function PileAt({
  at,
  amount,
  label,
  pot = false,
  moving = false,
  bigBlind,
}: {
  at: { x: number; y: number; scale: number }
  amount: number
  label?: string
  pot?: boolean
  moving?: boolean
  bigBlind: number | null
}) {
  return (
    <div
      className={`t2d-pile${pot ? ' t2d-pot' : ''}${moving ? ' moving' : ''}`}
      style={{
        left: px(at.x),
        top: px(at.y),
        transform: `scale(${fixed(at.scale)})`,
      }}
    >
      <ChipPile amount={amount} maxChips={pot ? 24 : moving ? 8 : 12} />
      {moving ? null : (
        <span className="t2d-pile-amount">
          {label === undefined ? null : <em>{label}</em>}
          {formatAmount(amount, true, bigBlind)}
        </span>
      )}
    </div>
  )
}

function Placard({
  seat,
  spot,
  heroSeat,
  acting,
  turnRemaining,
  budgetMs,
  turnKey,
  flag,
  stack,
  winning,
  showing,
  beat,
  onSelect,
  bigBlind,
  phone,
  playerDealt,
}: {
  seat: RoomSeatView
  spot: SeatSpots
  heroSeat: number | null
  acting: boolean
  turnRemaining: number | null
  budgetMs: number
  turnKey: string
  flag: SeatActionFlag | null
  stack: number
  winning: boolean
  /** Whether the showdown is telling this player's hand right now. */
  showing: boolean
  /** Whether this player has just gone all in: the placard lifts for the moment. */
  beat: boolean
  onSelect: () => void
  bigBlind: number | null
  phone: boolean
  playerDealt: boolean
}) {
  const box = spot.placardBox
  const position: CSSProperties = { left: px(box.x), top: px(box.y) }
  // An empty place has no plate: an empty frame round the rail read as clutter, and as a
  // button to press for a seat the table hands you when you arrive. The felt marks the
  // place instead - see the seat marks in Table2D.
  if (seat.playerId === null) return null
  const shown = phone
    ? seat.betStreet > 0
      ? seat.betStreet
      : null
    : flag === null
      ? null
      : actionAmount(flag, seat.betStreet)
  const note = seat.disconnected
    ? 'AWAY'
    : seat.busted
      ? 'OUT'
      : seat.sittingOut && !seat.allIn
        ? 'SITTING OUT'
        : null
  return (
    <article
      className={`t2d-placard${acting ? ' acting' : ''}${seat.folded ? ' folded' : ''}${seat.allIn ? ' all-in' : ''}${winning ? ' winning' : ''}${showing ? ' showing' : ''}${beat ? ' beat' : ''}${note === null ? '' : ' muted'}`}
      style={{ ...position, ...accentStyle(seat.seat, heroSeat) }}
    >
      <button
        type="button"
        className="t2d-select"
        onClick={onSelect}
        aria-label={`Inspect ${seat.name ?? 'player'}`}
      />
      <span className="t2d-medallion">
        {acting && turnRemaining !== null ? (
          <TurnWatch key={turnKey} remainingMs={turnRemaining} budgetMs={budgetMs} />
        ) : (
          <span className="t2d-monogram">{initials(seat.name)}</span>
        )}
      </span>
      <span className="t2d-plate-text">
        <span className="t2d-name">{seat.name}</span>
        <span className="t2d-stack">
          <i aria-hidden="true" />
          {formatAmount(Math.max(0, stack), true, bigBlind)}
        </span>
      </span>
      {phone && playerDealt && seat.dealer ? <span className="phone-dealer">DEALER</span> : null}
      {note !== null ? (
        <span className="t2d-note">
          {note}
          {phone && shown !== null ? <b>{formatAmount(shown, true, bigBlind)}</b> : null}
        </span>
      ) : flag !== null ? (
        <span className={`t2d-tag ${actionKind(flag)}`}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {PIN_ICON[flag.label]}
          </svg>
          {flag.label}
          {shown === null ? null : <b>{formatAmount(shown, true, bigBlind)}</b>}
        </span>
      ) : seat.allIn ? (
        <span className="t2d-tag all-in">
          ALL IN
          {phone && shown !== null ? <b>{formatAmount(shown, true, bigBlind)}</b> : null}
        </span>
      ) : phone && shown !== null ? (
        <span className="t2d-tag">
          BET <b>{formatAmount(shown, true, bigBlind)}</b>
        </span>
      ) : null}
    </article>
  )
}

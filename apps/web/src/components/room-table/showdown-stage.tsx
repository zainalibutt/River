import { SHOWDOWN_TENSION_MS } from '@river/engine'
import type { RoomSeatView } from '@river/server'
import { CardBack, PlayingCard } from '@/components/table-pieces'
import { formatAmount } from '@/lib/presentation'
import { type ShowdownPlan, showingSeat } from '@/lib/showdown-plan'

/**
 * The showdown, told one hand at a time.
 *
 * It used to be a caption: a name and a hand flashed up while the pot had already moved.
 * Now the table goes quiet and the word goes up over the pot; each hand is turned over in
 * the order a dealer calls for them, one card and then the other, and named; before the
 * last hand - the one that decides it - the table holds its breath; and only then does the
 * pot go to the winner. The schedule is the engine's, so the server holds the next deal
 * for exactly as long as this takes.
 */
/** Past this many letters a hand name is set a size smaller where the caption is narrow. */
const LONG_HAND_NAME = 18

export function ShowdownStage({
  plan,
  atMs,
  seats,
  bigBlind,
}: {
  plan: ShowdownPlan
  atMs: number
  seats: readonly RoomSeatView[]
  bigBlind: number | null
}) {
  const nameOf = (seat: number) =>
    seats.find((entry) => entry.seat === seat)?.name ?? `Seat ${seat + 1}`
  const first = plan.show.steps[0]
  const deciding = plan.show.steps.find((step) => step.deciding)
  // A run-out turned every hand face up before the board; there is no held breath left.
  const tension =
    !plan.tabled &&
    deciding !== undefined &&
    atMs < deciding.revealAtMs &&
    atMs >= deciding.revealAtMs - SHOWDOWN_TENSION_MS
  const awarding = atMs >= plan.show.awardAtMs
  let current: (typeof plan.show.steps)[number] | undefined
  for (const step of plan.show.steps) if (atMs >= step.revealAtMs) current = step
  let body: React.ReactNode = null
  if (first === undefined || atMs < first.revealAtMs) {
    body = (
      <>
        <span className="showdown-kicker">SHOWDOWN</span>
        <strong className="showdown-win">{formatAmount(plan.pot, true, bigBlind)}</strong>
      </>
    )
  } else if (awarding) {
    body = plan.awards.map((award) => (
      <span className="showdown-award" key={award.seat}>
        <span className="showdown-who">{nameOf(award.seat)}</span>
        <strong className="showdown-win">WINS {formatAmount(award.amount, true, bigBlind)}</strong>
      </span>
    ))
  } else if (tension && deciding !== undefined) {
    body = (
      <>
        <span className="showdown-who">{nameOf(deciding.seat)}</span>
        <span className="showdown-cards">
          <CardBack key="first" />
          <CardBack key="second" />
        </span>
      </>
    )
  } else if (current?.mucked === true) {
    body = (
      <>
        <span className="showdown-who">{nameOf(current.seat)}</span>
        <strong className="showdown-hand showdown-muck">MUCKS</strong>
      </>
    )
  } else if (current !== undefined) {
    const step = current
    const cards = plan.cards.get(step.seat) ?? []
    body = (
      <>
        <span className="showdown-who">{nameOf(step.seat)}</span>
        <span className="showdown-cards">
          {cards.map((card, index) =>
            plan.tabled || atMs >= (index === 0 ? step.revealAtMs : step.secondCardAtMs) ? (
              <PlayingCard key={`face-${card.rank}${card.suit}`} card={card} />
            ) : (
              <CardBack key={`back-${card.rank}${card.suit}`} />
            ),
          )}
        </span>
        {atMs >= step.nameAtMs ? (
          <strong
            className={`showdown-hand${(plan.names.get(step.seat) ?? '').length > LONG_HAND_NAME ? ' long' : ''}`}
          >
            {plan.names.get(step.seat)}
          </strong>
        ) : null}
      </>
    )
  }
  return (
    <div
      className={`showdown-stage${tension ? ' tension' : ''}${awarding ? ' awarding' : ''}${showingSeat(plan, atMs) === null ? '' : ' spotlit'}`}
      role="status"
      aria-live="polite"
    >
      <div className="showdown-vignette" aria-hidden="true" />
      <div className="showdown-card">{body}</div>
    </div>
  )
}

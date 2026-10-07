/**
 * How long the dealer takes over each part of a hand, in milliseconds.
 *
 * The deal is deliberate: a burn and a beat before every street, the flop laid out and
 * turned one card at a time, and the pauses rather than slow motion carrying the weight.
 * Every card the table moves reads its timing from here, and the server holds the next
 * turn's clock for the same deal, so a turn never starts while its cards are still in the air.
 */
export const DEAL_TEMPO = {
  /** After a hand begins and before the first card leaves the shoe: the blinds going in. */
  lead: 520,
  /** One hole card's flight from the shoe to its seat. */
  holeFlight: 300,
  /** Between one hole card leaving the shoe and the next. */
  holeStagger: 110,
  /** Before a burn, while the last street's bets go into the middle. Only when there were bets. */
  sweep: 620,
  /** The burn card's slide from the shoe to the muck. */
  burn: 340,
  /** The pause after the burn. */
  beat: 240,
  /** A board card's slide from the shoe to its place, face down. */
  boardFlight: 360,
  /** Between the flop's cards leaving the shoe. */
  boardStagger: 70,
  /** After a card lands and before it is turned. */
  settle: 90,
  /** One card turning over. */
  flip: 250,
  /** Between one flop card turning and the next. */
  flipStagger: 190,
  /** A folded hand's slide into the muck. */
  fold: 300,
  /** Every card on the felt going back to the dealer once a hand is over. */
  collect: 460,
  /** How long the felt holds after an uncontested pot before the cards go in. */
  collectDelay: 1400,
  /** How long it holds after a showdown has been told. */
  showdownHold: 500,
  /** Between one all-in hand being turned face up and the next. */
  tableStagger: 140,
  /** Once every all-in hand is face up, before the run-out begins: the table reads them. */
  tableHold: 1_100,
  /** Between the streets of an all-in run-out: each one lands as its own moment. */
  runoutBeat: 1_100,
  /** Before the river of a run-out, on top of the beat: the held breath. */
  riverBreath: 500,
} as const

/** How long turning every all-in hand face up takes, before the run-out begins. */
export function tablingMs(hands: number): number {
  if (hands <= 0) return 0
  return (hands - 1) * DEAL_TEMPO.tableStagger + DEAL_TEMPO.flip + DEAL_TEMPO.tableHold
}

/**
 * How long an all-in run-out takes to present: the hands turned face up, then each street
 * betting never reached dealt with a beat of its own, and a breath before the river.
 * `streets` holds the card count of each street still to come, flop first.
 */
export function runoutMs(streets: readonly number[], hands: number, swept: boolean): number {
  let total = tablingMs(hands)
  streets.forEach((cards, index) => {
    const last = index === streets.length - 1
    total +=
      (index > 0 ? DEAL_TEMPO.runoutBeat : 0) +
      (last && streets.length > 1 ? DEAL_TEMPO.riverBreath : 0) +
      streetDealMs(cards, index === 0 && swept)
  })
  return total
}

/** How long a street takes from the burn to its last card face up, bets swept first or not. */
export function streetDealMs(cards: number, swept: boolean): number {
  const count = Math.max(1, cards)
  return (
    (swept ? DEAL_TEMPO.sweep : 0) +
    DEAL_TEMPO.burn +
    DEAL_TEMPO.beat +
    DEAL_TEMPO.boardFlight +
    (count - 1) * DEAL_TEMPO.boardStagger +
    DEAL_TEMPO.settle +
    (count - 1) * DEAL_TEMPO.flipStagger +
    DEAL_TEMPO.flip
  )
}

/** How long the hole cards take to reach every seat dealt in. */
export function holeDealMs(players: number): number {
  const cards = Math.max(0, players) * 2
  return cards === 0
    ? 0
    : DEAL_TEMPO.lead + (cards - 1) * DEAL_TEMPO.holeStagger + DEAL_TEMPO.holeFlight
}

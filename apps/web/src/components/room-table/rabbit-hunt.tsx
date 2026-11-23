import type { Card } from '@river/engine'
import { PlayingCard } from '@/components/table-pieces'

/**
 * The rabbit: after a hand that ended before the river, the cards that would have come.
 * A button while nobody has asked, then the cards themselves, until the next deal.
 */
export function RabbitHunt({
  rabbit,
  onHunt,
}: {
  rabbit: { handNumber: number; cards: Card[] | null } | null
  onHunt: () => void
}) {
  if (rabbit === null) return null
  if (rabbit.cards === null)
    return (
      <div className="rabbit-hunt">
        <button type="button" onClick={onHunt}>
          RABBIT HUNT
        </button>
        <span>See what would have come</span>
      </div>
    )
  return (
    <section className="rabbit-hunt shown" aria-label="The cards that would have come">
      <span>WOULD HAVE COME</span>
      <div className="rabbit-cards">
        {rabbit.cards.map((card) => (
          <PlayingCard key={`${card.rank}${card.suit}`} card={card} />
        ))}
      </div>
    </section>
  )
}

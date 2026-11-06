import type { BotTablePreset } from '@river/engine'
import { MIDAS_BUSY_MESSAGE } from '@/lib/bot-capabilities'

/** Both heads-up doors use the same menu and turn UI as the existing champion. */
export function BotChallenges({
  midasAvailable,
  midasSeatsFree,
  onSelect,
}: {
  midasAvailable: boolean
  midasSeatsFree: number
  onSelect: (preset: BotTablePreset) => void
}) {
  return (
    <>
      <button
        type="button"
        className="club-home-nell"
        aria-label="Champion, Nyx 1v1"
        onClick={() => onSelect('champion')}
      >
        <span className="club-home-match-mark" aria-hidden="true">
          <span>1</span>
          <small>v</small>
          <span>1</span>
        </span>
        <span className="club-home-challenge">
          <span className="club-home-action-title">Champion</span>
          <span className="club-home-action-detail">Nyx · 1v1</span>
        </span>
      </button>
      {midasAvailable ? (
        <button
          type="button"
          className="club-home-nell"
          aria-label="Midas 1v1"
          disabled={midasSeatsFree === 0}
          title={midasSeatsFree === 0 ? MIDAS_BUSY_MESSAGE : undefined}
          onClick={() => onSelect('midas')}
        >
          <span className="club-home-match-mark" aria-hidden="true">
            <span>1</span>
            <small>v</small>
            <span>1</span>
          </span>
          <span className="club-home-challenge">
            <span className="club-home-action-title">Midas</span>
            <span className="club-home-action-detail">
              {midasSeatsFree === 0 ? MIDAS_BUSY_MESSAGE : '1v1'}
            </span>
          </span>
        </button>
      ) : null}
    </>
  )
}

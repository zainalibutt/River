import type { BotTablePreset } from '@river/engine'

/** Both heads-up doors use the same menu and turn UI as the existing champion. */
export function BotChallenges({
  midasAvailable,
  onSelect,
}: {
  midasAvailable: boolean
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
          onClick={() => onSelect('midas')}
        >
          <span className="club-home-match-mark" aria-hidden="true">
            <span>1</span>
            <small>v</small>
            <span>1</span>
          </span>
          <span className="club-home-challenge">
            <span className="club-home-action-title">Midas</span>
            <span className="club-home-action-detail">1v1</span>
          </span>
        </button>
      ) : null}
    </>
  )
}

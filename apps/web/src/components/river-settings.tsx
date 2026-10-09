'use client'

import { useCallback, useEffect, useState } from 'react'
import { RiverSoundControl } from '@/components/river-sound-control'
import {
  DEFAULT_PREFERENCES,
  type Preferences,
  readPreferences,
  writePreferences,
} from '@/lib/preferences'

/**
 * River's settings, the one list of them.
 *
 * The menu's SETTINGS shows this and so does the table's, so there is one
 * place a setting is added and both screens gain it. Each screen draws its own
 * frame round it: a capsule on the menu, a panel over the table.
 */
export function RiverSettings({
  preferences,
  onChange,
}: {
  preferences: Preferences
  onChange: (next: Preferences) => void
}) {
  return (
    <div className="river-settings">
      <RiverSoundControl variant="setting" />
      <button
        type="button"
        className="club-setting-toggle"
        aria-pressed={preferences.censorProfanity}
        onClick={() => onChange({ ...preferences, censorProfanity: !preferences.censorProfanity })}
      >
        <span>Censor profanity</span>
        <strong>{preferences.censorProfanity ? 'On' : 'Off'}</strong>
      </button>
      <span className="club-capsule-sub">Off by default. Applies to table chat.</span>
      <button
        type="button"
        className="club-setting-toggle"
        aria-pressed={preferences.amountsInBigBlinds}
        onClick={() =>
          onChange({ ...preferences, amountsInBigBlinds: !preferences.amountsInBigBlinds })
        }
      >
        <span>Show amounts in big blinds</span>
        <strong>{preferences.amountsInBigBlinds ? 'On' : 'Off'}</strong>
      </button>
      <span className="club-capsule-sub">
        Off by default. Bets, pots and stacks at the table, in its big blinds.
      </span>
      <button
        type="button"
        className="club-setting-toggle"
        aria-pressed={preferences.showLosingHands}
        onClick={() => onChange({ ...preferences, showLosingHands: !preferences.showLosingHands })}
      >
        <span>Show losing hands</span>
        <strong>{preferences.showLosingHands ? 'On' : 'Off'}</strong>
      </button>
      <span className="club-capsule-sub">
        Off by default: at a showdown, a hand that cannot win is thrown away unseen. After an all-in
        every hand is shown.
      </span>
    </div>
  )
}

/**
 * The player's settings, and a way to change them that saves as it goes.
 *
 * Read once the page is live rather than while it is first drawn, because the
 * server has no browser storage to read and the two drawings must match. A
 * browser that refuses storage altogether keeps the defaults, and a change
 * still applies for as long as the page is open.
 */
export function usePreferences(): readonly [Preferences, (next: Preferences) => void] {
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES)
  useEffect(() => {
    try {
      setPreferences(readPreferences(window.localStorage))
    } catch {
      // Storage itself is blocked: the defaults stand.
    }
  }, [])
  const update = useCallback((next: Preferences) => {
    setPreferences(next)
    try {
      writePreferences(window.localStorage, next)
    } catch {
      // Storage itself is blocked: the change lasts as long as the page.
    }
  }, [])
  return [preferences, update] as const
}

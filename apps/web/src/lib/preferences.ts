export const CENSOR_PROFANITY_KEY = 'river:censor-profanity'
export const AMOUNTS_IN_BIG_BLINDS_KEY = 'river:amounts-in-big-blinds'

interface PreferenceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * Everything a player can set, as one value.
 *
 * The menu's SETTINGS and the table's show the same list and read and write it
 * here, each setting under its own key in this browser's storage, so a change
 * made at the table is the one the menu shows next.
 */
export interface Preferences {
  censorProfanity: boolean
  /** Bets, pots and stacks in the table's big blinds rather than in chips. */
  amountsInBigBlinds: boolean
}

export const DEFAULT_PREFERENCES: Preferences = {
  censorProfanity: false,
  amountsInBigBlinds: false,
}

export function readPreferences(storage: PreferenceStorage): Preferences {
  return {
    censorProfanity: readCensorProfanity(storage),
    amountsInBigBlinds: readSwitch(storage, AMOUNTS_IN_BIG_BLINDS_KEY),
  }
}

export function writePreferences(storage: PreferenceStorage, preferences: Preferences): void {
  writeCensorProfanity(storage, preferences.censorProfanity)
  writeSwitch(storage, AMOUNTS_IN_BIG_BLINDS_KEY, preferences.amountsInBigBlinds)
}

export function readCensorProfanity(storage: PreferenceStorage): boolean {
  return readSwitch(storage, CENSOR_PROFANITY_KEY)
}

export function writeCensorProfanity(storage: PreferenceStorage, enabled: boolean): void {
  writeSwitch(storage, CENSOR_PROFANITY_KEY, enabled)
}

/** A setting that is on or off, and off wherever storage cannot say otherwise. */
function readSwitch(storage: PreferenceStorage, key: string): boolean {
  try {
    return storage.getItem(key) === 'on'
  } catch {
    return false
  }
}

function writeSwitch(storage: PreferenceStorage, key: string, enabled: boolean): void {
  try {
    storage.setItem(key, enabled ? 'on' : 'off')
  } catch {
    return
  }
}

const PROFANITY =
  /\b(fuck(?:er|ers|ing|ed)?|shit(?:ty|ting)?|bitch(?:es|ing)?|cunt(?:s)?|asshole(?:s)?|bollocks)\b/gi

export function censorProfanity(text: string): string {
  return text.replace(PROFANITY, (word) => `${word[0]}${'*'.repeat(Math.max(1, word.length - 1))}`)
}

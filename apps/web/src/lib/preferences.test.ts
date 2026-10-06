import { describe, expect, it } from 'vitest'
import {
  AMOUNTS_IN_BIG_BLINDS_KEY,
  CENSOR_PROFANITY_KEY,
  censorProfanity,
  DEFAULT_PREFERENCES,
  readCensorProfanity,
  readPreferences,
  writeCensorProfanity,
  writePreferences,
} from './preferences.js'

class MemoryStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

describe('profanity preference', () => {
  it('defaults to uncensored and persists either choice', () => {
    const storage = new MemoryStorage()
    expect(readCensorProfanity(storage)).toBe(false)
    writeCensorProfanity(storage, true)
    expect(storage.values.get(CENSOR_PROFANITY_KEY)).toBe('on')
    expect(readCensorProfanity(storage)).toBe(true)
    writeCensorProfanity(storage, false)
    expect(readCensorProfanity(storage)).toBe(false)
  })

  it('masks whole profane words without damaging ordinary words', () => {
    expect(censorProfanity('Fuck that shit, but keep class assignment.')).toBe(
      'F*** that s***, but keep class assignment.',
    )
  })

  it('fails open when browser storage is unavailable', () => {
    const storage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(readCensorProfanity(storage)).toBe(false)
    expect(() => writeCensorProfanity(storage, true)).not.toThrow()
  })
})

describe('the settings the menu and the table share', () => {
  it('starts from the defaults in a browser that has saved nothing', () => {
    expect(readPreferences(new MemoryStorage())).toEqual(DEFAULT_PREFERENCES)
    expect(DEFAULT_PREFERENCES.censorProfanity).toBe(false)
  })

  it('reads back whatever either screen saved, under the keys already in use', () => {
    const storage = new MemoryStorage()
    writePreferences(storage, { ...DEFAULT_PREFERENCES, censorProfanity: true })
    expect(storage.values.get(CENSOR_PROFANITY_KEY)).toBe('on')
    expect(readPreferences(storage)).toEqual({ ...DEFAULT_PREFERENCES, censorProfanity: true })
    // A choice saved before the table had settings of its own still counts.
    writeCensorProfanity(storage, false)
    expect(readPreferences(storage).censorProfanity).toBe(false)
  })

  it('falls back to the defaults when browser storage is unavailable', () => {
    const storage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(readPreferences(storage)).toEqual(DEFAULT_PREFERENCES)
    expect(() => writePreferences(storage, DEFAULT_PREFERENCES)).not.toThrow()
  })
})

describe('amounts in big blinds', () => {
  it('is off by default and is kept with the other settings', () => {
    const storage = new MemoryStorage()
    expect(DEFAULT_PREFERENCES.amountsInBigBlinds).toBe(false)
    expect(readPreferences(storage).amountsInBigBlinds).toBe(false)
    writePreferences(storage, { ...DEFAULT_PREFERENCES, amountsInBigBlinds: true })
    expect(storage.values.get(AMOUNTS_IN_BIG_BLINDS_KEY)).toBe('on')
    expect(readPreferences(storage)).toEqual({ censorProfanity: false, amountsInBigBlinds: true })
    writePreferences(storage, { ...DEFAULT_PREFERENCES, amountsInBigBlinds: false })
    expect(readPreferences(storage).amountsInBigBlinds).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import {
  describeNameStatus,
  isNameStatus,
  NAME_LONGEST,
  NAME_SHORTEST,
  nameProblem,
} from './player-name'

/**
 * A chosen name is kept for good and is how somebody is found, so the rules
 * refuse what would read as somebody else or as abuse, and let an ordinary
 * name through even when an unsuitable word could be read into it.
 */

describe('a chosen name', () => {
  it('is three to sixteen letters, digits or underscores, starting with a letter', () => {
    expect(NAME_SHORTEST).toBe(3)
    expect(NAME_LONGEST).toBe(16)
    for (const name of ['Zain', 'Zed', 'WilyBadger91', 'a_b', 'River_Rat', 'X'.repeat(16)]) {
      expect(nameProblem(name), name).toBeNull()
    }
  })

  it('says which rule a name breaks', () => {
    expect(nameProblem('Ze')).toBe('short')
    expect(nameProblem('')).toBe('short')
    expect(nameProblem('X'.repeat(17))).toBe('long')
    expect(nameProblem('1Zain')).toBe('start')
    expect(nameProblem('_Zain')).toBe('start')
    expect(nameProblem('Zain Butt')).toBe('characters')
    expect(nameProblem('Zain-Butt')).toBe('characters')
    expect(nameProblem('Zaïn')).toBe('characters')
    expect(nameProblem(' Zain')).toBe('start')
    expect(nameProblem('Zain ')).toBe('characters')
  })

  it('cannot be the house, a word the table uses, or any bot', () => {
    for (const name of ['Player', 'guest', 'DEALER', 'River', 'Nell', 'mickey', 'Bernadette']) {
      expect(nameProblem(name), name).toBe('reserved')
    }
    for (const name of ['SuperAdmin', 'RiverModerator', 'TheOfficial']) {
      expect(nameProblem(name), name).toBe('reserved')
    }
  })

  it('cannot carry an unsuitable word, however it is spelt', () => {
    for (const name of ['Fucker', 'sh1tlord', 'b_i_t_c_h', 'CUNT99', 'Wh0re']) {
      expect(nameProblem(name), name).toBe('unsuitable')
    }
  })

  it('lets ordinary names through that an unsuitable word could be read into', () => {
    for (const name of ['Dickens', 'Hancock', 'Essex', 'Torpedo', 'Grape', 'Cocktail', 'Scott']) {
      expect(nameProblem(name), name).toBeNull()
    }
  })
})

describe('a name status', () => {
  it('is only one of the outcomes the route can give', () => {
    expect(isNameStatus('available')).toBe(true)
    expect(isNameStatus('reserved')).toBe(true)
    expect(isNameStatus('invalid')).toBe(false)
    expect(isNameStatus(7)).toBe(false)
  })

  it('reads as a short line under the box', () => {
    expect(describeNameStatus('available', 'Zain')).toBe('Zain is free.')
    expect(describeNameStatus('claimed', 'Zain')).toBe('Zain is yours.')
    expect(describeNameStatus('taken', 'Zain')).toBe('Zain is taken.')
    expect(describeNameStatus('locked', 'Zain')).toBe('You have already chosen your name.')
    expect(describeNameStatus('short', 'Ze')).toBe('At least 3 characters.')
  })
})

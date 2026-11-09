import { describe, expect, it } from 'vitest'
import { coachLine } from './first-hand'

describe('coachLine', () => {
  it('explains a free check and a bet', () => {
    expect(coachLine(true, 'CHECK', true)).toBe(
      'Nobody has bet: check to see the next card for free. Bet to put chips in. The gold ring is your clock.',
    )
  })

  it('explains calling and folding facing a bet, with what the call costs', () => {
    const line = coachLine(false, 'Call 500', true)
    expect(line).toContain('Call 500 to stay in, or fold to drop out.')
    expect(line).toContain('Raise to bet more.')
  })

  it('leaves raising out when it is not possible', () => {
    expect(coachLine(false, 'Call 500', false)).not.toContain('Raise')
  })
})

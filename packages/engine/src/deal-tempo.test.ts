import { describe, expect, it } from 'vitest'
import { DEAL_TEMPO, runoutMs, streetDealMs, tablingMs } from './deal-tempo.js'

describe('an all-in run-out, presented', () => {
  it('turns every hand over before the board runs out', () => {
    expect(tablingMs(0)).toBe(0)
    expect(tablingMs(1)).toBe(DEAL_TEMPO.flip + DEAL_TEMPO.tableHold)
    expect(tablingMs(3)).toBe(2 * DEAL_TEMPO.tableStagger + DEAL_TEMPO.flip + DEAL_TEMPO.tableHold)
  })

  it('gives every street after the first its own beat, and the river a breath on top', () => {
    const preflop = runoutMs([3, 1, 1], 2, true)
    expect(preflop).toBe(
      tablingMs(2) +
        streetDealMs(3, true) +
        DEAL_TEMPO.runoutBeat +
        streetDealMs(1, false) +
        DEAL_TEMPO.runoutBeat +
        DEAL_TEMPO.riverBreath +
        streetDealMs(1, false),
    )
  })

  it('does not hold a breath before a river that is the only street left', () => {
    expect(runoutMs([1], 2, true)).toBe(tablingMs(2) + streetDealMs(1, true))
  })
})

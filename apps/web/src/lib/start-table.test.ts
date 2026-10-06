import { afterEach, describe, expect, it, vi } from 'vitest'
import { startTableHref } from './start-table'
import { initialRoomTarget } from './table-target'

/**
 * The link "Start a table" opens, read back the way the table page reads it.
 * What reaches the server is what decides the table, so the two are tested
 * together rather than each against a string.
 */
function openedFrom(href: string) {
  const search = href.slice(href.indexOf('?'))
  vi.stubGlobal('window', {
    location: { search, href: `https://river.test/table${search}` },
    localStorage: { getItem: () => null, setItem: () => undefined },
  })
  return initialRoomTarget()
}

afterEach(() => vi.unstubAllGlobals())

describe('the table "Start a table" opens', () => {
  it('leaves the number of bots to the server, which draws it from the room', () => {
    const target = openedFrom(startTableHref({ bots: 'fill', preset: 'tough' }))
    expect(target.botSeats).toBeUndefined()
    expect(target.botPreset).toBe('tough')
    expect(target.roomId).toMatch(/^river-[0-9a-f]{8}$/)
  })

  it('asks for a heads-up table against the champion', () => {
    const target = openedFrom(startTableHref({ bots: 'fill', preset: 'champion' }))
    expect(target.botPreset).toBe('champion')
    // The server makes a champion table heads-up with her alone; the link
    // need not say so, and a count would contradict it.
    expect(target.botSeats).toBeUndefined()
  })

  it('asks for no bots at a table for people', () => {
    const target = openedFrom(startTableHref({ bots: 'off' }))
    expect(target.botSeats).toBe(0)
    expect(target.botPreset).toBeUndefined()
  })
})

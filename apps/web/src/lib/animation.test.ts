import type { RoomEvent } from '@river/server'
import { describe, expect, it } from 'vitest'
import {
  type AnimationCue,
  CLIPS,
  cueForEvent,
  cuesForEvents,
  idleCueFor,
  idlePhaseFor,
  missingClips,
  resolveCues,
} from './animation'

const SEATS: Record<string, number> = { alice: 0, bob: 1, cara: 2 }
const seatOf = (playerId: string): number => SEATS[playerId] ?? -1

function acted(playerId: string, kind: string, to = 0): RoomEvent {
  const action = kind === 'raiseTo' ? { kind: 'raiseTo' as const, to } : { kind }
  return { kind: 'acted', playerId, action } as RoomEvent
}

describe('cueForEvent', () => {
  it('mucks on a fold and tosses chips on a call or raise', () => {
    expect(cueForEvent(acted('alice', 'fold'), seatOf)[0]?.clip).toBe('FOLD_muck')
    expect(cueForEvent(acted('alice', 'call'), seatOf)[0]?.clip).toBe('CHIP_toss')
    expect(cueForEvent(acted('alice', 'raiseTo', 2_400), seatOf)[0]?.clip).toBe('CHIP_toss')
  })

  it('stands a player up when they go all in', () => {
    expect(cueForEvent(acted('bob', 'allIn'), seatOf)[0]?.clip).toBe('ALLIN_standup')
  })

  it('plays nothing for a check rather than reaching for the nearest clip', () => {
    // The rig has no check gesture. A wrong one reads as a tell that means
    // nothing, which is worse than a player sitting still.
    expect(cueForEvent(acted('alice', 'check'), seatOf)).toEqual([])
  })

  it('treats an away or timed-out action the same as a played one', () => {
    const away = { kind: 'awayPlayed', playerId: 'cara', action: { kind: 'fold' } } as RoomEvent
    expect(cueForEvent(away, seatOf)[0]?.clip).toBe('FOLD_muck')
  })

  it('gives every blind poster a chip toss', () => {
    const blinds = {
      kind: 'blinds',
      posts: [
        { seat: 0, amount: 250 },
        { seat: 1, amount: 500 },
      ],
    } as RoomEvent
    expect(cueForEvent(blinds, seatOf).map((cue) => cue.seat)).toEqual([0, 1])
  })

  it('celebrates an uncontested pot and every showdown winner', () => {
    const uncontested = { kind: 'uncontested', playerId: 'bob', amount: 4_500 } as RoomEvent
    expect(cueForEvent(uncontested, seatOf)[0]).toMatchObject({ seat: 1, clip: 'REACT_win' })

    const showdown = {
      kind: 'showdown',
      awards: [
        { playerId: 'alice', amount: 3_000 },
        { playerId: 'cara', amount: 3_000 },
      ],
    } as RoomEvent
    expect(cueForEvent(showdown, seatOf).map((cue) => cue.seat)).toEqual([0, 2])
  })

  it('drops a cue for a player who is not seated', () => {
    expect(cueForEvent(acted('nobody', 'fold'), seatOf)).toEqual([])
  })

  it('ignores events that are not about a player doing something', () => {
    const between = { kind: 'between', handNumber: 4, countdownMs: 5_000 } as RoomEvent
    expect(cueForEvent(between, seatOf)).toEqual([])
  })
})

describe('resolveCues', () => {
  const cue = (seat: number, clip: AnimationCue['clip'], priority: number): AnimationCue => ({
    seat,
    clip,
    loop: false,
    delaySeconds: 0,
    priority,
  })

  it('keeps the highest priority cue when a seat gets several', () => {
    const resolved = resolveCues([cue(0, 'CHIP_toss', 20), cue(0, 'ALLIN_standup', 50)])
    expect(resolved.length).toBe(1)
    expect(resolved[0]?.clip).toBe('ALLIN_standup')
  })

  it('does not let event order decide which gesture a seat plays', () => {
    const forwards = resolveCues([cue(0, 'ALLIN_standup', 50), cue(0, 'CHIP_toss', 20)])
    const backwards = resolveCues([cue(0, 'CHIP_toss', 20), cue(0, 'ALLIN_standup', 50)])
    expect(forwards).toEqual(backwards)
  })

  it('keeps the first of two cues at equal priority, so a batch is stable', () => {
    const resolved = resolveCues([cue(0, 'REACT_win', 40), cue(0, 'REACT_lose', 40)])
    expect(resolved[0]?.clip).toBe('REACT_win')
  })

  it('returns one cue per seat, in seat order', () => {
    const resolved = resolveCues([cue(2, 'CHIP_toss', 20), cue(0, 'FOLD_muck', 30)])
    expect(resolved.map((entry) => entry.seat)).toEqual([0, 2])
  })

  it('handles an empty batch', () => {
    expect(resolveCues([])).toEqual([])
  })
})

describe('cuesForEvents', () => {
  it('resolves a whole snapshot into one gesture per seat', () => {
    const events = [
      acted('alice', 'call'),
      acted('bob', 'allIn'),
      acted('alice', 'fold'),
      { kind: 'uncontested', playerId: 'bob', amount: 9_000 } as RoomEvent,
    ]
    const cues = cuesForEvents(events, seatOf)
    expect(cues.map((cue) => [cue.seat, cue.clip])).toEqual([
      [0, 'FOLD_muck'],
      [1, 'ALLIN_standup'],
    ])
  })

  it('never blocks: every cue is fire and forget', () => {
    const cues = cuesForEvents([acted('alice', 'raiseTo', 500)], seatOf)
    for (const cue of cues) {
      expect(cue.loop).toBe(false)
      expect(cue.delaySeconds).toBe(0)
    }
  })
})

describe('idle', () => {
  it('loops, so a seat is never left frozen between hands', () => {
    expect(idleCueFor(3)).toMatchObject({ clip: 'IDLE_breathe', loop: true })
  })

  it('scatters the phase so nine players do not breathe in lockstep', () => {
    const phases = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(idlePhaseFor)
    expect(new Set(phases).size).toBe(9)
    for (const phase of phases) {
      expect(phase).toBeGreaterThanOrEqual(0)
      expect(phase).toBeLessThan(4)
    }
  })

  it('gives a seat the same phase every time, so a reconnect does not resync', () => {
    expect(idlePhaseFor(5)).toBe(idlePhaseFor(5))
  })
})

describe('missingClips', () => {
  it('names every clip a rig does not carry', () => {
    expect(missingClips([])).toEqual([...CLIPS])
    expect(missingClips([...CLIPS])).toEqual([])
  })

  it('reports the gap when a rig carries only some of the contract', () => {
    expect(missingClips(['IDLE_breathe', 'CHIP_toss'])).not.toContain('IDLE_breathe')
    expect(missingClips(['IDLE_breathe', 'CHIP_toss'])).toContain('FOLD_muck')
  })

  it('ignores clips the rig has that the contract does not name', () => {
    expect(missingClips([...CLIPS, 'SOME_extra_clip'])).toEqual([])
  })
})

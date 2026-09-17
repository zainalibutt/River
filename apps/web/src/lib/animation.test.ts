import type { RoomEvent } from '@river/server'
import { describe, expect, it } from 'vitest'
import {
  type AnimationCue,
  BLEND,
  CLIP_LAST_FRAME,
  CLIPS,
  cueForEvent,
  cuesForEvents,
  endsHand,
  IDLE_CLIP,
  idleCueFor,
  idlePhaseFor,
  missingClips,
  peekDelayFor,
  resolveCues,
} from './animation'

const SEATS: Record<string, number> = { alice: 0, bob: 1, cara: 2 }
const seatOf = (playerId: string): number => SEATS[playerId] ?? -1

function acted(playerId: string, kind: string, to = 0): RoomEvent {
  const action = kind === 'raiseTo' ? { kind: 'raiseTo' as const, to } : { kind }
  return { kind: 'acted', playerId, action } as RoomEvent
}

describe('the clip contract', () => {
  it('is exactly the seven clips the Silver export ships, each with a last frame', () => {
    expect([...CLIPS]).toEqual([
      'IDLE_thinking_readable',
      'CHECK_tap',
      'PEEK_card',
      'CHIP_toss',
      'ALLIN_standup',
      'SIT_enter',
      'LEAVE_getup',
    ])
    for (const clip of CLIPS) expect(CLIP_LAST_FRAME[clip]).toBeGreaterThan(0)
  })

  it('layers only the chip push, the one clip that starts where the idle already is', () => {
    expect(CLIPS.filter((clip) => BLEND[clip] === 'additive')).toEqual(['CHIP_toss'])
  })
})

describe('cueForEvent', () => {
  it('taps for a check, tosses chips on a call or raise, and stands for an all-in', () => {
    expect(cueForEvent(acted('alice', 'check'), seatOf)[0]?.clip).toBe('CHECK_tap')
    expect(cueForEvent(acted('alice', 'call'), seatOf)[0]?.clip).toBe('CHIP_toss')
    expect(cueForEvent(acted('alice', 'raiseTo', 2_400), seatOf)[0]?.clip).toBe('CHIP_toss')
    expect(cueForEvent(acted('bob', 'allIn'), seatOf)[0]?.clip).toBe('ALLIN_standup')
  })

  it('plays nothing for a fold rather than reaching for the nearest clip', () => {
    // This character has no fold gesture yet. A wrong one reads as a tell that
    // means nothing, which is worse than a player sitting still.
    expect(cueForEvent(acted('alice', 'fold'), seatOf)).toEqual([])
  })

  it('treats an away or timed-out action the same as a played one', () => {
    const away = { kind: 'awayPlayed', playerId: 'cara', action: { kind: 'check' } } as RoomEvent
    expect(cueForEvent(away, seatOf)[0]?.clip).toBe('CHECK_tap')
  })

  it('gives every blind poster a chip toss', () => {
    const blinds = {
      kind: 'blinds',
      posts: [
        { seat: 0, amount: 250 },
        { seat: 1, amount: 500 },
      ],
    } as RoomEvent
    expect(cueForEvent(blinds, seatOf).map((cue) => [cue.seat, cue.clip])).toEqual([
      [0, 'CHIP_toss'],
      [1, 'CHIP_toss'],
    ])
  })

  it('sits a player down and gets them up on the seat the event names', () => {
    const seated = { kind: 'seated', playerId: 'dana', seat: 5, stack: 10_000 } as RoomEvent
    const stood = { kind: 'stood', playerId: 'dana', seat: 5, stack: 9_000 } as RoomEvent
    expect(cueForEvent(seated, seatOf)).toMatchObject([{ seat: 5, clip: 'SIT_enter' }])
    expect(cueForEvent(stood, seatOf)).toMatchObject([{ seat: 5, clip: 'LEAVE_getup' }])
  })

  it('has everyone dealt in look at their cards, a beat apart', () => {
    const started = { kind: 'handStarted', handNumber: 3, dealerSeat: 0, commit: 'x' } as RoomEvent
    const cues = cueForEvent(started, seatOf, { seatsInHand: [0, 2, 5] })
    expect(cues.map((cue) => [cue.seat, cue.clip])).toEqual([
      [0, 'PEEK_card'],
      [2, 'PEEK_card'],
      [5, 'PEEK_card'],
    ])
    const delays = cues.map((cue) => cue.delaySeconds)
    expect(new Set(delays).size).toBe(3)
    for (const delay of delays) {
      expect(delay).toBeGreaterThanOrEqual(0.35)
      expect(delay).toBeLessThanOrEqual(1.55)
    }
    expect(peekDelayFor(2)).toBe(peekDelayFor(2))
    expect(cueForEvent(started, seatOf)).toEqual([])
  })

  it('plays nothing for wins, losses and busts while those gestures are not on the character', () => {
    const uncontested = { kind: 'uncontested', playerId: 'bob', amount: 4_500 } as RoomEvent
    const showdown = {
      kind: 'showdown',
      awards: [{ playerId: 'alice', amount: 3_000 }],
    } as RoomEvent
    const bust = { kind: 'bust', playerId: 'cara' } as RoomEvent
    expect(cueForEvent(uncontested, seatOf)).toEqual([])
    expect(cueForEvent(showdown, seatOf)).toEqual([])
    expect(cueForEvent(bust, seatOf)).toEqual([])
  })

  it('drops a cue for a player who is not seated', () => {
    expect(cueForEvent(acted('nobody', 'call'), seatOf)).toEqual([])
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
    const resolved = resolveCues([cue(0, 'CHECK_tap', 15), cue(0, 'PEEK_card', 15)])
    expect(resolved[0]?.clip).toBe('CHECK_tap')
  })

  it('returns one cue per seat, in seat order', () => {
    const resolved = resolveCues([cue(2, 'CHIP_toss', 20), cue(0, 'CHECK_tap', 15)])
    expect(resolved.map((entry) => entry.seat)).toEqual([0, 2])
  })

  it('handles an empty batch', () => {
    expect(resolveCues([])).toEqual([])
  })
})

describe('cuesForEvents', () => {
  it('lets leaving outrank anything else the same seat did in the batch', () => {
    const events = [
      acted('alice', 'call'),
      acted('bob', 'allIn'),
      { kind: 'stood', playerId: 'bob', seat: 1, stack: 0 } as RoomEvent,
    ]
    const cues = cuesForEvents(events, seatOf)
    expect(cues.map((cue) => [cue.seat, cue.clip])).toEqual([
      [0, 'CHIP_toss'],
      [1, 'LEAVE_getup'],
    ])
  })

  it('never blocks: a gesture is fire and forget', () => {
    const cues = cuesForEvents([acted('alice', 'raiseTo', 500)], seatOf)
    for (const cue of cues) {
      expect(cue.loop).toBe(false)
      expect(cue.delaySeconds).toBe(0)
    }
  })
})

describe('endsHand', () => {
  it('reads the hand record or the gap before the next hand as the end of a hand', () => {
    expect(endsHand([{ kind: 'between', handNumber: 4, countdownMs: 3_000 } as RoomEvent])).toBe(
      true,
    )
    expect(endsHand([{ kind: 'handRecorded', record: {} } as unknown as RoomEvent])).toBe(true)
    expect(endsHand([acted('alice', 'call')])).toBe(false)
  })
})

describe('idle', () => {
  it('loops the thinking idle, so a seat is never left frozen between hands', () => {
    expect(IDLE_CLIP).toBe('IDLE_thinking_readable')
    expect(idleCueFor(3)).toMatchObject({ clip: 'IDLE_thinking_readable', loop: true })
  })

  it('scatters the phase so eight players do not breathe in lockstep', () => {
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
    expect(missingClips(['IDLE_thinking_readable', 'CHIP_toss'])).toContain('SIT_enter')
    expect(missingClips(['IDLE_thinking_readable', 'CHIP_toss'])).not.toContain('CHIP_toss')
  })

  it('ignores clips the rig has that the contract does not name', () => {
    expect(missingClips([...CLIPS, 'FOLD_muck'])).toEqual([])
  })
})

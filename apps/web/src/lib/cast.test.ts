import { describe, expect, it } from 'vitest'
import { CAST, CAST_IDS, castFit, castFor, castPlan } from './cast.js'
import { PLAYER_SEATS } from './seat-accents.js'
import { SEAT_HEIGHT, TABLE_SURFACE_HEIGHT } from './venue.js'

/**
 * Who is at the table, and how they are put in a seat.
 *
 * Two things have to hold. The mix is a local drawing of a shared fact, so every client has
 * to draw it the same way: two players in one room must not disagree about who is sitting
 * opposite them. And the seats were built around one character, so anyone else has to be
 * fitted into them - a fit that is wrong is a woman sitting through the chair or with her
 * hands under the felt, and nothing else would say so.
 */
const ids = Array.from({ length: PLAYER_SEATS }, (_, seat) => `p${seat + 1}`)

describe('the cast', () => {
  it('gives every seat one of the characters, and the same one every time', () => {
    for (const id of ids) {
      const first = castFor(id, 'room-1')
      expect(CAST_IDS).toContain(first)
      for (let again = 0; again < 5; again += 1) expect(castFor(id, 'room-1')).toBe(first)
    }
  })

  it('mixes them: a table of eight is not eight of one', () => {
    const plan = castPlan(ids, 'room-1')
    expect(new Set(plan).size).toBe(2)
  })

  it('deals a different table in another room, and the same table in the same room', () => {
    const one = castPlan(ids, 'room-1').join(',')
    const two = castPlan(ids, 'room-2').join(',')
    expect(castPlan(ids, 'room-1').join(',')).toBe(one)
    expect(two).not.toBe(one)
  })

  it('leaves an emptied seat as it was, rather than recasting the table around it', () => {
    const seated = castPlan(ids, 'room-1')
    const emptied = [...ids]
    emptied[3] = 'seat-3'
    expect(castPlan(emptied, 'room-1', seated)).toEqual(seated)
  })

  it('casts a seat afresh when somebody else sits in it', () => {
    const seated = castPlan(ids, 'room-1')
    const taken = [...ids]
    taken[3] = 'somebody-else'
    const after = castPlan(taken, 'room-1', seated)
    expect(after[3]).toBe(castFor('somebody-else', 'room-1'))
    expect(after.filter((_, seat) => seat !== 3)).toEqual(seated.filter((_, seat) => seat !== 3))
  })

  it('spreads the two of them over many tables rather than favouring one', () => {
    let gold = 0
    const rooms = 200
    for (let room = 0; room < rooms; room += 1) {
      gold += castPlan(ids, `room-${room}`).filter((id) => id === 'gold').length
    }
    const share = gold / (rooms * PLAYER_SEATS)
    expect(share).toBeGreaterThan(0.4)
    expect(share).toBeLessThan(0.6)
  })

  it('deals a mix rather than a stripe', () => {
    // Seats are named in a row - p1, p2, p3 - and a hash whose last bit is only the parity
    // of its bytes turns that row into Silver, Gold, Silver, Gold, in every room. Half the
    // table being Gold is exactly what that failure looks like from a headcount, so this
    // counts tables instead: how often the whole ring alternates, and how much the size of
    // the mix moves.
    const rooms = 200
    let striped = 0
    const sizes = new Set<number>()
    for (let room = 0; room < rooms; room += 1) {
      const plan = castPlan(ids, `room-${room}`)
      sizes.add(plan.filter((id) => id === 'gold').length)
      if (plan.every((id, seat) => seat === 0 || id !== plan[seat - 1])) striped += 1
    }
    expect(striped / rooms).toBeLessThan(0.1)
    expect(sizes.size).toBeGreaterThan(3)
  })

  it('sits each of them on the seat, with the felt at the table top', () => {
    // The anchor the venue builds is Silver's: his stage scaled on to this table. What this
    // checks is the rule, at a made-up anchor as well as at his own - cast-asset.test.ts
    // checks it against the anchors that actually shipped.
    for (const anchorScale of [0.95755, 1, 0.5]) {
      for (const anchorLift of [0, 0.01]) {
        for (const id of CAST_IDS) {
          const character = CAST[id]
          const fit = castFit(character, anchorScale, anchorLift)
          const world = anchorScale * fit.scale
          const under = anchorLift + anchorScale * fit.lift
          expect(under + world * character.props.stage.felt).toBeCloseTo(TABLE_SURFACE_HEIGHT, 6)
          expect(under + world * character.props.stage.pan).toBeCloseTo(SEAT_HEIGHT, 6)
        }
      }
    }
  })

  it('leaves Silver alone in the seat that was built for him', () => {
    const anchorScale = (TABLE_SURFACE_HEIGHT - SEAT_HEIGHT) / (0.7935 - 0.4802)
    const fit = castFit(CAST.silver, anchorScale, SEAT_HEIGHT - anchorScale * 0.4802)
    expect(fit.scale).toBeCloseTo(1, 6)
    expect(fit.lift).toBeCloseTo(0, 6)
  })

  it('carries a stage, a peek, a stack and a chair for everyone in it', () => {
    for (const id of CAST_IDS) {
      const { props, accent, asset } = CAST[id]
      expect(asset.endsWith('.glb')).toBe(true)
      expect(accent.material.length).toBeGreaterThan(0)
      expect(props.stage.felt).toBeGreaterThan(props.stage.pan)
      expect(props.peek.length).toBe(2)
      expect(props.chipPush.length).toBeGreaterThan(3)
      expect(props.muckPush.length).toBeGreaterThan(3)
      for (const clip of ['SIT_enter', 'LEAVE_getup', 'ALLIN_standup']) {
        expect(props.chair[clip]?.length ?? 0).toBeGreaterThan(30)
      }
      // A chair that stands up should end up out of the way, and one that sits down tucked in.
      expect(props.chair.SIT_enter?.at(-1) ?? 1).toBeCloseTo(0, 3)
      expect(props.chair.LEAVE_getup?.at(-1) ?? 0).toBeGreaterThan(0.2)
    }
  })
})

/**
 * Who is at the table: the characters the browser seats, and which seat gets which.
 *
 * The Rooftop seated one man in all eight chairs, told apart only by the colour of his
 * lapels. There are two characters now - the native Silver and the native Gold - and a
 * private table is a mix of them: every bot is one or the other, in a colour of its own,
 * and the local player is whichever they are in the look that was accepted.
 *
 * The mix is hashed from the seat's own player and the room, rather than drawn at random,
 * so every client draws the same table: two people in the same room must not disagree about
 * who is sitting opposite them. The same player keeps the same character while the room
 * lasts, and a seat changes character only when somebody else sits in it.
 *
 * What each character carries here is what the scene cannot read off the file: where they
 * were authored to sit, which material a seat colour is painted on, and the prop and chair
 * tracks measured beside their clips.
 */
import { CHIP_PUSH_TRACK, CHIP_STACK_PLACE, HOLE_CARD_PEEK, PEEK_LAST_FRAME } from './seat-props'
import {
  GOLD_AUTHORED_FELT_Y,
  GOLD_AUTHORED_PAN_Y,
  GOLD_CHIP_PUSH_TRACK,
  GOLD_CHIP_STACK_PLACE,
  GOLD_HOLE_CARD_PEEK,
  GOLD_MUCK_PUSH_TRACK,
  GOLD_PEEK_LAST_FRAME,
} from './seat-props-gold'
import { CHAIR_BACK_AWAY } from './seat-transition-timing'
import { GOLD_CHAIR_BACK_AWAY } from './seat-transition-timing-gold'
import { SEAT_HEIGHT, TABLE_SURFACE_HEIGHT } from './venue'

export type CastId = 'silver' | 'gold'

export const CAST_IDS: readonly CastId[] = ['silver', 'gold']

/** The stage a character was authored on: the seat they rest on and the felt they reach. */
export interface CastStage {
  pan: number
  felt: number
}

export interface CastAccent {
  /** The exported material a seat's colour is painted on, by the name the export gives it. */
  material: string
  /** How much of that colour is emitted, so it reads from the gameplay camera. */
  emissive: number
  /**
   * Whether the colour has to replace what the material's own map says.
   *
   * His silk facing is a single near-black colour, so multiplying it by an accent is the
   * accent. Her dress carries a printed map, and a colour multiplied through it comes out
   * as that print in the dark; hers is taken to its own brightness first, so the dress is
   * the seat's colour with the fabric's shading still in it.
   */
  printed: boolean
}

/** The places and tracks measured beside a character's clips, in their own frame. */
export interface CastProps {
  stage: CastStage
  peek: readonly (readonly number[])[]
  peekLastFrame: number
  chipStack: { readonly rest: readonly number[]; readonly pushed: readonly number[] }
  chipPush: readonly number[]
  /** What the cards ride as they are mucked; his fold has no track, so his chips' will do. */
  muckPush: readonly number[]
  chair: Readonly<Record<string, readonly number[]>>
}

export interface CastCharacter {
  id: CastId
  name: string
  /** The file the browser loads, published beside the venue. */
  asset: string
  accent: CastAccent
  props: CastProps
}

export const CAST: Readonly<Record<CastId, CastCharacter>> = {
  silver: {
    id: 'silver',
    name: 'Silver',
    asset: '/assets/char_native_silver.glb',
    accent: { material: 'A11 silk facing PBR', emissive: 0.35, printed: false },
    props: {
      // His proof stage, which the seat anchor scales on to this table.
      stage: { pan: 0.4802, felt: 0.7935 },
      peek: HOLE_CARD_PEEK,
      peekLastFrame: PEEK_LAST_FRAME,
      chipStack: CHIP_STACK_PLACE,
      chipPush: CHIP_PUSH_TRACK,
      muckPush: CHIP_PUSH_TRACK,
      chair: CHAIR_BACK_AWAY,
    },
  },
  gold: {
    id: 'gold',
    name: 'Gold',
    asset: '/assets/char_native_gold.glb',
    accent: {
      material: 'river_native_gold_body.toigo_halter_dress_midi PBR',
      emissive: 0.1,
      printed: true,
    },
    props: {
      stage: { pan: GOLD_AUTHORED_PAN_Y, felt: GOLD_AUTHORED_FELT_Y },
      peek: GOLD_HOLE_CARD_PEEK,
      peekLastFrame: GOLD_PEEK_LAST_FRAME,
      chipStack: GOLD_CHIP_STACK_PLACE,
      chipPush: GOLD_CHIP_PUSH_TRACK,
      muckPush: GOLD_MUCK_PUSH_TRACK,
      chair: GOLD_CHAIR_BACK_AWAY,
    },
  },
}

/**
 * How a character goes into a seat anchor.
 *
 * The anchors were built around Silver: each one is placed, turned and scaled so that his
 * proof stage lands on this table. A character authored on another stage - Gold was
 * authored on this one, at its own size - goes in the same anchor and undoes as much of it
 * as they must, so that whoever is in the seat rests their weight on the seat's height and
 * meets the felt at the table's.
 *
 * `scale` and `lift` are the body's own, inside the anchor's frame.
 */
export function castFit(
  character: CastCharacter,
  anchorScale: number,
  anchorLift: number,
): { scale: number; lift: number } {
  const { pan, felt } = character.props.stage
  if (anchorScale === 0 || felt === pan) return { scale: 1, lift: 0 }
  // What the venue would scale this character by if the anchor were built for them.
  const world = (TABLE_SURFACE_HEIGHT - SEAT_HEIGHT) / (felt - pan)
  return {
    scale: world / anchorScale,
    lift: (SEAT_HEIGHT - world * pan - anchorLift) / anchorScale,
  }
}

/**
 * A 32-bit FNV-1a over the seat's player and the room, finished by an avalanche.
 *
 * Small, stable, and the same in every browser: the mix must not be a local decision. The
 * room is mixed in so a table of bots named the same way in two rooms is not the same table
 * of characters twice.
 *
 * The finisher is not decoration. FNV's last step is a multiply by an odd number, so the
 * hash's lowest bit is only the parity of the bytes that went into it - and seats named p1,
 * p2, p3 differ by one in that last byte. Reading the pick off that bit dealt Silver, Gold,
 * Silver, Gold straight round the table, in every room, which is a stripe rather than a mix.
 */
function hashOf(text: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x85ebca6b) >>> 0
  hash ^= hash >>> 13
  hash = Math.imul(hash, 0xc2b2ae35) >>> 0
  hash ^= hash >>> 16
  return hash >>> 0
}

/** Which character a seat's player is, from their id and the room's. */
export function castFor(seatId: string, room = ''): CastId {
  return (CAST_IDS[hashOf(`${room}:${seatId}`) % CAST_IDS.length] ?? 'silver') as CastId
}

/**
 * The character in each seat, by seat number.
 *
 * Empty seats keep whoever was last there rather than being drawn again: an empty seat
 * shows nobody, and rebuilding the table's bodies because a chair emptied would reset every
 * gesture in flight. `held` is the plan the table is already drawing.
 */
export function castPlan(
  seatIds: readonly string[],
  room = '',
  held: readonly CastId[] = [],
): readonly CastId[] {
  return seatIds.map((seatId, seat) => {
    if (seatId === '' || seatId.startsWith('seat-')) return held[seat] ?? castFor(seatId, room)
    return castFor(seatId, room)
  })
}

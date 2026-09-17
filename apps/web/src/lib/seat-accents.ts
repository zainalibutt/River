/**
 * The colour that tells one Silver from another.
 *
 * Every player at the table is currently the same Silver character. Until there is a
 * real cast, each opponent is told apart by recolouring the silk of his lapels, bow tie
 * and jacket button. The wool, the shirt and the skin are never touched, so he reads as
 * a man in a coloured dinner jacket trim rather than a neon figure. The local player
 * keeps the accepted look.
 *
 * Colours are handed out in seat order starting from the seat after the local player's,
 * so the same opponent keeps the same colour for as long as you sit where you are. A
 * spectator has no seat, and seat 0 stands in for one.
 *
 * This is a deliberately loud, temporary treatment for an eight-player table of one
 * character. It is not the look of the finished cast.
 */
export interface Accent {
  name: string
  hex: string
}

export const ACCENTS: readonly Accent[] = [
  { name: 'magenta', hex: '#ff2bd6' },
  { name: 'cyan', hex: '#14d8ff' },
  { name: 'amber', hex: '#ffb000' },
  { name: 'emerald', hex: '#12d67c' },
  { name: 'violet', hex: '#9254ff' },
  { name: 'red', hex: '#ff2d2d' },
  { name: 'ice blue', hex: '#bfeaff' },
]

export const PLAYER_SEATS = 8

/**
 * The exported material the accent replaces, by the name the export gives it.
 *
 * Matching on a name is only safe because the scene says so when nothing matched: a
 * renamed material would otherwise leave eight identical men and no error anywhere.
 */
export const ACCENT_MATERIAL = 'A11 silk facing PBR'

export function accentFor(
  seat: number,
  heroSeat: number | null,
  seats: number = PLAYER_SEATS,
): Accent | null {
  if (!Number.isInteger(seat) || seat < 0 || seat >= seats) return null
  const reference =
    heroSeat !== null && Number.isInteger(heroSeat) && heroSeat >= 0 && heroSeat < seats
      ? heroSeat
      : 0
  const offset = (seat - reference + seats) % seats
  if (offset === 0) return null
  return ACCENTS[offset - 1] ?? null
}

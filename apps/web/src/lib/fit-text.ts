/**
 * The font size at which a line of text fits the room it has.
 *
 * Text measured `needed` px wide at `base` px shrinks in proportion until it
 * fits `available` px, in half pixels so it settles rather than flickers. It
 * never grows past `base`, and never shrinks past `floor`: a name that cannot
 * fit even then keeps its ellipsis rather than becoming unreadable.
 */
export function fittedFontSize(
  base: number,
  available: number,
  needed: number,
  floor: number,
): number {
  if (!(needed > available) || available <= 0) return base
  const size = Math.floor(((base * available) / needed) * 2) / 2
  return Math.max(floor, Math.min(base, size))
}

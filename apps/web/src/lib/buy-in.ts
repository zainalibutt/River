export function affordableBuyIn(
  bankroll: number,
  minimumBuyIn: number,
  defaultBuyIn: number,
): number | null {
  if (!Number.isFinite(bankroll) || !Number.isSafeInteger(minimumBuyIn)) return null
  const available = Math.floor(bankroll)
  if (available < minimumBuyIn) return null
  return Math.min(available, defaultBuyIn)
}

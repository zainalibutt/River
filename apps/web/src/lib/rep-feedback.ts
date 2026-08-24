import type { RoomEvent } from '@river/server'

export interface RepFlash {
  id: string
  totalRep: number
  earningRatePercent: number
  levelUp: number
  handNumber: number
}

/**
 * REP surfaces as lightweight floating feedback at the end of a hand. It is
 * never a modal and never gates the next deal, so this only ever produces a
 * value to render beside the seat - it cannot block anything.
 */
export function repFlashFor(events: readonly RoomEvent[], selfId: string): RepFlash | null {
  for (const event of [...events].reverse()) {
    if (event.kind !== 'repAwarded') continue
    const mine = event.awards.find((award) => award.playerId === selfId)
    if (mine === undefined) return null
    return {
      id: `rep:${event.handNumber}:${selfId}`,
      totalRep: mine.totalRep,
      earningRatePercent: mine.earningRatePercent,
      levelUp: Math.max(0, mine.levelAfter - mine.levelBefore),
      handNumber: event.handNumber,
    }
  }
  return null
}

/** A modifier of exactly 100% is the baseline and is not worth saying. */
export function shouldShowRate(percent: number): boolean {
  return percent !== 100
}

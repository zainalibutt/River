import { DEFAULT_VENUE, isVenueId, type VenueId, venueFromParams } from './venue'

export type RoomTarget = {
  roomId: string
  inviteCode?: string
  expired: boolean
  venueId: VenueId
}

export const LAST_TABLE_KEY = 'river:last-table'
/**
 * How long a remembered table is worth going back to. Long enough to survive a
 * reload, a crash or a closed laptop lid; short enough that opening River
 * tomorrow is a fresh table rather than a resurrection.
 */
export const LAST_TABLE_TTL_MS = 12 * 60 * 60 * 1000

export type RememberedTable = {
  roomId: string
  inviteCode?: string
  venueId: VenueId
  atMs: number
}

export function rememberedTable(): RememberedTable | null {
  try {
    const raw = window.localStorage.getItem(LAST_TABLE_KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as Partial<RememberedTable>
    if (typeof parsed.roomId !== 'string' || typeof parsed.atMs !== 'number') return null
    if (Date.now() - parsed.atMs > LAST_TABLE_TTL_MS) return null
    return {
      roomId: parsed.roomId,
      ...(typeof parsed.inviteCode === 'string' ? { inviteCode: parsed.inviteCode } : {}),
      venueId: isVenueId(parsed.venueId) ? parsed.venueId : DEFAULT_VENUE,
      atMs: parsed.atMs,
    }
  } catch {
    // Private browsing, cleared storage, or a value from an older shape. A
    // remembered table is a convenience; failing to read one is not an error.
    return null
  }
}

/**
 * Which table to open.
 *
 * This used to mint a fresh random room id on every single page load, because
 * nothing ever wrote the room into the address bar - so a reload did not
 * rejoin your table, it abandoned it and started another. The seat you left
 * behind holds your whole buy-in until the reconnect grace expires, so two
 * reloads spent a bankroll and the third sit was refused for insufficient
 * funds. The chips were never lost; they were just somewhere you could no
 * longer reach, at a table with no door back to it.
 *
 * The URL wins, then a table remembered from this browser, then a new one.
 */
export function initialRoomTarget(): RoomTarget {
  if (typeof window === 'undefined')
    return { roomId: 'river-table', expired: false, venueId: DEFAULT_VENUE }
  const params = new URLSearchParams(window.location.search)
  const expired = params.has('error') || params.has('error_code')
  const fromUrl = params.get('room')?.trim()
  if (fromUrl !== undefined && fromUrl.length > 0) {
    const inviteCode = params.get('code')?.trim() || undefined
    return {
      roomId: fromUrl,
      ...(inviteCode === undefined ? {} : { inviteCode }),
      expired,
      venueId: venueFromParams(params),
    }
  }
  const remembered = rememberedTable()
  if (remembered !== null) {
    return {
      roomId: remembered.roomId,
      ...(remembered.inviteCode === undefined ? {} : { inviteCode: remembered.inviteCode }),
      expired,
      venueId: remembered.venueId,
    }
  }
  return {
    roomId: `river-${crypto.randomUUID().slice(0, 8)}`,
    expired,
    venueId: venueFromParams(params),
  }
}

import { type BotTablePreset, isBotTablePreset } from '@river/engine'
import { DEFAULT_VENUE, isVenueId, type VenueId, venueFromParams } from './venue'

export type RoomTarget = {
  roomId: string
  inviteCode?: string
  expired: boolean
  venueId: VenueId
  botSeats?: number
  botPreset?: BotTablePreset
}

export const LAST_TABLE_KEY = 'river:last-table'
/** Where a table lives. The room and its code are remembered, not shown. */
export const TABLE_PATH = '/table'
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
 * Remember the table this browser is sitting at, and keep the address bar to
 * `/table`.
 *
 * The room and its code used to ride in the address bar, so that a reload could
 * find the seat holding your buy-in. They are kept here instead, where reloading
 * `/table` finds them, and the address is left short. A browser that refuses to
 * store them gets the full address, as before, because for that browser `/table`
 * on its own would open a new table and strand the seat.
 *
 * replaceState rather than pushState: the back button should leave River, not
 * walk backwards through your own reloads.
 */
export function rememberTable(table: Omit<RememberedTable, 'atMs'>): void {
  const address = storeTable(table) ? TABLE_PATH : tableAddress(table)
  try {
    const here = new URL(window.location.href)
    if (`${here.pathname}${here.search}` !== address) {
      window.history.replaceState(null, '', address)
    }
  } catch {
    // History can be blocked. That costs a rejoin, not a game.
  }
}

/** The long form of a table's address, which opens it in any browser. */
export function tableAddress(table: Omit<RememberedTable, 'atMs'>): string {
  const query = new URLSearchParams({ room: table.roomId })
  if (table.inviteCode !== undefined) query.set('code', table.inviteCode)
  query.set('venue', table.venueId)
  return `${TABLE_PATH}?${query.toString()}`
}

/** Whether this browser kept the table. */
function storeTable(table: Omit<RememberedTable, 'atMs'>): boolean {
  try {
    window.localStorage.setItem(
      LAST_TABLE_KEY,
      JSON.stringify({ ...table, atMs: Date.now() } satisfies RememberedTable),
    )
    return true
  } catch {
    // Private browsing, or storage that is full or blocked.
    return false
  }
}

/** The shape every invite code is minted in: six letters and digits. */
const INVITE_CODE = /^[A-Za-z0-9]{6}$/

/**
 * Where a short link led. `unreachable` is kept apart from `closed` on purpose:
 * a server that could not be asked has not said the table is gone.
 */
export type ShortLinkOutcome =
  | { kind: 'open'; address: string }
  | { kind: 'closed' }
  | { kind: 'unreachable' }

/**
 * Follow a short link, `/t/:code`.
 *
 * The code is all the link carries, so the server is asked which live table it
 * belongs to. That table is remembered, and `/table` then opens it the way a
 * reload would - the long address never appears. A browser that will not
 * remember it is sent to the long address instead, which works anywhere.
 */
export async function followShortLink(
  code: string,
  request: typeof fetch = fetch,
): Promise<ShortLinkOutcome> {
  const inviteCode = code.trim().toUpperCase()
  if (!INVITE_CODE.test(inviteCode)) return { kind: 'closed' }
  let body: unknown
  try {
    const response = await request(`/api/tables/by-code/${inviteCode}`, { cache: 'no-store' })
    if (response.status === 404 || response.status === 400) return { kind: 'closed' }
    if (!response.ok) return { kind: 'unreachable' }
    body = await response.json()
  } catch {
    return { kind: 'unreachable' }
  }
  if (typeof body !== 'object' || body === null || !('roomId' in body)) {
    return { kind: 'unreachable' }
  }
  const { roomId } = body
  const venue = 'venueId' in body && typeof body.venueId === 'string' ? body.venueId : undefined
  if (typeof roomId !== 'string' || roomId.length === 0) return { kind: 'unreachable' }
  const table = { roomId, inviteCode, venueId: isVenueId(venue) ? venue : DEFAULT_VENUE }
  return { kind: 'open', address: storeTable(table) ? TABLE_PATH : tableAddress(table) }
}

/** The link INVITE copies: the site, then the table's code. */
export function shortTableLink(inviteCode: string, origin: string): string {
  return `${origin}/t/${inviteCode}`
}

/** A short link's path, wherever it was pasted from. */
const SHORT_LINK_PATH = /\/t\/([A-Za-z0-9]{6})\/?$/

/**
 * Where a pasted invite link should go: a short link to the page that finds its
 * table, and a long one - shared before short links existed, or from before the
 * menu, when the table was the whole site - straight to the table it names.
 * Null when the link names no table. Throws on text that is not a link at all.
 */
export function inviteDestination(pasted: string, origin: string): string | null {
  const url = new URL(pasted, origin)
  const short = SHORT_LINK_PATH.exec(url.pathname)?.[1]
  if (short !== undefined) return `/t/${short.toUpperCase()}`
  const room = url.searchParams.get('room')
  const code = url.searchParams.get('code')
  if (room === null || code === null) return null
  const venue = url.searchParams.get('venue')
  const query = new URLSearchParams({ room, code })
  if (venue !== null) query.set('venue', venue)
  return `${TABLE_PATH}?${query.toString()}`
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
  const botSeats = params.get('bots') === 'off' ? 0 : params.get('bots') === 'fill' ? 7 : undefined
  const requestedPreset = params.get('strength')
  const botPreset = isBotTablePreset(requestedPreset) ? requestedPreset : undefined
  const botSettings = {
    ...(botSeats === undefined ? {} : { botSeats }),
    ...(botPreset === undefined ? {} : { botPreset }),
  }
  const fromUrl = params.get('room')?.trim()
  if (fromUrl !== undefined && fromUrl.length > 0) {
    const inviteCode = params.get('code')?.trim() || undefined
    return {
      roomId: fromUrl,
      ...(inviteCode === undefined ? {} : { inviteCode }),
      expired,
      venueId: venueFromParams(params),
      ...botSettings,
    }
  }
  const remembered = params.get('new') === '1' ? null : rememberedTable()
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
    ...botSettings,
  }
}

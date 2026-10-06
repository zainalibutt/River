import { type ApiRoute, apiJson } from './api-routes.js'
import type { VenueId } from './protocol.js'

/** Where an invite code leads while somebody is at the table. */
export interface LiveTable {
  roomId: string
  venueId: VenueId
}

/** What resolving a code needs from the room hub, and all it can see of it. */
export interface TableDirectory {
  liveTableForInviteCode(code: string): LiveTable | null
}

const PREFIX = '/api/tables/by-code/'
/** The shape every invite code is minted in: six letters and digits. */
const INVITE_CODE = /^[A-Za-z0-9]{6}$/

/**
 * GET /api/tables/by-code/:code - the live table behind a short link.
 *
 * The answer names the room and its venue and nothing else. The caller already
 * has the code, and nothing more about a private table is theirs to see until
 * they sit down at it. A table everyone has left reads the same as a code that
 * never existed: both have closed, as far as the person holding the link is
 * concerned.
 */
export function tableLinkRoute(tables: TableDirectory): ApiRoute {
  return {
    prefix: PREFIX,
    async handle(request) {
      const code = inviteCodeIn(new URL(request.url).pathname.slice(PREFIX.length))
      if (code === null) return apiJson({ error: 'That is not a table code.' }, 400)
      const table = tables.liveTableForInviteCode(code)
      if (table === null) return apiJson({ error: 'That table has closed.' }, 404)
      return apiJson({ roomId: table.roomId, venueId: table.venueId })
    },
  }
}

function inviteCodeIn(segment: string): string | null {
  let code: string
  try {
    code = decodeURIComponent(segment)
  } catch {
    return null
  }
  return INVITE_CODE.test(code) ? code.toUpperCase() : null
}

import {
  decideRequest,
  friendPair,
  isLive,
  type RequestRefusal,
  refusalCopy,
} from '@/lib/friends-rules'

/**
 * Friends, read and changed with the service key on behalf of one verified player.
 *
 * Every rule lives in friends-rules.ts; this is the reading and writing around it. Only
 * saved accounts take part, players are found by their exact chosen name and nothing
 * else, and a friend's balance and whether they are at a table are the only things a
 * friend can see. Records stay private.
 */

export interface FriendsRest {
  supabaseUrl: string
  serviceRoleKey: string
}

export interface FriendView {
  playerId: string
  name: string
  balance: number | null
  atTable: boolean
}

export interface RequestView {
  id: number
  playerId: string
  name: string
  createdAtMs: number
}

export interface InviteView {
  id: number
  fromName: string
  inviteCode: string
  createdAtMs: number
}

export interface FriendsState {
  friends: FriendView[]
  incoming: RequestView[]
  outgoing: RequestView[]
  blocked: { playerId: string; name: string }[]
  invites: InviteView[]
}

export type FriendAction =
  | { kind: 'request'; name: string }
  | { kind: 'accept'; requestId: number }
  | { kind: 'decline'; requestId: number }
  | { kind: 'cancel'; requestId: number }
  | { kind: 'remove'; playerId: string }
  | { kind: 'block'; playerId: string }
  | { kind: 'unblock'; playerId: string }
  | { kind: 'invite'; playerId: string; inviteCode: string }

export type ActionResult = { ok: true; message?: string } | { ok: false; message: string }

/** Invitations older than this are not shown: a table is a now thing. */
const INVITE_SHOWN_MS = 2 * 60 * 60 * 1000

type Row = Record<string, unknown>

function client(rest: FriendsRest) {
  const base = `${rest.supabaseUrl.replace(/\/$/, '')}/rest/v1`
  const headers = {
    apikey: rest.serviceRoleKey,
    authorization: `Bearer ${rest.serviceRoleKey}`,
    'content-type': 'application/json',
    accept: 'application/json',
  }
  const call = async (path: string, init: RequestInit = {}): Promise<Row[]> => {
    const response = await fetch(`${base}/${path}`, {
      ...init,
      headers: { ...headers, prefer: 'return=representation', ...(init.headers ?? {}) },
      cache: 'no-store',
      signal: AbortSignal.timeout(6_000),
    })
    if (!response.ok) throw new Error(`friends ${init.method ?? 'GET'} ${path} ${response.status}`)
    const text = await response.text()
    return text === '' ? [] : (JSON.parse(text) as Row[])
  }
  return {
    get: (path: string) => call(path),
    post: (path: string, body: unknown) =>
      call(path, { method: 'POST', body: JSON.stringify(body) }),
    patch: (path: string, body: unknown) =>
      call(path, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (path: string) => call(path, { method: 'DELETE' }),
  }
}

const inList = (ids: readonly string[]) => `in.(${ids.map((id) => `"${id}"`).join(',')})`
const ms = (value: unknown) => Date.parse(String(value))

async function namesOf(api: ReturnType<typeof client>, ids: readonly string[]) {
  if (ids.length === 0) return new Map<string, string>()
  const rows = await api.get(`players?select=id,display_name&id=${inList(ids)}`)
  return new Map(rows.map((row) => [String(row.id), String(row.display_name ?? 'Player')]))
}

export async function readFriends(
  rest: FriendsRest,
  me: string,
  nowMs: number,
): Promise<FriendsState> {
  const api = client(rest)
  const [pairs, requests, blocks, invites] = await Promise.all([
    api.get(`friendships?select=player_a,player_b&or=(player_a.eq.${me},player_b.eq.${me})`),
    api.get(
      `friend_requests?select=id,from_player,to_player,created_at&status=eq.pending&or=(from_player.eq.${me},to_player.eq.${me})&order=created_at.desc`,
    ),
    api.get(`player_blocks?select=blocked&blocker=eq.${me}`),
    api.get(
      `table_invites?select=id,from_player,invite_code,created_at&to_player=eq.${me}&created_at=gte.${new Date(nowMs - INVITE_SHOWN_MS).toISOString()}&order=created_at.desc&limit=5`,
    ),
  ])
  const friendIds = pairs.map((row) => String(row.player_a === me ? row.player_b : row.player_a))
  const live = requests.filter((row) => isLive(ms(row.created_at), nowMs))
  const others = [
    ...friendIds,
    ...live.map((row) => String(row.from_player === me ? row.to_player : row.from_player)),
    ...blocks.map((row) => String(row.blocked)),
    ...invites.map((row) => String(row.from_player)),
  ]
  const [names, balances, seated] = await Promise.all([
    namesOf(api, [...new Set(others)]),
    friendIds.length === 0
      ? Promise.resolve([])
      : api.get(`player_balances?select=player_id,balance&player_id=${inList(friendIds)}`),
    friendIds.length === 0
      ? Promise.resolve([])
      : api.get(`table_seatings?select=player_id&closed_at=is.null&player_id=${inList(friendIds)}`),
  ])
  const balanceOf = new Map(balances.map((row) => [String(row.player_id), Number(row.balance)]))
  const atTable = new Set(seated.map((row) => String(row.player_id)))
  const name = (id: string) => names.get(id) ?? 'Player'
  const request = (row: Row, other: string): RequestView => ({
    id: Number(row.id),
    playerId: other,
    name: name(other),
    createdAtMs: ms(row.created_at),
  })
  return {
    friends: friendIds
      .map((id) => ({
        playerId: id,
        name: name(id),
        balance: balanceOf.get(id) ?? null,
        atTable: atTable.has(id),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    incoming: live
      .filter((row) => row.to_player === me)
      .map((row) => request(row, String(row.from_player))),
    outgoing: live
      .filter((row) => row.from_player === me)
      .map((row) => request(row, String(row.to_player))),
    blocked: blocks.map((row) => ({
      playerId: String(row.blocked),
      name: name(String(row.blocked)),
    })),
    invites: invites.map((row) => ({
      id: Number(row.id),
      fromName: name(String(row.from_player)),
      inviteCode: String(row.invite_code),
      createdAtMs: ms(row.created_at),
    })),
  }
}

async function areFriends(api: ReturnType<typeof client>, a: string, b: string) {
  const pair = friendPair(a, b)
  const rows = await api.get(
    `friendships?select=player_a&player_a=eq.${pair.player_a}&player_b=eq.${pair.player_b}`,
  )
  return rows.length > 0
}

async function blockedEitherWay(api: ReturnType<typeof client>, a: string, b: string) {
  const rows = await api.get(
    `player_blocks?select=blocker&or=(and(blocker.eq.${a},blocked.eq.${b}),and(blocker.eq.${b},blocked.eq.${a}))`,
  )
  return rows.length > 0
}

/** The request a player answers must be addressed to them and still open. */
async function openRequest(
  api: ReturnType<typeof client>,
  id: number,
  field: 'to_player' | 'from_player',
  me: string,
) {
  const rows = await api.get(
    `friend_requests?select=id,from_player,to_player,created_at&id=eq.${id}&${field}=eq.${me}&status=eq.pending`,
  )
  return rows[0] ?? null
}

export async function actOnFriends(
  rest: FriendsRest,
  me: string,
  action: FriendAction,
  nowMs: number,
): Promise<ActionResult> {
  const api = client(rest)
  const now = new Date(nowMs).toISOString()
  switch (action.kind) {
    case 'request': {
      const name = action.name.trim()
      if (!/^[A-Za-z0-9_]{3,16}$/.test(name))
        return { ok: false, message: 'No player by that name.' }
      // Exact, case-insensitive, and only a name somebody has chosen: no partial search.
      const found = await api.get(
        `players?select=id&name_claimed_at=not.is.null&display_name=ilike.${encodeURIComponent(name.replace(/_/g, '\\_'))}`,
      )
      const target = found[0]
      if (target === undefined) return { ok: false, message: 'No player by that name.' }
      const toId = String(target.id)
      const [friends, blocked, between, sent] = await Promise.all([
        areFriends(api, me, toId),
        blockedEitherWay(api, me, toId),
        api.get(
          `friend_requests?select=id,created_at&status=eq.pending&or=(and(from_player.eq.${me},to_player.eq.${toId}),and(from_player.eq.${toId},to_player.eq.${me}))`,
        ),
        api.get(
          `friend_requests?select=created_at,status,to_player,responded_at&from_player=eq.${me}&created_at=gte.${new Date(nowMs - 31 * 24 * 3_600_000).toISOString()}`,
        ),
      ])
      const openBetween = between.some((row) => isLive(ms(row.created_at), nowMs))
      const decision = decideRequest({
        fromId: me,
        toId,
        nowMs,
        alreadyFriends: friends,
        blocked,
        openBetween,
        sent: sent.map((row) => ({
          createdAtMs: ms(row.created_at),
          status: String(row.status),
          toId: String(row.to_player),
          respondedAtMs: row.responded_at === null ? null : ms(row.responded_at),
        })),
      })
      if (decision.kind === 'refuse')
        return { ok: false, message: refusalCopy(decision.reason as RequestRefusal) }
      if (decision.kind === 'silent') return { ok: true, message: 'Request sent.' }
      // A lapsed request between the two would still hold the one-open-request index.
      for (const row of between) {
        await api.patch(`friend_requests?id=eq.${row.id}`, {
          status: 'cancelled',
          responded_at: now,
        })
      }
      await api.post('friend_requests', { from_player: me, to_player: toId })
      return { ok: true, message: 'Request sent.' }
    }
    case 'accept': {
      const row = await openRequest(api, action.requestId, 'to_player', me)
      if (row === null || !isLive(ms(row.created_at), nowMs)) {
        return { ok: false, message: 'That request has lapsed.' }
      }
      await api.patch(`friend_requests?id=eq.${row.id}`, { status: 'accepted', responded_at: now })
      await api.post(
        'friendships?on_conflict=player_a,player_b',
        friendPair(me, String(row.from_player)),
      )
      return { ok: true }
    }
    case 'decline':
    case 'cancel': {
      const field = action.kind === 'decline' ? 'to_player' : 'from_player'
      const row = await openRequest(api, action.requestId, field, me)
      if (row === null) return { ok: true }
      await api.patch(`friend_requests?id=eq.${row.id}`, {
        status: action.kind === 'decline' ? 'declined' : 'cancelled',
        responded_at: now,
      })
      return { ok: true }
    }
    case 'remove': {
      const pair = friendPair(me, action.playerId)
      await api.remove(`friendships?player_a=eq.${pair.player_a}&player_b=eq.${pair.player_b}`)
      return { ok: true }
    }
    case 'block': {
      if (action.playerId === me) return { ok: false, message: 'You cannot block yourself.' }
      const pair = friendPair(me, action.playerId)
      await api.post('player_blocks?on_conflict=blocker,blocked', {
        blocker: me,
        blocked: action.playerId,
      })
      await api.remove(`friendships?player_a=eq.${pair.player_a}&player_b=eq.${pair.player_b}`)
      await api.patch(
        `friend_requests?status=eq.pending&or=(and(from_player.eq.${me},to_player.eq.${action.playerId}),and(from_player.eq.${action.playerId},to_player.eq.${me}))`,
        { status: 'cancelled', responded_at: now },
      )
      return { ok: true }
    }
    case 'unblock': {
      await api.remove(`player_blocks?blocker=eq.${me}&blocked=eq.${action.playerId}`)
      return { ok: true }
    }
    case 'invite': {
      if (!/^[A-Z0-9]{4,12}$/.test(action.inviteCode))
        return { ok: false, message: 'That table has no code.' }
      if (!(await areFriends(api, me, action.playerId)))
        return { ok: false, message: 'Only friends can be invited.' }
      // Blocked: the invitation is quietly not sent.
      if (await blockedEitherWay(api, me, action.playerId))
        return { ok: true, message: 'Invitation sent.' }
      await api.post('table_invites', {
        from_player: me,
        to_player: action.playerId,
        invite_code: action.inviteCode,
      })
      return { ok: true, message: 'Invitation sent.' }
    }
  }
}

/** A request body, checked: anything else is refused before it reaches the database. */
export function friendActionFrom(body: unknown): FriendAction | null {
  if (typeof body !== 'object' || body === null) return null
  const value = body as Record<string, unknown>
  const uuid = (input: unknown) =>
    typeof input === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input)
  switch (value.kind) {
    case 'request':
      return typeof value.name === 'string' ? { kind: 'request', name: value.name } : null
    case 'accept':
    case 'decline':
    case 'cancel':
      return Number.isSafeInteger(value.requestId)
        ? { kind: value.kind, requestId: Number(value.requestId) }
        : null
    case 'remove':
    case 'block':
    case 'unblock':
      return uuid(value.playerId) ? { kind: value.kind, playerId: String(value.playerId) } : null
    case 'invite':
      return uuid(value.playerId) && typeof value.inviteCode === 'string'
        ? { kind: 'invite', playerId: String(value.playerId), inviteCode: value.inviteCode }
        : null
    default:
      return null
  }
}

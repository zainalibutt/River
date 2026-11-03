import { createHash, randomBytes } from 'node:crypto'

// Keys for the bot API. A key is shown once, when it is made; only its SHA-256
// hash is kept, so a leaked table gives nobody a working key. A player holds a
// few active keys at most and can revoke any of them.

/** The most active keys one player may hold. */
export const BOT_API_MAX_KEYS = 5
const KEY = /^rvb_[A-Za-z0-9_-]{43}$/

export interface BotApiKeyRecord {
  readonly id: string
  readonly label: string
  readonly createdAt: string
  readonly lastUsedAt: string | null
  readonly revokedAt: string | null
}

export interface BotApiKeyOwner {
  readonly keyId: string
  readonly playerId: string
}

export type BotApiKeyCreated =
  | { readonly ok: true; readonly key: string; readonly record: BotApiKeyRecord }
  | { readonly ok: false; readonly error: string }

export interface BotApiKeyStore {
  create(playerId: string, label: string): Promise<BotApiKeyCreated>
  /**
   * The key a token is and the player who holds it, if it is a live key; null
   * otherwise. The API counts hands and keeps reads by player, so a player's
   * keys share one daily limit.
   */
  verify(token: string): Promise<BotApiKeyOwner | null>
  list(playerId: string): Promise<BotApiKeyRecord[]>
  /** False when the player holds no such live key. */
  revoke(playerId: string, keyId: string): Promise<boolean>
}

/** A fresh key: a prefix that says what it is, then 32 random bytes. */
export function newBotApiKey(): string {
  return `rvb_${randomBytes(32).toString('base64url')}`
}

export function botApiKeyHash(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

export function isBotApiKeyShape(token: string): boolean {
  return KEY.test(token)
}

/** A label as stored: trimmed, printable, at most 40 characters. */
export function botApiKeyLabel(label: unknown): string {
  return typeof label === 'string'
    ? label
        .replace(/[^\x20-\x7e]/g, '')
        .trim()
        .slice(0, 40)
    : ''
}

/** Keys kept in memory: for tests, and for a server run without a database. */
export class MemoryBotApiKeyStore implements BotApiKeyStore {
  private readonly rows: {
    id: string
    playerId: string
    hash: string
    label: string
    createdAt: string
    lastUsedAt: string | null
    revokedAt: string | null
  }[] = []
  private ids = 0

  constructor(private readonly now: () => number = Date.now) {}

  async create(playerId: string, label: string): Promise<BotApiKeyCreated> {
    const live = this.rows.filter((row) => row.playerId === playerId && row.revokedAt === null)
    if (live.length >= BOT_API_MAX_KEYS) {
      return { ok: false, error: `revoke a key first; ${BOT_API_MAX_KEYS} is the most` }
    }
    const key = newBotApiKey()
    this.ids += 1
    const row = {
      id: `key-${this.ids}`,
      playerId,
      hash: botApiKeyHash(key),
      label: botApiKeyLabel(label),
      createdAt: new Date(this.now()).toISOString(),
      lastUsedAt: null,
      revokedAt: null,
    }
    this.rows.push(row)
    return { ok: true, key, record: record(row) }
  }

  async verify(token: string): Promise<BotApiKeyOwner | null> {
    if (!isBotApiKeyShape(token)) return null
    const hash = botApiKeyHash(token)
    const row = this.rows.find((entry) => entry.hash === hash && entry.revokedAt === null)
    if (row === undefined) return null
    row.lastUsedAt = new Date(this.now()).toISOString()
    return { keyId: row.id, playerId: row.playerId }
  }

  async list(playerId: string): Promise<BotApiKeyRecord[]> {
    return this.rows.filter((row) => row.playerId === playerId).map(record)
  }

  async revoke(playerId: string, keyId: string): Promise<boolean> {
    const row = this.rows.find(
      (entry) => entry.id === keyId && entry.playerId === playerId && entry.revokedAt === null,
    )
    if (row === undefined) return false
    row.revokedAt = new Date(this.now()).toISOString()
    return true
  }
}

function record(row: {
  id: string
  label: string
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}): BotApiKeyRecord {
  return {
    id: row.id,
    label: row.label,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
  }
}

export interface SupabaseBotApiKeyStoreOptions {
  readonly supabaseUrl: string
  readonly serviceRoleKey: string
  readonly fetch?: typeof fetch
  readonly timeoutMs?: number
  /** How long a verified key is trusted before the table is asked again. */
  readonly cacheMs?: number
  readonly now?: () => number
}

/**
 * Keys in public.bot_api_keys, through PostgREST with the service role. A
 * verified key is remembered for a minute, so a client playing hand after hand
 * costs one lookup a minute; a revoked key stops working within that minute.
 */
export class SupabaseBotApiKeyStore implements BotApiKeyStore {
  private readonly baseUrl: string
  private readonly serviceRoleKey: string
  private readonly request: typeof fetch
  private readonly timeoutMs: number
  private readonly cacheMs: number
  private readonly now: () => number
  private readonly verified = new Map<string, { owner: BotApiKeyOwner; untilMs: number }>()

  constructor(options: SupabaseBotApiKeyStoreOptions) {
    this.baseUrl = options.supabaseUrl.replace(/\/$/, '')
    this.serviceRoleKey = options.serviceRoleKey
    this.request = options.fetch ?? fetch
    this.timeoutMs = options.timeoutMs ?? 8_000
    this.cacheMs = options.cacheMs ?? 60_000
    this.now = options.now ?? Date.now
  }

  async create(playerId: string, label: string): Promise<BotApiKeyCreated> {
    const live = this.table()
    live.searchParams.set('select', 'id')
    live.searchParams.set('player_id', `eq.${playerId}`)
    live.searchParams.set('revoked_at', 'is.null')
    const rows = await this.json(await this.send(live))
    if (Array.isArray(rows) && rows.length >= BOT_API_MAX_KEYS) {
      return { ok: false, error: `revoke a key first; ${BOT_API_MAX_KEYS} is the most` }
    }
    const key = newBotApiKey()
    const response = await this.send(this.table(), {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        player_id: playerId,
        key_hash: botApiKeyHash(key),
        label: botApiKeyLabel(label),
      }),
    })
    const created = await this.json(response)
    const row = Array.isArray(created) ? created[0] : undefined
    return { ok: true, key, record: parseRecord(row) }
  }

  async verify(token: string): Promise<BotApiKeyOwner | null> {
    if (!isBotApiKeyShape(token)) return null
    const hash = botApiKeyHash(token)
    const cached = this.verified.get(hash)
    if (cached !== undefined && cached.untilMs > this.now()) return cached.owner
    const url = this.table()
    url.searchParams.set('select', 'id,player_id')
    url.searchParams.set('key_hash', `eq.${hash}`)
    url.searchParams.set('revoked_at', 'is.null')
    const rows = await this.json(await this.send(url))
    const row = (Array.isArray(rows) ? rows[0] : undefined) as
      | { id?: unknown; player_id?: unknown }
      | undefined
    const id = row?.id
    if (typeof id !== 'string' || typeof row?.player_id !== 'string') {
      this.verified.delete(hash)
      return null
    }
    const owner = { keyId: id, playerId: row.player_id }
    this.verified.set(hash, { owner, untilMs: this.now() + this.cacheMs })
    const touch = this.table()
    touch.searchParams.set('id', `eq.${id}`)
    // A last-used stamp that fails to write is no reason to refuse the key.
    await this.send(touch, {
      method: 'PATCH',
      body: JSON.stringify({ last_used_at: new Date(this.now()).toISOString() }),
    }).catch(() => undefined)
    return owner
  }

  async list(playerId: string): Promise<BotApiKeyRecord[]> {
    const url = this.table()
    url.searchParams.set('select', 'id,label,created_at,last_used_at,revoked_at')
    url.searchParams.set('player_id', `eq.${playerId}`)
    url.searchParams.set('order', 'created_at.desc')
    const rows = await this.json(await this.send(url))
    return Array.isArray(rows) ? rows.map(parseRecord) : []
  }

  async revoke(playerId: string, keyId: string): Promise<boolean> {
    if (!/^[0-9a-f-]{36}$/.test(keyId)) return false
    const url = this.table()
    url.searchParams.set('id', `eq.${keyId}`)
    url.searchParams.set('player_id', `eq.${playerId}`)
    url.searchParams.set('revoked_at', 'is.null')
    const response = await this.send(url, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ revoked_at: new Date(this.now()).toISOString() }),
    })
    const rows = await this.json(response)
    this.verified.clear()
    return Array.isArray(rows) && rows.length === 1
  }

  private table(): URL {
    return new URL(`${this.baseUrl}/rest/v1/bot_api_keys`)
  }

  private async send(target: URL, init: RequestInit = {}): Promise<Response> {
    return this.request(target, {
      ...init,
      headers: {
        apikey: this.serviceRoleKey,
        authorization: `Bearer ${this.serviceRoleKey}`,
        'content-type': 'application/json',
        ...init.headers,
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    })
  }

  private async json(response: Response): Promise<unknown> {
    if (!response.ok) throw new Error(`Bot API key store failed: ${response.status}`)
    const text = await response.text()
    return text.length === 0 ? null : (JSON.parse(text) as unknown)
  }
}

function parseRecord(row: unknown): BotApiKeyRecord {
  const value = (typeof row === 'object' && row !== null ? row : {}) as Record<string, unknown>
  if (typeof value.id !== 'string' || typeof value.created_at !== 'string') {
    throw new Error('Invalid bot API key row')
  }
  return {
    id: value.id,
    label: typeof value.label === 'string' ? value.label : '',
    createdAt: value.created_at,
    lastUsedAt: typeof value.last_used_at === 'string' ? value.last_used_at : null,
    revokedAt: typeof value.revoked_at === 'string' ? value.revoked_at : null,
  }
}

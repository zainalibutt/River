import {
  DEFAULT_OPPONENT_MODEL_TUNING,
  type OpponentHandEvidence,
  type OpponentModelStateV1,
  updateOpponentModel,
} from '@river/engine'

export interface BotOpponentObservation {
  botId: string
  playerId: string
  handKey: string
  observedAtMs: number
  evidence: OpponentHandEvidence
}

export interface BotOpponentStore {
  append(observation: BotOpponentObservation): Promise<void>
  load(botId: string, playerId: string): Promise<OpponentModelStateV1 | null>
}

export interface SupabaseBotOpponentStoreOptions {
  supabaseUrl: string
  serviceRoleKey: string
  fetch?: typeof fetch
  timeoutMs?: number
}

const MAX_REPLAY_ROWS = 2048
const MAX_FOLD_ROWS = 50_000
const MAX_CONSOLIDATION_PAIRS_SCAN = 20_000

/** The last observation a checkpoint has folded in. */
interface Watermark {
  readonly atMs: number
  readonly key: string
}

interface StoredObservation {
  readonly handKey: string
  readonly observedAtMs: number
  readonly evidence: OpponentHandEvidence
}

export class SupabaseBotOpponentStore implements BotOpponentStore {
  private readonly baseUrl: string
  private readonly serviceRoleKey: string
  private readonly request: typeof fetch
  private readonly timeoutMs: number

  constructor(options: SupabaseBotOpponentStoreOptions) {
    this.baseUrl = options.supabaseUrl.replace(/\/$/, '')
    this.serviceRoleKey = options.serviceRoleKey
    this.request = options.fetch ?? fetch
    this.timeoutMs = options.timeoutMs ?? 8_000
  }

  async append(observation: BotOpponentObservation): Promise<void> {
    const response = await this.send(`${this.baseUrl}/rest/v1/bot_opponent_observations`, {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates' },
      body: JSON.stringify({
        bot_id: observation.botId,
        player_id: observation.playerId,
        model_version: 1,
        hand_key: observation.handKey,
        observed_at: new Date(observation.observedAtMs).toISOString(),
        evidence: observation.evidence,
      }),
    })
    await this.ensureOk(response)
  }

  /** The pair's checkpoint with every observation after it folded in, oldest first. */
  async load(botId: string, playerId: string): Promise<OpponentModelStateV1 | null> {
    const checkpoint = await this.checkpoint(botId, playerId)
    const rows = await this.observations(
      botId,
      playerId,
      checkpoint?.through,
      null,
      MAX_REPLAY_ROWS,
    )
    return fold(checkpoint?.state ?? null, rows)
  }

  /**
   * Folds every observation made before `cutoffMs` into its pair's checkpoint,
   * then deletes the folded rows. A crash between the two leaves rows at or
   * before the checkpoint's watermark, which loads skip and the next run
   * deletes, so running again is always safe.
   */
  async consolidate(
    cutoffMs: number,
    options: { readonly deleteFolded?: boolean } = {},
  ): Promise<{ readonly pairs: number; readonly folded: number }> {
    const url = this.table('bot_opponent_observations')
    url.searchParams.set('model_version', 'eq.1')
    url.searchParams.set('observed_at', `lt.${new Date(cutoffMs).toISOString()}`)
    url.searchParams.set('select', 'bot_id,player_id')
    url.searchParams.set('order', 'bot_id.asc,player_id.asc')
    url.searchParams.set('limit', String(MAX_CONSOLIDATION_PAIRS_SCAN))
    const body = await this.ensureOk(await this.send(url))
    if (!Array.isArray(body)) throw new Error('Invalid opponent observation response')
    const pairs = new Map<string, [string, string]>()
    for (const row of body) {
      if (typeof row !== 'object' || row === null || !('bot_id' in row) || !('player_id' in row)) {
        throw new Error('Invalid opponent observation row')
      }
      pairs.set(`${row.bot_id}:${row.player_id}`, [String(row.bot_id), String(row.player_id)])
    }
    let folded = 0
    for (const [botId, playerId] of pairs.values()) {
      const checkpoint = await this.checkpoint(botId, playerId)
      const rows = await this.observations(
        botId,
        playerId,
        checkpoint?.through,
        cutoffMs,
        MAX_FOLD_ROWS,
      )
      const last = rows.at(-1)
      let through = checkpoint?.through
      if (last !== undefined) {
        const state = fold(checkpoint?.state ?? null, rows)
        await this.ensureOk(
          await this.send(this.table('bot_opponent_checkpoints'), {
            method: 'POST',
            headers: { Prefer: 'resolution=merge-duplicates' },
            body: JSON.stringify({
              bot_id: botId,
              player_id: playerId,
              model_version: 1,
              state,
              folded_through_at: new Date(last.observedAtMs).toISOString(),
              folded_through_key: last.handKey,
              updated_at: new Date().toISOString(),
            }),
          }),
        )
        through = { atMs: last.observedAtMs, key: last.handKey }
        folded += rows.length
      }
      // Also clears rows an earlier run folded but did not get to delete.
      if (through !== undefined && options.deleteFolded !== false) {
        const done = this.pairUrl('bot_opponent_observations', botId, playerId)
        done.searchParams.set('or', notAfter(through))
        await this.ensureOk(await this.send(done, { method: 'DELETE' }))
      }
    }
    return { pairs: pairs.size, folded }
  }

  private async checkpoint(
    botId: string,
    playerId: string,
  ): Promise<{ state: OpponentModelStateV1; through: Watermark } | null> {
    const url = this.pairUrl('bot_opponent_checkpoints', botId, playerId)
    url.searchParams.set('select', 'state,folded_through_at,folded_through_key')
    const body = await this.ensureOk(await this.send(url))
    if (!Array.isArray(body)) throw new Error('Invalid opponent checkpoint response')
    const row = body[0]
    if (row === undefined) return null
    return parseCheckpoint(row)
  }

  /** Observations after `after` and before `beforeMs`, oldest first, failing closed past `limit`. */
  private async observations(
    botId: string,
    playerId: string,
    after: Watermark | undefined,
    beforeMs: number | null,
    limit: number,
  ): Promise<StoredObservation[]> {
    const url = this.pairUrl('bot_opponent_observations', botId, playerId)
    url.searchParams.set('select', 'hand_key,observed_at,evidence')
    url.searchParams.set('order', 'observed_at.asc,hand_key.asc')
    url.searchParams.set('limit', String(limit + 1))
    if (after !== undefined) url.searchParams.set('or', laterThan(after))
    if (beforeMs !== null)
      url.searchParams.set('observed_at', `lt.${new Date(beforeMs).toISOString()}`)
    const body = await this.ensureOk(await this.send(url))
    if (!Array.isArray(body)) throw new Error('Invalid opponent observation response')
    if (body.length > limit) throw new Error('Opponent observation replay limit exceeded')
    return body.map(parseObservation)
  }

  private table(name: string): URL {
    return new URL(`${this.baseUrl}/rest/v1/${name}`)
  }

  private pairUrl(name: string, botId: string, playerId: string): URL {
    const url = this.table(name)
    url.searchParams.set('bot_id', `eq.${botId}`)
    url.searchParams.set('player_id', `eq.${playerId}`)
    url.searchParams.set('model_version', 'eq.1')
    return url
  }

  private async send(target: URL | string, init: RequestInit = {}): Promise<Response> {
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

  private async ensureOk(response: Response): Promise<unknown> {
    if (!response.ok) throw new Error(`Opponent observation store failed: ${response.status}`)
    const text = await response.text()
    return text.length === 0 ? null : (JSON.parse(text) as unknown)
  }
}

function fold(
  start: OpponentModelStateV1 | null,
  rows: readonly StoredObservation[],
): OpponentModelStateV1 | null {
  let model = start
  for (const row of rows) {
    model = updateOpponentModel(
      model,
      row.evidence,
      row.observedAtMs,
      DEFAULT_OPPONENT_MODEL_TUNING,
    )
  }
  return model
}

/** A PostgREST filter value, quoted because timestamps and hand keys contain reserved characters. */
function quoted(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function laterThan(mark: Watermark): string {
  const at = quoted(new Date(mark.atMs).toISOString())
  return `(observed_at.gt.${at},and(observed_at.eq.${at},hand_key.gt.${quoted(mark.key)}))`
}

function notAfter(mark: Watermark): string {
  const at = quoted(new Date(mark.atMs).toISOString())
  return `(observed_at.lt.${at},and(observed_at.eq.${at},hand_key.lte.${quoted(mark.key)}))`
}

const STATE_FIELDS = [
  'weightedHands',
  'weightedVpip',
  'weightedPfr',
  'weightedAggressiveActions',
  'weightedPassiveCalls',
  'weightedShowdowns',
  'weightedAggressivePotRatioTotal',
  'weightedAggressivePotRatioSamples',
  'lastSeenAtMs',
] as const

function parseCheckpoint(row: unknown): { state: OpponentModelStateV1; through: Watermark } {
  if (
    typeof row !== 'object' ||
    row === null ||
    !('state' in row) ||
    !('folded_through_at' in row) ||
    !('folded_through_key' in row)
  ) {
    throw new Error('Invalid opponent checkpoint row')
  }
  const state = row.state
  const atMs = Date.parse(String(row.folded_through_at))
  if (
    typeof state !== 'object' ||
    state === null ||
    !('version' in state) ||
    state.version !== 1 ||
    !STATE_FIELDS.every(
      (field) =>
        field in state &&
        Number.isFinite((state as Record<string, unknown>)[field]) &&
        Number((state as Record<string, unknown>)[field]) >= 0,
    ) ||
    !Number.isFinite(atMs) ||
    typeof row.folded_through_key !== 'string'
  ) {
    throw new Error('Invalid opponent checkpoint')
  }
  return {
    state: state as unknown as OpponentModelStateV1,
    through: { atMs, key: row.folded_through_key },
  }
}

function parseObservation(row: unknown): StoredObservation {
  if (
    typeof row !== 'object' ||
    row === null ||
    !('observed_at' in row) ||
    !('evidence' in row) ||
    !('hand_key' in row)
  ) {
    throw new Error('Invalid opponent observation row')
  }
  const observedAtMs = Date.parse(String(row.observed_at))
  const evidence = row.evidence
  if (
    !Number.isFinite(observedAtMs) ||
    typeof evidence !== 'object' ||
    evidence === null ||
    !('vpip' in evidence) ||
    typeof evidence.vpip !== 'boolean' ||
    !('pfr' in evidence) ||
    typeof evidence.pfr !== 'boolean' ||
    !('showdown' in evidence) ||
    typeof evidence.showdown !== 'boolean' ||
    !('aggressiveActions' in evidence) ||
    !Number.isSafeInteger(evidence.aggressiveActions) ||
    Number(evidence.aggressiveActions) < 0 ||
    !('passiveCalls' in evidence) ||
    !Number.isSafeInteger(evidence.passiveCalls) ||
    Number(evidence.passiveCalls) < 0 ||
    !('aggressivePotRatios' in evidence) ||
    !Array.isArray(evidence.aggressivePotRatios) ||
    !evidence.aggressivePotRatios.every(
      (ratio: unknown) => typeof ratio === 'number' && Number.isFinite(ratio) && ratio >= 0,
    )
  ) {
    throw new Error('Invalid opponent evidence')
  }
  return {
    handKey: String(row.hand_key),
    observedAtMs,
    evidence: evidence as unknown as OpponentHandEvidence,
  }
}

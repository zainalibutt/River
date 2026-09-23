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

  async load(botId: string, playerId: string): Promise<OpponentModelStateV1 | null> {
    const url = new URL(`${this.baseUrl}/rest/v1/bot_opponent_observations`)
    url.searchParams.set('bot_id', `eq.${botId}`)
    url.searchParams.set('player_id', `eq.${playerId}`)
    url.searchParams.set('model_version', 'eq.1')
    url.searchParams.set('select', 'hand_key,observed_at,evidence')
    url.searchParams.set('order', 'observed_at.desc,hand_key.desc')
    url.searchParams.set('limit', String(MAX_REPLAY_ROWS + 1))
    const response = await this.send(url)
    const body = await this.ensureOk(response)
    if (!Array.isArray(body)) throw new Error('Invalid opponent observation response')
    if (body.length > MAX_REPLAY_ROWS) throw new Error('Opponent observation replay limit exceeded')
    let model: OpponentModelStateV1 | null = null
    for (const row of body.reverse()) {
      const parsed = parseObservation(row)
      model = updateOpponentModel(
        model,
        parsed.evidence,
        parsed.observedAtMs,
        DEFAULT_OPPONENT_MODEL_TUNING,
      )
    }
    return model
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

function parseObservation(row: unknown): { observedAtMs: number; evidence: OpponentHandEvidence } {
  if (typeof row !== 'object' || row === null || !('observed_at' in row) || !('evidence' in row)) {
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
  return { observedAtMs, evidence: evidence as unknown as OpponentHandEvidence }
}

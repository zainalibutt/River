import type { ClientRoomCommand, ClientSocialCommand, ServerMessage } from '@river/server/wire'

interface SocketEventMap {
  open: Event
  message: MessageEvent<string>
  close: CloseEvent
  error: Event
}

interface SocketLike {
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  addEventListener<K extends keyof SocketEventMap>(
    type: K,
    listener: (event: SocketEventMap[K]) => void,
  ): void
}

export interface RiverSocketOptions {
  url: string
  createSocket?: (url: string) => SocketLike
  createRequestId?: () => string
  timeoutMs?: number
}

export type RiverMessageListener = (message: ServerMessage) => void
export type RiverSocketState = 'connecting' | 'connected' | 'closed'
export type RiverSocketStateListener = (state: RiverSocketState) => void

function parseServerMessage(value: unknown): ServerMessage | null {
  if (typeof value !== 'object' || value === null || !('kind' in value)) return null
  const kind = value.kind
  return kind === 'authenticated' ||
    kind === 'snapshot' ||
    kind === 'social' ||
    kind === 'tables' ||
    kind === 'cosmetic' ||
    kind === 'grant' ||
    kind === 'tableItem' ||
    kind === 'adminResult' ||
    kind === 'error'
    ? (value as ServerMessage)
    : null
}

export function defaultRiverSocketUrl(location: Pick<Location, 'protocol' | 'host'>): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.host}/ws`
}

export class RiverSocket {
  private readonly options: RiverSocketOptions
  private readonly listeners = new Set<RiverMessageListener>()
  private readonly stateListeners = new Set<RiverSocketStateListener>()
  private socket: SocketLike | null = null

  constructor(options: RiverSocketOptions) {
    this.options = options
  }

  subscribe(listener: RiverMessageListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  subscribeState(listener: RiverSocketStateListener): () => void {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  connect(accessToken: string): Promise<void> {
    if (this.socket !== null) throw new Error('River socket is already connected')
    const socket = this.options.createSocket?.(this.options.url) ?? new WebSocket(this.options.url)
    this.socket = socket
    this.emitState('connecting')
    return new Promise((resolve, reject) => {
      let authenticated = false
      const timeout = setTimeout(() => {
        socket.close(4000, 'Authentication timeout')
        reject(new Error('River socket authentication timed out'))
      }, this.options.timeoutMs ?? 10_000)
      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({ kind: 'authenticate', accessToken }))
      })
      socket.addEventListener('message', (event) => {
        let parsed: unknown
        try {
          parsed = JSON.parse(event.data) as unknown
        } catch {
          return
        }
        const message = parseServerMessage(parsed)
        if (message === null) return
        if (message.kind === 'authenticated') {
          authenticated = true
          clearTimeout(timeout)
          this.emitState('connected')
          resolve()
        }
        for (const listener of this.listeners) listener(message)
      })
      socket.addEventListener('error', () => {
        clearTimeout(timeout)
        reject(new Error('River socket connection failed'))
      })
      socket.addEventListener('close', () => {
        clearTimeout(timeout)
        if (this.socket === socket) this.socket = null
        this.emitState('closed')
        if (!authenticated) reject(new Error('River socket closed before authentication'))
      })
    })
  }

  /**
   * `venueId` decides which room a NEW table opens in. The server ignores it
   * for a table that already exists, so joining never moves anyone.
   */
  enter(roomId: string, name: string, inviteCode?: string, venueId?: string): string {
    return this.send({
      kind: 'enter',
      requestId: this.requestId(),
      roomId,
      name,
      ...(inviteCode === undefined ? {} : { inviteCode }),
      ...(venueId === undefined ? {} : { venueId }),
    })
  }

  command(command: ClientRoomCommand): string {
    return this.send({ kind: 'command', requestId: this.requestId(), command })
  }

  social(command: ClientSocialCommand): string {
    return this.send({ kind: 'social', requestId: this.requestId(), command })
  }

  buyCosmetic(cosmeticId: string): string {
    return this.send({ kind: 'buyCosmetic', requestId: this.requestId(), cosmeticId })
  }

  wearCosmetic(cosmeticId: string): string {
    return this.send({ kind: 'wearCosmetic', requestId: this.requestId(), cosmeticId })
  }

  listTables(): string {
    return this.send({ kind: 'listTables', requestId: this.requestId() })
  }

  buyTableItem(itemId: string): string {
    return this.send({ kind: 'buyTableItem', requestId: this.requestId(), itemId })
  }

  equipTableItem(itemId: string): string {
    return this.send({ kind: 'equipTableItem', requestId: this.requestId(), itemId })
  }

  claimDaily(): string {
    return this.send({ kind: 'claimDaily', requestId: this.requestId() })
  }

  claimRescue(): string {
    return this.send({ kind: 'claimRescue', requestId: this.requestId() })
  }

  resync(): string {
    return this.send({ kind: 'resync', requestId: this.requestId() })
  }

  close(): void {
    this.socket?.close(1000, 'Client closed')
    this.socket = null
  }

  private emitState(state: RiverSocketState): void {
    for (const listener of this.stateListeners) listener(state)
  }

  private requestId(): string {
    return this.options.createRequestId?.() ?? crypto.randomUUID()
  }

  private send<T extends { requestId: string }>(message: T): string {
    if (this.socket === null || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('River socket is not open')
    }
    this.socket.send(JSON.stringify(message))
    return message.requestId
  }
}

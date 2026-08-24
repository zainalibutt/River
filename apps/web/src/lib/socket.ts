import type { ClientRoomCommand, ServerMessage } from '@river/server/wire'

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

function parseServerMessage(value: unknown): ServerMessage | null {
  if (typeof value !== 'object' || value === null || !('kind' in value)) return null
  const kind = value.kind
  return kind === 'authenticated' || kind === 'snapshot' || kind === 'error'
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
  private socket: SocketLike | null = null

  constructor(options: RiverSocketOptions) {
    this.options = options
  }

  subscribe(listener: RiverMessageListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  connect(accessToken: string): Promise<void> {
    if (this.socket !== null) throw new Error('River socket is already connected')
    const socket = this.options.createSocket?.(this.options.url) ?? new WebSocket(this.options.url)
    this.socket = socket
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
        if (!authenticated) reject(new Error('River socket closed before authentication'))
      })
    })
  }

  enter(roomId: string, name: string): string {
    return this.send({ kind: 'enter', requestId: this.requestId(), roomId, name })
  }

  command(command: ClientRoomCommand): string {
    return this.send({ kind: 'command', requestId: this.requestId(), command })
  }

  resync(): string {
    return this.send({ kind: 'resync', requestId: this.requestId() })
  }

  close(): void {
    this.socket?.close(1000, 'Client closed')
    this.socket = null
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

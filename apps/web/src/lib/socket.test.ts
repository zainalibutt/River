import type { ServerMessage } from '@river/server/wire'
import { describe, expect, it, vi } from 'vitest'
import { defaultRiverSocketUrl, RiverSocket } from './socket.js'

type Listener = (event: never) => void

class TestSocket {
  readyState = 0
  readonly sent: string[] = []
  readonly listeners = new Map<string, Listener[]>()

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.readyState = 3
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  open(): void {
    this.readyState = 1
    this.emit('open', new Event('open'))
  }

  message(message: ServerMessage): void {
    this.emit('message', new MessageEvent('message', { data: JSON.stringify(message) }))
  }

  serverClose(): void {
    this.readyState = 3
    this.emit('close', new Event('close'))
  }

  private emit(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event as never)
  }
}

describe('River browser socket', () => {
  it('selects secure WebSockets for an HTTPS origin', () => {
    expect(defaultRiverSocketUrl({ protocol: 'https:', host: 'river.up.railway.app' })).toBe(
      'wss://river.up.railway.app/ws',
    )
  })

  it('authenticates before sending room commands and forwards snapshots', async () => {
    const socket = new TestSocket()
    const listener = vi.fn()
    const stateListener = vi.fn()
    const river = new RiverSocket({
      url: 'ws://river.local/ws',
      createSocket: () => socket,
      createRequestId: () => 'request-one',
    })
    river.subscribe(listener)
    river.subscribeState(stateListener)
    const connected = river.connect('access-token')
    socket.open()
    expect(JSON.parse(socket.sent[0] ?? '')).toEqual({
      kind: 'authenticate',
      accessToken: 'access-token',
    })
    socket.message({ kind: 'authenticated', playerId: 'player', anonymous: true, admin: false })
    await connected
    expect(stateListener).toHaveBeenCalledWith('connecting')
    expect(stateListener).toHaveBeenCalledWith('connected')
    expect(river.enter('river-one', 'Alice', 'ROOFTOP')).toBe('request-one')
    expect(JSON.parse(socket.sent[1] ?? '')).toEqual({
      kind: 'enter',
      requestId: 'request-one',
      roomId: 'river-one',
      name: 'Alice',
      inviteCode: 'ROOFTOP',
    })
    expect(listener).toHaveBeenCalledWith({
      kind: 'authenticated',
      playerId: 'player',
      anonymous: true,
      admin: false,
    })
  })

  it('rejects when the server closes before authentication', async () => {
    const socket = new TestSocket()
    const river = new RiverSocket({
      url: 'ws://river.local/ws',
      createSocket: () => socket,
    })
    const connected = river.connect('bad-token')
    socket.open()
    socket.serverClose()
    await expect(connected).rejects.toThrow('closed before authentication')
  })

  it('sends grant claims and forwards their outcomes', async () => {
    const socket = new TestSocket()
    const listener = vi.fn()
    const river = new RiverSocket({
      url: 'ws://river.local/ws',
      createSocket: () => socket,
      createRequestId: () => 'grant-request',
    })
    river.subscribe(listener)
    const connected = river.connect('access-token')
    socket.open()
    socket.message({ kind: 'authenticated', playerId: 'player', anonymous: true, admin: false })
    await connected

    river.claimDaily()
    expect(JSON.parse(socket.sent[1] ?? '')).toEqual({
      kind: 'claimDaily',
      requestId: 'grant-request',
    })
    socket.message({
      kind: 'grant',
      requestId: 'grant-request',
      outcome: { kind: 'granted', delta: 10_000, balance: 35_000, ref: 'daily:player:day' },
    })
    expect(listener).toHaveBeenLastCalledWith({
      kind: 'grant',
      requestId: 'grant-request',
      outcome: { kind: 'granted', delta: 10_000, balance: 35_000, ref: 'daily:player:day' },
    })
  })
})

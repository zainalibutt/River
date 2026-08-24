import type { Server as HttpServer } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import type { RoomHub } from './transport.js'

export function attachRiverWebSocketServer(
  server: HttpServer,
  hub: RoomHub,
  path = '/ws',
): WebSocketServer {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 })
  server.on('upgrade', (request, socket, head) => {
    const requestPath = new URL(request.url ?? '/', 'http://river.local').pathname
    if (requestPath !== path) {
      socket.destroy()
      return
    }
    sockets.handleUpgrade(request, socket, head, (client) => {
      sockets.emit('connection', client, request)
    })
  })
  sockets.on('connection', (client) => {
    const connection = hub.connect({
      send: (message) => {
        if (client.readyState === WebSocket.OPEN) client.send(message)
      },
      close: (code, reason) => client.close(code, reason),
    })
    let queue = Promise.resolve()
    client.on('message', (data, binary) => {
      if (binary) {
        client.close(1003, 'Text messages only')
        return
      }
      queue = queue
        .then(() => connection.receive(data.toString()))
        .catch(() => {
          client.close(1011, 'Server error')
        })
    })
    client.once('close', () => {
      void connection.close()
    })
  })
  return sockets
}

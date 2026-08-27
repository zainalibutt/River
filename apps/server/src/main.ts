import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import type { Duplex } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import { createSupabaseTokenVerifier } from './auth.js'
import { readServerConfig } from './config.js'
import { SupabaseCosmeticStore } from './cosmetic-store.js'
import { createSupabaseEconomy } from './economy-service.js'
import { SupabaseLedger } from './ledger.js'
import { SupabaseTableItemStore } from './table-item-store.js'
import { RoomHub } from './transport.js'
import { attachRiverWebSocketServer } from './websocket.js'

interface NextApplication {
  prepare(): Promise<void>
  getRequestHandler(): (request: IncomingMessage, response: ServerResponse) => Promise<void>
  getUpgradeHandler(): (request: IncomingMessage, socket: Duplex, head: Buffer) => Promise<void>
}

const require = createRequire(import.meta.url)
const next = require('next') as (options: {
  dev: boolean
  dir: string
  hostname: string
  port: number
}) => NextApplication

loadEnv({ path: fileURLToPath(new URL('../../../.env.local', import.meta.url)), quiet: true })

function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return String(error)
}

async function start(): Promise<void> {
  const config = readServerConfig(process.env)
  const development = process.env.NODE_ENV !== 'production'
  const webDirectory = fileURLToPath(new URL('../../web', import.meta.url))
  const application = next({
    dev: development,
    dir: webDirectory,
    hostname: config.hostname,
    port: config.port,
  })
  await application.prepare()
  const handle = application.getRequestHandler()
  const server = createServer((request, response) => handle(request, response))
  const ledger = new SupabaseLedger({
    supabaseUrl: config.supabaseUrl,
    serviceRoleKey: config.serviceRoleKey,
  })
  const hub = new RoomHub({
    // A person who opens River alone should find a table with people at it.
    // Enough to feel busy, with a seat kept free for whoever arrives next.
    botSeats: 5,
    verifyToken: createSupabaseTokenVerifier({ supabaseUrl: config.supabaseUrl }),
    onError: (context, error) => {
      process.stderr.write(`river: ${context}: ${errorText(error)}
`)
    },
    ledger,
    economy: createSupabaseEconomy({
      supabaseUrl: config.supabaseUrl,
      serviceRoleKey: config.serviceRoleKey,
      ledger,
    }),
    tableItems: new SupabaseTableItemStore({
      supabaseUrl: config.supabaseUrl,
      serviceRoleKey: config.serviceRoleKey,
    }),
    cosmetics: new SupabaseCosmeticStore({
      supabaseUrl: config.supabaseUrl,
      serviceRoleKey: config.serviceRoleKey,
    }),
  })
  const sockets = attachRiverWebSocketServer(server, hub)
  // Next owns hot reload in development and asks for it over its own upgrade.
  // Without this the page loads but never reflects an edit.
  if (development) {
    const upgrade = application.getUpgradeHandler()
    server.on('upgrade', (request, socket, head) => {
      const requestPath = new URL(request.url ?? '/', 'http://river.local').pathname
      if (requestPath === '/ws') return
      void upgrade(request, socket, head)
    })
  }
  // Stop taking connections first, then hand every seated stack back before
  // the process that is holding those tables in memory goes away. Sockets close
  // first so nobody can buy in to a table that is about to stop existing.
  let settling = false
  const shutdown = (): void => {
    if (settling) return
    settling = true
    sockets.close(() => {
      void hub
        .settleAllTables()
        .catch((error: unknown) => {
          console.error('shutdown: could not settle every table', error)
        })
        .finally(() => server.close())
    })
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  server.listen(config.port, config.hostname)
}

await start()

import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
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
}

const require = createRequire(import.meta.url)
const next = require('next') as (options: {
  dev: boolean
  dir: string
  hostname: string
  port: number
}) => NextApplication

loadEnv({ path: fileURLToPath(new URL('../../../.env.local', import.meta.url)), quiet: true })

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
    verifyToken: createSupabaseTokenVerifier({ supabaseUrl: config.supabaseUrl }),
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
  const shutdown = (): void => {
    sockets.close(() => server.close())
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  server.listen(config.port, config.hostname)
}

await start()

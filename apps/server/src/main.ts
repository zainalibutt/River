import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Duplex } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import { serveApiRoutes } from './api-routes.js'
import { createSupabaseTokenVerifier } from './auth.js'
import { SupabaseBanList } from './ban-store.js'
import { BotApi } from './bot-api.js'
import { withBotApi } from './bot-api-http.js'
import { SupabaseBotApiKeyStore } from './bot-api-keys.js'
import { botCapabilitiesRoute } from './bot-capabilities-route.js'
import { liveBotThinker, liveSafeBotPolicy, liveSafeConfig } from './bot-live-safe.js'
import { SupabaseBotOpponentStore } from './bot-opponent-store.js'
import { assertDevelopmentDatabase, readServerConfig } from './config.js'
import { SupabaseCosmeticStore } from './cosmetic-store.js'
import { createSupabaseEconomy } from './economy-service.js'
import { SupabaseLedger } from './ledger.js'
import { SupabasePlayerHandStore } from './player-hand-store.js'
import { SupabasePlayerNames } from './player-names.js'
import { fetchPrivateModels } from './private-models.js'
import { publicProfileRoute, SupabasePublicProfiles } from './public-profiles.js'
import { SupabaseTableItemStore } from './table-item-store.js'
import { tableLinkRoute } from './table-link-route.js'
import { RoomHub } from './transport.js'
import { attachRiverWebSocketServer } from './websocket.js'

interface NextApplication {
  prepare(): Promise<void>
  getRequestHandler(): (request: IncomingMessage, response: ServerResponse) => Promise<void>
  getUpgradeHandler(): (request: IncomingMessage, socket: Duplex, head: Buffer) => Promise<void>
}

const require = createRequire(import.meta.url)
const OPPONENT_CONSOLIDATION_LAG_MS = 60 * 60 * 1000
/**
 * How long a new server waits before paying back what a crashed one left
 * seated. Railway gives the server it replaces up to thirty seconds to shut
 * down and settle its own tables; this leaves it three times that.
 */
const CRASH_REFUND_DELAY_MS = 90_000
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
  // A seating opened before now was opened by some other server.
  const startedAtMs = Date.now()
  const config = readServerConfig(process.env)
  const development = process.env.NODE_ENV !== 'production'
  if (development) assertDevelopmentDatabase(process.env)
  const webDirectory = fileURLToPath(new URL('../../web', import.meta.url))
  const application = next({
    dev: development,
    dir: webDirectory,
    hostname: config.hostname,
    port: config.port,
  })
  await application.prepare()
  const handle = application.getRequestHandler()
  const ledger = new SupabaseLedger({
    supabaseUrl: config.supabaseUrl,
    serviceRoleKey: config.serviceRoleKey,
  })
  const rememberOpponents = process.env.BOT_OPPONENT_PERSISTENCE === 'true'
  // The OG's river solver, worked out on a worker thread; off unless switched on.
  const botThinker = liveBotThinker({ ...process.env, BOT_LIVE_SAFE: 'false' })
  // Midas's models come from a private bucket when one is named. If the copy
  // fails, Midas stays off and the tables play on with the bots they have.
  const modelsBucket = process.env.RIVER_MODELS_BUCKET
  if (process.env.BOT_LIVE_SAFE === 'true' && modelsBucket) {
    try {
      const paths = await fetchPrivateModels({
        supabaseUrl: config.supabaseUrl,
        serviceRoleKey: config.serviceRoleKey,
        bucket: modelsBucket,
        directory: process.env.RIVER_MODELS_DIR || join(tmpdir(), 'river-models'),
      })
      Object.assign(process.env, paths)
      console.log(
        'private-models',
        JSON.stringify({ bucket: modelsBucket, set: Object.keys(paths) }),
      )
    } catch (error) {
      process.env.BOT_LIVE_SAFE = 'false'
      process.stderr.write(`river: private models: ${errorText(error)}\n`)
    }
  }
  const safeConfig = liveSafeConfig(process.env)
  const safe = safeConfig.enabled
    ? liveSafeBotPolicy(safeConfig, {
        onEvent: (event) => {
          if (event.type === 'ready' || event.reason)
            console.log('bot-live-safe', JSON.stringify(event))
        },
      })
    : undefined
  if (safe !== undefined) {
    setInterval(() => {
      console.log(
        'bot-live-safe-summary',
        JSON.stringify({
          ...safe.stats,
          ...safe.diagnostics(),
          rss: process.memoryUsage().rss,
        }),
      )
    }, 60_000).unref()
  }
  // Paying back what a crash left seated needs the table its migration makes;
  // off until that migration has been applied and this is switched on.
  const refundCrashes = process.env.TABLE_CRASH_REFUND === 'true'
  // Bans kept in the database need the table their migration makes, and a
  // check against a table that is not there refuses every player at the door;
  // off, and held in memory, until that migration has been applied and this is
  // switched on.
  const durableBans = process.env.PLAYER_BANS_DURABLE === 'true'
  const hub = new RoomHub({
    ...(refundCrashes ? { seatings: ledger } : {}),
    ...(durableBans
      ? {
          bans: new SupabaseBanList({
            supabaseUrl: config.supabaseUrl,
            serviceRoleKey: config.serviceRoleKey,
          }),
        }
      : {}),
    // A person who opens River alone should find a table with people at it:
    // three to eight of them, in chairs the table's room id picks.
    botSeats: 'random',
    ...(botThinker === undefined ? {} : { botRiverThinker: botThinker }),
    ...(safe === undefined
      ? {}
      : { midas: { thinker: safe, budgetMs: safeConfig.budgetMs, seats: safeConfig.seats } }),
    ...(rememberOpponents
      ? {
          botOpponentStore: new SupabaseBotOpponentStore({
            supabaseUrl: config.supabaseUrl,
            serviceRoleKey: config.serviceRoleKey,
            timeoutMs: 750,
          }),
        }
      : {}),
    // Members sit under the name on their account; guests under the one they send.
    playerNames: new SupabasePlayerNames({
      supabaseUrl: config.supabaseUrl,
      serviceRoleKey: config.serviceRoleKey,
    }),
    playerHands: new SupabasePlayerHandStore({
      supabaseUrl: config.supabaseUrl,
      serviceRoleKey: config.serviceRoleKey,
    }),
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
  // A short link resolves against the tables this process holds, and a profile
  // is read with the service key it holds, so those routes are answered here.
  // Every other request, the rest of /api included, is Next's.
  const routes = serveApiRoutes(
    [
      botCapabilitiesRoute(hub),
      tableLinkRoute(hub),
      publicProfileRoute(
        new SupabasePublicProfiles({
          supabaseUrl: config.supabaseUrl,
          serviceRoleKey: config.serviceRoleKey,
        }),
      ),
    ],
    (request, response) => handle(request, response),
  )
  // The public bot API: other people's bots play Nyx over HTTP. Off unless
  // switched on, and then only after its key table's migration has been applied.
  let botApi: BotApi | undefined
  if (process.env.BOT_API === 'true') {
    botApi = new BotApi()
    const api = botApi
    setInterval(() => {
      api.expire()
    }, 60_000).unref()
  }
  const server = createServer(
    botApi === undefined
      ? routes
      : withBotApi(
          {
            api: botApi,
            keys: new SupabaseBotApiKeyStore({
              supabaseUrl: config.supabaseUrl,
              serviceRoleKey: config.serviceRoleKey,
            }),
            verifyToken: createSupabaseTokenVerifier({ supabaseUrl: config.supabaseUrl }),
            onError: (error) => {
              process.stderr.write(`river: bot api: ${errorText(error)}
`)
            },
          },
          routes,
        ),
  )
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
  // Hand every seated stack back before the process holding those tables in
  // memory goes away, then close every socket so its client reconnects to the
  // server that replaces this one.
  let settling = false
  const shutdown = (): void => {
    if (settling) return
    settling = true
    // Settling freezes every table first, so nothing can buy in or play on.
    // Waiting for the sockets to close first never settled anything while a
    // tab was open: closing the socket server waits for every client, and the
    // process was killed before they had gone.
    void hub
      .settleAllTables()
      .catch((error: unknown) => {
        console.error('shutdown: could not settle every table', error)
      })
      .finally(async () => {
        for (const client of sockets.clients) client.close(1012, 'Server restarting')
        sockets.close()
        await Promise.all([botThinker?.close(), safe?.close()])
        server.close()
      })
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  server.listen(config.port, config.hostname)
  if (refundCrashes) scheduleCrashRefund(hub, startedAtMs)
  if (rememberOpponents) {
    scheduleOpponentConsolidation(
      new SupabaseBotOpponentStore({
        supabaseUrl: config.supabaseUrl,
        serviceRoleKey: config.serviceRoleKey,
        timeoutMs: 20_000,
      }),
    )
  }
}

/**
 * Pays back the buy-ins a crashed server left seated, once the server this one
 * replaced has had time to settle its own tables on the way out.
 */
function scheduleCrashRefund(hub: RoomHub, startedAtMs: number): void {
  setTimeout(() => {
    hub
      .refundCrashedSeatings(startedAtMs)
      .then((refunded) => {
        if (refunded > 0) console.log(`crash refund: paid back ${refunded} seatings`)
      })
      .catch((error: unknown) => {
        console.error('crash refund: could not run', error)
      })
  }, CRASH_REFUND_DELAY_MS).unref()
}

/**
 * Folds bots' older evidence about each player into one checkpoint shortly
 * after start-up and then once a day, so memory stays small however often a
 * bot meets the same person. The last hour is left alone for live tables.
 */
function scheduleOpponentConsolidation(store: SupabaseBotOpponentStore): void {
  const run = () => {
    store
      .consolidate(Date.now() - OPPONENT_CONSOLIDATION_LAG_MS)
      .then(({ pairs, folded }) => {
        if (folded > 0) console.log(`bot memory: folded ${folded} hands for ${pairs} pairs`)
      })
      .catch((error: unknown) => {
        console.error('bot memory: consolidation failed', error)
      })
  }
  setTimeout(run, 60_000).unref()
  setInterval(run, 24 * 60 * 60 * 1000).unref()
}

await start()

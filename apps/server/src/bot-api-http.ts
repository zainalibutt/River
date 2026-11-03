import type { IncomingMessage, ServerResponse } from 'node:http'
import type { TokenVerifier } from './auth.js'
import { type BotApi, handleBotApi } from './bot-api.js'
import type { BotApiKeyStore } from './bot-api-keys.js'

// The bot API's door on the main server, under /api/bot/. It stands in front of
// serveApiRoutes rather than inside it: those routes are GET-only and read no
// header or body, while this one has to read a POST body and an Authorization
// header. Everything else passes through untouched.
//
//   POST   /api/bot/v1/matches | /v1/matches/<id> | /v1/hands | /v1/hands/<id>/act
//          Authorization: Bearer <API key>              (see handleBotApi)
//   POST   /api/bot/keys          { label }   make a key; it is shown this once
//   GET    /api/bot/keys                      list your keys, never their secrets
//   DELETE /api/bot/keys/<id>                 revoke a key
//          Authorization: Bearer <a saved account's access token>

export const BOT_API_PREFIX = '/api/bot/'
const MAX_BODY_BYTES = 8 * 1024

export interface BotApiHttpOptions {
  readonly api: BotApi
  readonly keys: BotApiKeyStore
  readonly verifyToken: TokenVerifier
  readonly onError?: (error: unknown) => void
}

type Listener = (request: IncomingMessage, response: ServerResponse) => void

/** Wraps a request listener so /api/bot/ is answered here and the rest goes on to `next`. */
export function withBotApi(options: BotApiHttpOptions, next: Listener): Listener {
  return (incoming, outgoing) => {
    const url = new URL(incoming.url ?? '/', 'http://river.local')
    if (!url.pathname.startsWith(BOT_API_PREFIX)) {
      next(incoming, outgoing)
      return
    }
    answer(options, incoming, url.pathname)
      .catch((error: unknown) => {
        options.onError?.(error)
        return { status: 500, body: { error: 'Something went wrong.' } }
      })
      .then(({ status, body }) => {
        const text = body === undefined ? '' : JSON.stringify(body)
        outgoing.writeHead(status, {
          'cache-control': 'no-store',
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(text)),
        })
        outgoing.end(text)
      })
      .catch(() => outgoing.destroy())
  }
}

async function answer(
  options: BotApiHttpOptions,
  incoming: IncomingMessage,
  pathname: string,
): Promise<{ status: number; body?: unknown }> {
  const method = incoming.method ?? 'GET'
  const authorization = incoming.headers.authorization
  const body = await readBody(incoming)
  if (body === TOO_LARGE) return { status: 413, body: { error: 'request body too large' } }
  if (body === UNREADABLE) return { status: 400, body: { error: 'send a JSON body' } }
  const path = pathname.slice(BOT_API_PREFIX.length - 1)
  if (path.startsWith('/v1/')) {
    return handleBotApi(
      options.api,
      { method, path, authorization, body },
      async (token) => (await options.keys.verify(token))?.playerId ?? null,
    )
  }
  if (path === '/keys' || path.startsWith('/keys/')) {
    return keysCall(options, method, path, authorization, body)
  }
  return { status: 404, body: { error: 'no such call' } }
}

async function keysCall(
  options: BotApiHttpOptions,
  method: string,
  path: string,
  authorization: string | undefined,
  body: unknown,
): Promise<{ status: number; body?: unknown }> {
  const token = /^Bearer (\S+)$/.exec(authorization ?? '')?.[1]
  if (token === undefined) return { status: 401, body: { error: 'sign in first' } }
  let player: Awaited<ReturnType<TokenVerifier>>
  try {
    player = await options.verifyToken(token)
  } catch {
    return { status: 401, body: { error: 'sign in first' } }
  }
  // A guest's account can vanish with its browser; keys belong to saved accounts.
  if (player.anonymous) return { status: 403, body: { error: 'save your account first' } }
  if (path === '/keys' && method === 'GET') {
    return { status: 200, body: { keys: await options.keys.list(player.playerId) } }
  }
  if (path === '/keys' && method === 'POST') {
    const label = (body as { label?: unknown } | null)?.label
    const created = await options.keys.create(
      player.playerId,
      typeof label === 'string' ? label : '',
    )
    if (!created.ok) return { status: 409, body: { error: created.error } }
    return { status: 201, body: { key: created.key, ...created.record } }
  }
  const revoke = /^\/keys\/([A-Za-z0-9-]{1,64})$/.exec(path)
  if (revoke?.[1] !== undefined && method === 'DELETE') {
    const done = await options.keys.revoke(player.playerId, revoke[1])
    return done ? { status: 204 } : { status: 404, body: { error: 'no such key' } }
  }
  return { status: 405, body: { error: 'not a call on keys' } }
}

const TOO_LARGE = Symbol('too large')
const UNREADABLE = Symbol('unreadable')

/** The request's JSON body, null when it has none. */
async function readBody(incoming: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of incoming) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_BODY_BYTES) return TOO_LARGE
    chunks.push(buffer)
  }
  if (size === 0) return null
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    return UNREADABLE
  }
}

import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * An API route this process answers itself, ahead of Next.
 *
 * Most of `/api` is Next's: /api/me, /api/config and /api/health are route
 * handlers under apps/web/src/app/api, run by Next inside this same server.
 * A route belongs here instead when it needs something only this process
 * holds, such as the live room hub. It keeps Next's contract - a fetch Request
 * in, a Response out - so the two kinds read alike and either could move.
 */
export interface ApiRoute {
  /** The start of every path this route answers, and of no other route's. */
  readonly prefix: string
  handle(request: Request): Promise<Response>
}

/** JSON that no browser or proxy keeps, like every other /api answer. */
export function apiJson(
  body: unknown,
  status = 200,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } })
}

/**
 * A request listener that serves `routes` and hands every other request on.
 *
 * Only the method and the address reach a route. None of them reads a header
 * or a body, and carrying less means less to get wrong at the one entrance
 * every page on the site passes through.
 */
export function serveApiRoutes(
  routes: readonly ApiRoute[],
  next: (request: IncomingMessage, response: ServerResponse) => unknown,
): (request: IncomingMessage, response: ServerResponse) => void {
  return (incoming, outgoing) => {
    const url = new URL(incoming.url ?? '/', 'http://river.local')
    const route = routes.find(({ prefix }) => url.pathname.startsWith(prefix))
    if (route === undefined) {
      void next(incoming, outgoing)
      return
    }
    const method = incoming.method ?? 'GET'
    // Checked before a Request exists: new Request() throws on methods such as
    // TRACE, and a throw in here would take down the process with every table.
    const answer =
      method === 'GET' || method === 'HEAD'
        ? Promise.resolve()
            .then(() => route.handle(new Request(url, { method })))
            .catch(() => apiJson({ error: 'Something went wrong.' }, 500))
        : Promise.resolve(
            apiJson({ error: 'Only GET is answered here.' }, 405, { allow: 'GET, HEAD' }),
          )
    answer
      .then(async (response) => {
        const body = Buffer.from(await response.arrayBuffer())
        outgoing.writeHead(response.status, {
          ...Object.fromEntries(response.headers),
          'content-length': String(body.length),
        })
        outgoing.end(body)
      })
      .catch(() => outgoing.destroy())
  }
}

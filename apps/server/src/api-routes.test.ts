import { createServer, request as httpRequest, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { type ApiRoute, apiJson, serveApiRoutes } from './api-routes.js'

/**
 * main.ts puts these routes in front of Next on the one HTTP server, so a
 * mistake here is not a missing endpoint. It is every page on the site, and
 * the game server with them.
 */

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  )
})

const tables: ApiRoute = {
  prefix: '/api/tables/',
  handle: async (request) => apiJson({ path: new URL(request.url).pathname }),
}

/** A server wired the way main.ts wires it, with a stand-in for Next. */
async function listen(routes: readonly ApiRoute[]): Promise<number> {
  const server = createServer(
    serveApiRoutes(routes, (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' }).end('next')
    }),
  )
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return (server.address() as AddressInfo).port
}

describe('the API routes served ahead of Next', () => {
  it('answers its own paths with uncached JSON', async () => {
    const port = await listen([tables])
    const response = await fetch(`http://127.0.0.1:${port}/api/tables/by-code/RIVER2?from=menu`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = await response.text()
    expect(response.headers.get('content-length')).toBe(String(Buffer.byteLength(body)))
    expect(JSON.parse(body)).toEqual({ path: '/api/tables/by-code/RIVER2' })
  })

  it("hands every other request to Next, Next's own API routes included", async () => {
    const port = await listen([tables])
    for (const path of ['/', '/table', '/t/RIVER2', '/api/me', '/api/tablesish']) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`)
      expect(await response.text(), path).toBe('next')
    }
  })

  it('answers GET and HEAD and refuses the rest', async () => {
    const port = await listen([tables])
    const head = await fetch(`http://127.0.0.1:${port}/api/tables/by-code/RIVER2`, {
      method: 'HEAD',
    })
    expect(head.status).toBe(200)
    const post = await fetch(`http://127.0.0.1:${port}/api/tables/by-code/RIVER2`, {
      method: 'POST',
    })
    expect(post.status).toBe(405)
    expect(post.headers.get('allow')).toBe('GET, HEAD')
  })

  it('refuses a method the fetch API cannot represent instead of falling over', async () => {
    // new Request() throws on TRACE. Thrown inside the request listener, that
    // would take down the process holding every live table.
    const port = await listen([tables])
    const status = await new Promise<number | undefined>((resolve, reject) => {
      httpRequest({ host: '127.0.0.1', port, path: '/api/tables/by-code/RIVER2', method: 'TRACE' })
        .on('response', (response) => {
          response.resume()
          resolve(response.statusCode)
        })
        .on('error', reject)
        .end()
    })
    expect(status).toBe(405)
    expect((await fetch(`http://127.0.0.1:${port}/table`)).status).toBe(200)
  })

  it('answers a route that fails with a server error rather than hanging', async () => {
    const broken: ApiRoute = {
      prefix: '/api/broken/',
      handle: async () => {
        throw new Error('the directory went away')
      },
    }
    const port = await listen([broken])
    const response = await fetch(`http://127.0.0.1:${port}/api/broken/anything`)
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Something went wrong.' })
  })
})

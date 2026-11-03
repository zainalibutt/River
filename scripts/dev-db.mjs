// The development database: a local Supabase stack in Docker, for `npm run dev`
// and every test that needs Auth, REST or Postgres.
//
//   node scripts/dev-db.mjs start         start the stack (first run pulls images)
//   node scripts/dev-db.mjs reset         wipe it and start afresh with every migration
//   node scripts/dev-db.mjs migrate       apply migrations it has not had yet
//   node scripts/dev-db.mjs stop          stop it, keeping its data
//   node scripts/dev-db.mjs status        print its local addresses
//   node scripts/dev-db.mjs exec <cmd>    run a command against it
//
// `exec` hands the command the stack's URL and keys in its environment, read
// from the CLI each time and never written to a file. They override whatever
// .env.local says, because the server's dotenv load never replaces a variable
// that is already set.

import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import http from 'node:http'
import { createRequire } from 'node:module'
import net from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const cli = join(dirname(require.resolve('supabase/package.json')), 'dist', 'supabase.js')
// Services River never calls. Leaving them out keeps the stack small and quick to start.
const excluded = [
  'realtime',
  'storage-api',
  'imgproxy',
  'postgres-meta',
  'studio',
  'edge-runtime',
  'logflare',
  'vector',
  'supavisor',
]

function supabase(args, options = {}) {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    ...options,
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1', ...options.env },
  })
}

export function isLocalUrl(value) {
  const url = new URL(value)
  return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
}

function status() {
  let parsed
  try {
    parsed = JSON.parse(supabase(['status', '-o', 'json'], { stdio: ['ignore', 'pipe', 'ignore'] }))
  } catch {
    throw new Error('The local database is not running. Start it with: npm run db:start')
  }
  if (typeof parsed.API_URL !== 'string' || !isLocalUrl(parsed.API_URL)) {
    throw new Error('Refusing a database that is not on this machine')
  }
  return parsed
}

/**
 * Docker Desktop on Windows publishes a container's ports on every interface
 * unless told otherwise. The CLI does not tell it, so its requests go through
 * this proxy, which pins every published port to the loopback address.
 */
async function loopbackDocker() {
  if (process.platform !== 'win32') return null
  const pipe = '\\\\.\\pipe\\dockerDesktopLinuxEngine'
  const proxy = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      let body = Buffer.concat(await Array.fromAsync(request))
      if (request.method === 'POST' && url.pathname.endsWith('/containers/create')) {
        const config = JSON.parse(body.toString())
        for (const bindings of Object.values(config.HostConfig?.PortBindings ?? {})) {
          for (const binding of bindings ?? []) binding.HostIp = '127.0.0.1'
        }
        body = Buffer.from(JSON.stringify(config))
      }
      const headers = { ...request.headers, 'content-length': String(body.length) }
      delete headers['transfer-encoding']
      const upstream = http.request(
        { socketPath: pipe, path: request.url, method: request.method, headers },
        (result) => {
          response.writeHead(result.statusCode ?? 502, result.headers)
          // A wait answers with its headers long before its body: pass them on now.
          response.flushHeaders()
          result.pipe(response)
        },
      )
      upstream.on('error', () => response.writeHead(502).end('Docker is not reachable'))
      upstream.end(body)
    } catch {
      response.writeHead(500).end('Docker proxy failed')
    }
  })
  // Attaching to a container upgrades the connection to a raw stream, which
  // Node hands here rather than to the handler above.
  proxy.on('upgrade', (request, socket, head) => {
    const upstream = net.connect(pipe, () => {
      const lines = [`${request.method} ${request.url} HTTP/${request.httpVersion}`]
      for (let index = 0; index < request.rawHeaders.length; index += 2) {
        lines.push(`${request.rawHeaders[index]}: ${request.rawHeaders[index + 1]}`)
      }
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`)
      if (head.length > 0) upstream.write(head)
      socket.pipe(upstream).pipe(socket)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
  })
  proxy.listen(0, '127.0.0.1')
  await once(proxy, 'listening')
  return proxy
}

/** Run the CLI through the loopback proxy, printing only the tail of a failure, keys masked. */
async function cliThroughLoopback(args) {
  const proxy = await loopbackDocker()
  const env = { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' }
  if (proxy !== null) {
    env.DOCKER_HOST = `tcp://127.0.0.1:${proxy.address().port}`
    delete env.DOCKER_CONTEXT
    delete env.DOCKER_TLS_VERIFY
    delete env.DOCKER_CERT_PATH
  }
  const child = spawn(process.execPath, [cli, ...args], {
    cwd: root,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk
  })
  child.stderr.on('data', (chunk) => {
    output += chunk
  })
  const [code] = await once(child, 'exit')
  proxy?.closeAllConnections()
  proxy?.close()
  // The CLI prints the keys; they stay out of terminals and logs.
  const safe = output
    .replace(/eyJ[\w.-]+/g, '[key]')
    .replace(/sb_(?:secret|publishable)_[\w-]+/g, '[key]')
    .replace(/postgres(?:ql)?:\/\/\S+/g, '[database url]')
  if (code !== 0) console.error(safe.split('\n').slice(-15).join('\n'))
  return code ?? 1
}

async function start() {
  const code = await cliThroughLoopback(['start', '--exclude', excluded.join(',')])
  if (code !== 0) return code
  const running = status()
  console.log(
    `Local database running: API ${running.API_URL}, mail ${running.INBUCKET_URL ?? running.MAILPIT_URL ?? 'off'}`,
  )
  return 0
}

function developmentEnv() {
  const running = status()
  const mail = running.INBUCKET_URL ?? running.MAILPIT_URL
  return {
    SUPABASE_URL: running.API_URL,
    SUPABASE_ANON_KEY: running.ANON_KEY,
    SUPABASE_PUBLISHABLE_KEY: running.PUBLISHABLE_KEY ?? running.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: running.SERVICE_ROLE_KEY,
    // The names the local-only database tests look for.
    RIVER_BOT_CANARY_URL: running.API_URL,
    RIVER_BOT_CANARY_SERVICE_KEY: running.SERVICE_ROLE_KEY,
    RIVER_BOT_CANARY_ANON_KEY: running.ANON_KEY,
    ...(mail === undefined ? {} : { RIVER_CONNECTED_MAIL_URL: mail }),
  }
}

async function exec(command) {
  if (command.length === 0) throw new Error('Name a command to run against the local database')
  const env = { ...process.env, ...developmentEnv() }
  // Switches that write to a real project's tables stay off against this one.
  delete env.SUPABASE_PROJECT_REF
  delete env.SUPABASE_DB_PASS
  // Through a shell, so `npm` and the binaries npm puts on the path resolve on Windows too.
  const line = command.map((part) => (/[s"]/.test(part) ? JSON.stringify(part) : part)).join(' ')
  const child = spawn(line, { cwd: process.cwd(), env, stdio: 'inherit', shell: true })
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
  const [code] = await once(child, 'exit')
  return code ?? 1
}

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  switch (command) {
    case 'start':
      return start()
    case 'reset':
      // A fresh stack applies every migration as it starts, and starting is
      // what goes through the loopback proxy. `supabase db reset` recreates
      // the database container through calls the proxy cannot pass on.
      supabase(['stop', '--no-backup'], { stdio: 'inherit' })
      return start()
    case 'migrate':
      status()
      supabase(['migration', 'up', '--local'], { stdio: 'inherit' })
      return 0
    case 'stop':
      supabase(['stop'], { stdio: 'inherit' })
      return 0
    case 'status': {
      const running = status()
      console.log(`API ${running.API_URL}`)
      console.log(`Mail ${running.INBUCKET_URL ?? running.MAILPIT_URL ?? 'off'}`)
      return 0
    }
    case 'exec':
      return exec(rest[0] === '--' ? rest.slice(1) : rest)
    default:
      console.error(
        'Usage: node scripts/dev-db.mjs start | reset | migrate | stop | status | exec <command>',
      )
      return 2
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then(
    (code) => {
      process.exitCode = code
    },
    (error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    },
  )
}

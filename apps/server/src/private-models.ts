import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize } from 'node:path'

// Midas's networks and its preflop tables are never committed: production keeps
// them in a private storage bucket and copies them to local disk at start. The
// bucket holds a manifest.json naming every file with its hash, and the
// environment each path belongs in, relative to the copy.

export interface PrivateModelManifest {
  readonly files: readonly { readonly path: string; readonly sha256: string }[]
  readonly env: Readonly<Record<string, string>>
}

export interface PrivateModelOptions {
  supabaseUrl: string
  serviceRoleKey: string
  bucket: string
  directory: string
  fetch?: typeof fetch
  timeoutMs?: number
}

/** Only the variables a model path may set; anything else in a manifest is refused. */
const MODEL_VARIABLES = new Set([
  'RIVER_FLOP_NETWORK',
  'RIVER_TURN_NETWORK',
  'RIVER_TURN_START_NETWORK',
  'RIVER_RIVER_NETWORK',
  'RIVER_TURN_RESIDUAL',
  'RIVER_PREFLOP_PRIVATE_DIR',
])

/** A manifest path stays inside the copy: relative, no `..`, no drive. */
function insideCopy(directory: string, path: string): string {
  const clean = normalize(path)
  if (path === '' || isAbsolute(path) || clean.startsWith('..') || clean.includes(':'))
    throw new Error(`private models: path outside the copy: ${path}`)
  return join(directory, clean)
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function parsePrivateModelManifest(raw: unknown): PrivateModelManifest {
  const value = raw as Partial<PrivateModelManifest> | null
  if (value === null || typeof value !== 'object' || !Array.isArray(value.files))
    throw new Error('private models: manifest has no files')
  for (const file of value.files)
    if (typeof file?.path !== 'string' || !/^[0-9a-f]{64}$/.test(String(file?.sha256)))
      throw new Error('private models: manifest file needs a path and a sha256')
  const env = value.env ?? {}
  for (const [name, path] of Object.entries(env))
    if (!MODEL_VARIABLES.has(name) || typeof path !== 'string')
      throw new Error(`private models: manifest may not set ${name}`)
  return { files: value.files, env }
}

/**
 * Copies every file the bucket's manifest names into `directory`, checks each
 * hash, and returns the environment that points the bot at the copy. A file
 * already on disk with the right hash is not fetched again.
 */
export async function fetchPrivateModels(
  options: PrivateModelOptions,
): Promise<Record<string, string>> {
  const request = options.fetch ?? fetch
  const base = `${options.supabaseUrl.replace(/\/$/, '')}/storage/v1/object/${options.bucket}`
  const timeoutMs = options.timeoutMs ?? 60_000
  async function download(path: string): Promise<Uint8Array> {
    const response = await request(`${base}/${path.split('/').map(encodeURIComponent).join('/')}`, {
      headers: {
        apikey: options.serviceRoleKey,
        authorization: `Bearer ${options.serviceRoleKey}`,
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) throw new Error(`private models: ${path} answered ${response.status}`)
    return new Uint8Array(await response.arrayBuffer())
  }
  const manifest = parsePrivateModelManifest(
    JSON.parse(new TextDecoder().decode(await download('manifest.json'))),
  )
  for (const file of manifest.files) {
    const target = insideCopy(options.directory, file.path)
    const held = await readFile(target).catch(() => undefined)
    if (held !== undefined && sha256(held) === file.sha256) continue
    const bytes = await download(file.path)
    if (sha256(bytes) !== file.sha256) throw new Error(`private models: ${file.path} hash mismatch`)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, bytes)
  }
  return Object.fromEntries(
    Object.entries(manifest.env).map(([name, path]) => [name, insideCopy(options.directory, path)]),
  )
}

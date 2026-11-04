import { createHash } from 'node:crypto'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fetchPrivateModels, parsePrivateModelManifest } from './private-models.js'

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function bucket(objects: Record<string, string>) {
  const asked: string[] = []
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).split('/storage/v1/object/models/')[1] ?? ''
    asked.push(path)
    expect((init?.headers as Record<string, string> | undefined)?.authorization).toBe(
      'Bearer service',
    )
    const body = objects[decodeURIComponent(path)]
    return body === undefined ? new Response('missing', { status: 404 }) : new Response(body)
  }) as typeof globalThis.fetch
  return { fetch, asked }
}

const flop = 'flop network bytes'
const manifest = {
  files: [{ path: 'flop/net.bin', sha256: hash(flop) }],
  env: { RIVER_FLOP_NETWORK: 'flop/net' },
}

describe('fetchPrivateModels', () => {
  it('copies each file, checks its hash and points the environment at the copy', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'river-models-'))
    const { fetch, asked } = bucket({
      'manifest.json': JSON.stringify(manifest),
      'flop/net.bin': flop,
    })
    const options = {
      supabaseUrl: 'https://db.test/',
      serviceRoleKey: 'service',
      bucket: 'models',
      directory,
      fetch,
    }

    const env = await fetchPrivateModels(options)

    expect(env).toEqual({ RIVER_FLOP_NETWORK: join(directory, 'flop', 'net') })
    expect(await readFile(join(directory, 'flop', 'net.bin'), 'utf8')).toBe(flop)
    await fetchPrivateModels(options)
    expect(asked).toEqual(['manifest.json', 'flop/net.bin', 'manifest.json'])
  })

  it('refuses a file whose bytes do not match the manifest', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'river-models-'))
    const { fetch } = bucket({
      'manifest.json': JSON.stringify(manifest),
      'flop/net.bin': 'tampered',
    })

    await expect(
      fetchPrivateModels({
        supabaseUrl: 'https://db.test',
        serviceRoleKey: 'service',
        bucket: 'models',
        directory,
        fetch,
      }),
    ).rejects.toThrow('hash mismatch')
  })

  it('refuses variables that are not model paths and files without a hash', () => {
    expect(() => parsePrivateModelManifest({ files: [], env: { NODE_OPTIONS: 'x' } })).toThrow(
      'may not set NODE_OPTIONS',
    )
    expect(() => parsePrivateModelManifest({ files: [{ path: 'a', sha256: 'short' }] })).toThrow(
      'needs a path and a sha256',
    )
  })

  it('will not write outside the copy', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'river-models-'))
    const outside = { files: [{ path: '../escape.bin', sha256: hash('x') }], env: {} }
    const { fetch } = bucket({ 'manifest.json': JSON.stringify(outside), '../escape.bin': 'x' })

    await expect(
      fetchPrivateModels({
        supabaseUrl: 'https://db.test',
        serviceRoleKey: 'service',
        bucket: 'models',
        directory,
        fetch,
      }),
    ).rejects.toThrow('outside the copy')
  })
})

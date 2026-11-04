// Puts Midas's private models in a private storage bucket, where the server
// copies them from at start (apps/server/src/private-models.ts).
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/upload-private-models.mjs <dir> [bucket]
//
// <dir> is laid out as flop/, turn/, turnstart/ and river/ (each a network's
// river-buckets-128.bin and .json), residual/ (residual-0 and its parts) and
// preflop/v3/ (100bb.json, 200bb.json). The bucket, river-models unless named,
// is made private if it does not exist yet. Every file is uploaded, then a
// manifest.json with each file's hash and the environment the server sets.

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const [dir, bucket = 'river-models'] = process.argv.slice(2)
const url = process.env.SUPABASE_URL?.replace(/\/$/, '')
// A key pasted with the placeholder brackets still around it is cleaned up.
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim().replace(/^<|>$/g, '')
if (!dir || !url || !key)
  throw new Error('usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... <dir> [bucket]')

const env = {
  RIVER_FLOP_NETWORK: 'flop/river-buckets-128',
  RIVER_TURN_NETWORK: 'turn/river-buckets-128',
  RIVER_TURN_START_NETWORK: 'turnstart/river-buckets-128',
  RIVER_RIVER_NETWORK: 'river/river-buckets-128',
  RIVER_TURN_RESIDUAL: 'residual/residual-0',
  RIVER_PREFLOP_PRIVATE_DIR: 'preflop',
}
// A new-style secret key (sb_secret_...) goes in apikey alone; a legacy JWT goes in both.
const headers = key.startsWith('sb_')
  ? { apikey: key }
  : { apikey: key, authorization: `Bearer ${key}` }

function walk(at) {
  return readdirSync(at).flatMap((name) => {
    const path = join(at, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

async function put(path, body, type) {
  const response = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: { ...headers, 'content-type': type, 'x-upsert': 'true' },
    body,
  })
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`)
}

const made = await fetch(`${url}/storage/v1/bucket`, {
  method: 'POST',
  headers: { ...headers, 'content-type': 'application/json' },
  body: JSON.stringify({ id: bucket, name: bucket, public: false }),
})
const madeText = made.ok ? '' : await made.text()
if (!made.ok && !/already exists|Duplicate/i.test(madeText))
  throw new Error(`bucket ${bucket}: ${made.status} ${madeText}`)
const bucketInfo = await fetch(`${url}/storage/v1/bucket/${bucket}`, { headers })
if (!bucketInfo.ok || (await bucketInfo.json()).public !== false)
  throw new Error(`bucket ${bucket} is not private; stopping before any upload`)

const files = []
for (const file of walk(dir).sort()) {
  const path = relative(dir, file).split('\\').join('/')
  if (path === 'manifest.json') continue
  const bytes = readFileSync(file)
  await put(path, bytes, 'application/octet-stream')
  files.push({ path, sha256: createHash('sha256').update(bytes).digest('hex') })
  console.log(`uploaded ${path} (${bytes.length} bytes)`)
}
await put('manifest.json', JSON.stringify({ files, env }, null, 2), 'application/json')
console.log(`manifest.json: ${files.length} files in private bucket ${bucket}`)

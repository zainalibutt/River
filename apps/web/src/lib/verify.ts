export interface VerifyClientSeed {
  playerId: string
  seat: number
  seed: string
  defaulted: boolean
}

export type VerifyStatus = 'idle' | 'live' | 'match' | 'mismatch'

export interface VerifyResult {
  status: VerifyStatus
  recomputedCommit: string | null
  deckEntropy: string | null
}

const SEED_PATTERN = /^[0-9a-f]{64}$/i

export function isVerifySeed(value: string): boolean {
  return SEED_PATTERN.test(value)
}

function hexToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2)
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource)
  return bytesToHex(new Uint8Array(digest))
}

/**
 * Recompute SHA-256 over the seed BYTES, not the hex string. The server hashes
 * the decoded bytes, so hashing the text would never match and the panel would
 * cry mismatch on a perfectly honest hand.
 */
export async function recomputeCommit(serverSeed: string): Promise<string | null> {
  if (!isVerifySeed(serverSeed)) return null
  return sha256(hexToBytes(serverSeed))
}

/**
 * Deck entropy is SHA-256 over the server seed followed by every client seed in
 * SEAT ORDER. Seat order is public and fixed before the deal, which is what
 * stops the ordering itself from being a lever.
 */
export async function recomputeDeckEntropy(
  serverSeed: string,
  clientSeeds: readonly VerifyClientSeed[],
): Promise<string | null> {
  if (!isVerifySeed(serverSeed)) return null
  if (!clientSeeds.every((entry) => isVerifySeed(entry.seed))) return null
  const ordered = [...clientSeeds].sort((left, right) => left.seat - right.seat)
  return sha256(concat([hexToBytes(serverSeed), ...ordered.map((entry) => hexToBytes(entry.seed))]))
}

export async function verifyHand(
  commit: string | null,
  serverSeed: string | null,
  clientSeeds: readonly VerifyClientSeed[] | null,
): Promise<VerifyResult> {
  if (commit === null) return { status: 'idle', recomputedCommit: null, deckEntropy: null }
  if (serverSeed === null) return { status: 'live', recomputedCommit: null, deckEntropy: null }

  const recomputedCommit = await recomputeCommit(serverSeed)
  if (recomputedCommit === null) {
    return { status: 'mismatch', recomputedCommit: null, deckEntropy: null }
  }
  const deckEntropy = await recomputeDeckEntropy(serverSeed, clientSeeds ?? [])
  return {
    status: recomputedCommit.toLowerCase() === commit.toLowerCase() ? 'match' : 'mismatch',
    recomputedCommit,
    deckEntropy,
  }
}

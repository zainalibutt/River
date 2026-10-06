import { createHash, randomBytes } from 'node:crypto'

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

export function randomSeed(): string {
  return randomBytes(32).toString('hex')
}

export function commitSeed(seed: string): string {
  return sha256Hex(seed)
}

export function verifyCommit(commit: string, seed: string): boolean {
  return commitSeed(seed) === commit
}

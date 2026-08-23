import { createHash } from 'node:crypto'

export async function sha256Hex(input: string): Promise<string> {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

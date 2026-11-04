/** Retained typed-array payload, counted once per backing buffer (not JS overhead). */
export function bufferBytes(value: unknown, seen = new Set<object>()): number {
  if (value === null || typeof value !== 'object' || seen.has(value)) return 0
  seen.add(value)
  if (ArrayBuffer.isView(value)) return bufferBytes(value.buffer, seen)
  if (value instanceof ArrayBuffer || value instanceof SharedArrayBuffer) return value.byteLength
  if (value instanceof Map) {
    let bytes = 0
    for (const entry of value.values()) bytes += bufferBytes(entry, seen)
    return bytes
  }
  return Object.values(value).reduce<number>((sum, entry) => sum + bufferBytes(entry, seen), 0)
}

export function solveCacheMemory(cache: ReadonlyMap<string, unknown>) {
  let records = 0
  let leaves = 0
  let cards = 0
  let recordBytes = 0
  for (const value of cache.values()) {
    const record = (value as { record?: { leaves: Map<string, { cards: Map<number, unknown> }> } })
      ?.record
    if (record === undefined) continue
    records += 1
    leaves += record.leaves.size
    for (const leaf of record.leaves.values()) cards += leaf.cards.size
    recordBytes += bufferBytes(record)
  }
  return { entries: cache.size, bytes: bufferBytes(cache), records, leaves, cards, recordBytes }
}

import { expect, it } from 'vitest'
import { hasPreflopPack, loadPreflopPack } from './bot-preflop-tables.js'
import { replayPreflopTranslation } from './bot-preflop-translation-audit.js'

/** The v3 pack is private; a fresh checkout skips the tests that play it. */
const v3 = hasPreflopPack('v3')

it.skipIf(!v3)(
  'replays 2 bb / 9 bb / 18 bb through the actual mapper and distinguishes legacy translation',
  () => {
    const log = { action: 'b200b900b1800c/kk/kk/kk', clientPos: 0 } as const
    const replay = (version: 'v2' | 'v3') =>
      replayPreflopTranslation(log, [loadPreflopPack(200, version)])
    expect(replay('v3').map((r) => r.status)).toEqual(['exact', 'exact', 'exact', 'exact'])
    expect(replay('v3').map((r) => r.prefix)).toEqual(['exact', 'exact', 'exact', 'exact'])
    expect(replay('v2')[0]?.status).toBe('translated')
    expect(replay('v2')[1]?.prefix).toBe('translated')
  },
)

it.skipIf(!v3)(
  'counts unsupported non-jam five-bet continuations instead of claiming exact matches',
  () => {
    const result = replayPreflopTranslation({ action: 'b250b900b1800b4000b8000c', clientPos: 1 }, [
      loadPreflopPack(200),
    ])
    expect(result[3]?.status).toBe('translated')
    expect(result[4]?.status).toBe('unsupported')
  },
)

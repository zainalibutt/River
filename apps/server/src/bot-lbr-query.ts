import type { BotPolicy, BotPolicyContextV1, Card } from '@river/engine'
import type { MoveClass } from './bot-lbr-range.js'

export type HoldingShares = (hole: readonly [Card, Card]) => number

/** Synchronous, opt-in scope for pure numeric solve results in disposable queries.
 * The live policy never enters this scope. Each branch gets a deep copy, so
 * strategies and carried promise records cannot mutate another branch.
 */
export class LbrQueryMemo {
  private readonly entries = new Map<object, Map<string, unknown>>()
  hits = 0

  value<T>(owner: object, input: unknown, compute: () => T): T {
    let entries = this.entries.get(owner)
    if (!entries) {
      entries = new Map()
      this.entries.set(owner, entries)
    }
    const key = JSON.stringify(input, (_key, value) =>
      value instanceof Map
        ? [...value]
        : ArrayBuffer.isView(value)
          ? Array.from(value as unknown as ArrayLike<number>)
          : value,
    )
    if (entries.has(key)) {
      this.hits++
      return structuredClone(entries.get(key)) as T
    }
    const result = compute()
    // Only cloneable data can enter this memo, never closures or live solvers.
    entries.set(key, structuredClone(result))
    if (entries.size > 12) entries.delete(entries.keys().next().value as string)
    return result
  }
}

let activeMemo: LbrQueryMemo | undefined

export function withLbrQueryMemo<T>(memo: LbrQueryMemo | undefined, run: () => T): T {
  const previous = activeMemo
  activeMemo = memo
  try {
    return run()
  } finally {
    activeMemo = previous
  }
}

export function memoLbrSolve<T>(
  owner: object,
  input: unknown,
  compute: (memoized: boolean) => T,
): T {
  return activeMemo ? activeMemo.value(owner, input, () => compute(true)) : compute(false)
}

/** Optional distribution hook. Call only on a disposable, isolated query policy. */
export interface LbrQueryPolicy extends BotPolicy {
  moveShares?(context: BotPolicyContextV1, taken: MoveClass): HoldingShares | null
}

export function policyMoveShares(
  policy: BotPolicy,
  context: BotPolicyContextV1,
  taken: MoveClass,
): HoldingShares | null {
  return (policy as LbrQueryPolicy).moveShares?.(context, taken) ?? null
}

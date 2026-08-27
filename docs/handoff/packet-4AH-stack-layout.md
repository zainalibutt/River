# Packet 4AH — Where a player's chips sit

**Owner:** DeepSeek. **Reviewer:** Claude.

Read `docs/handoff/deepseek-laws.md` first.

---

## Why this packet

The client draws chip stacks as a fixed grid of 36 cylinders in one spot on the
felt, unrelated to what anyone has in front of them. It was also drawing them at
240mm across against a real chip's 39mm, which I have just fixed - but the
layout is still a decoration rather than a readout.

`chip-stacks.ts` already breaks an amount into denominations and guarantees the
breakdown sums exactly to the stack. **This is the spatial half**, and it must
compose that module rather than re-deriving the split.

## Files you may create or modify

- **CREATE** `packages/engine/src/stack-layout.ts`
- **CREATE** `packages/engine/src/stack-layout.test.ts`
- **MODIFY** `packages/engine/src/index.ts` — exactly one export line

Nothing else. Do not modify `chip-stacks.ts`.

## What to build

```ts
export interface StackColumn {
  denomination: number
  count: number
  /** Metres from the seat's own anchor, along the felt. */
  offsetX: number
  offsetZ: number
}

export function stackLayout(amount: number, options?: StackLayoutOptions): StackColumn[]
```

Rules:

1. **Compose `chip-stacks.ts`** for the denomination breakdown.
2. **Columns cap at a maximum height** (default 20 chips) and spill into a new
   column beside the first rather than growing indefinitely. A hundred-chip
   tower is not a thing anyone has seen on a table.
3. **Columns are laid left to right, highest denomination nearest the player.**
4. **Adjacent columns never overlap**: spacing is at least one chip diameter,
   configurable, default 0.042m against a 0.039m chip.
5. **Zero yields no columns** - not one column of zero. A zero-height column is
   a defect you only notice at a low camera.

## Hard constraints

- **Pure and total.** No clock, no randomness, no throwing. Negative or
  non-finite amounts return an empty layout.
- Metres, and the chip diameter is a named default rather than a literal.

## Tests

Beyond the per-rule cases, two that matter most:

1. **Nothing is lost.** For a hundred amounts across the range, assert
   `sum(count * denomination)` equals the input exactly. A layout that looks
   right and quietly drops a 500 chip is the worst outcome available on a table
   with a ledger behind it.
2. **Nothing overlaps.** For the same hundred, assert no two columns sit within
   a chip diameter of each other. Overlapping columns render as one fused blob
   and are invisible in a still.

## Gates

`npm run lint && npm run typecheck && npm test`, all green. `npm test`, never
`npx vitest`. Typecheck before trusting your own suite.

## Commit and report

Law 1: stage only your three paths, `git diff --cached --name-only` before
committing. I am in `apps/web`; Codex is in `art/pipeline` on the Rooftop rig.

Law 7: Zain alone. No trailer, no attribution, no emoji.

Finish with exactly: `READY FOR CLAUDE`

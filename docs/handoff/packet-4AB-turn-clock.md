# Packet 4AB — The turn clock

**Owner:** DeepSeek. **Reviewer:** Claude.

Read `docs/handoff/deepseek-laws.md` first.

---

## First, 4AA

Accepted. The table scheduler is correct and the tests do the thing that
matters - the nine-constant-talkers case fails if ordering and spacing are
satisfied separately, which is the failure mode that packet existed to prevent.

## Why this packet

`docs/design/22-shot-composition.md` records the one HUD element the reference
lets be large and persistent: an amber pin above the acting player carrying a
**sweeping clock hand**. It earns its size because between actions it answers
the only live question - whose turn, and how long is left.

River has per-street turn budgets in the spec (15 / 20 / 20 / 25 seconds, with
the urgency ring at 50 percent) and **no module that models them**. The client
reads a deadline off the room view ad hoc in one component. There is nothing
pure, nothing tested, and nothing a renderer can share.

## Files you may create or modify

- **CREATE** `packages/engine/src/turn-clock.ts`
- **CREATE** `packages/engine/src/turn-clock.test.ts`
- **MODIFY** `packages/engine/src/index.ts` - exactly one export line

Nothing else.

## What to build

```ts
export type TurnPhase = 'idle' | 'running' | 'urgent' | 'expired'

export interface TurnClock {
  phase: TurnPhase
  remainingMs: number
  /** 1 at the start of the turn, 0 at the deadline. Clamped. */
  fraction: number
  /** Degrees clockwise from twelve o'clock, for the sweeping hand. */
  handDegrees: number
  /** True once fraction has crossed the urgency threshold. */
  urgent: boolean
}

export function turnBudgetMs(street: Street, config?: TurnClockConfig): number
export function turnClock(
  deadlineMs: number | null,
  nowMs: number,
  budgetMs: number,
  config?: TurnClockConfig,
): TurnClock
```

Rules:

1. **Budgets come from config, not from the body.** Defaults 15 / 20 / 20 / 25
   seconds for preflop / flop / turn / river, expressed as named defaults that a
   caller can override. Law: game numbers are config-driven, never hardcoded.
2. **Urgency at 50 percent** of the budget remaining, also configurable.
3. `deadlineMs === null` gives `idle`, fraction 1, handDegrees 0.
4. Past the deadline gives `expired`, fraction 0, remainingMs 0 - never negative.
5. `handDegrees` runs 0 to 360 as fraction runs 1 to 0, so the hand sweeps a full
   circle over the turn.

## Hard constraints

- **Pure.** No `Date.now()`. Time arrives as `nowMs`. This is the same rule that
  made the economy module testable and it is not negotiable.
- **Total.** No throwing. A negative budget, a NaN deadline or a nowMs before the
  turn started must all produce a sensible clock rather than an exception.
- Do not import from `apps/`. Engine stays pure.

## Tests

Beyond the per-rule cases, three that matter:

1. **The hand sweeps monotonically.** Sample twenty points across a budget and
   assert `handDegrees` never decreases and ends at 360.
2. **Urgency fires once and stays.** Walk time forward across the threshold and
   assert `urgent` goes false to true and never flips back.
3. **A clock past its deadline is expired, not negative.** Assert remainingMs is
   exactly 0 and fraction exactly 0 at deadline plus a full budget.

Write at least one test that fails if `fraction` and `handDegrees` are wired to
each other in the wrong direction. Getting that backwards produces a hand that
sweeps anticlockwise and every other test still passes.

## Gates

`npm run lint && npm run typecheck && npm test`, all green.

**`npm test`, never `npx vitest`** - the latter tests a stale `dist`. Run
typecheck before trusting your own suite.

## Commit and report

Law 1: stage only your three paths by name and run
`git diff --cached --name-only` immediately before committing. Another lane is
live in this working copy.

Law 7: authored by Zain alone. No trailer, no attribution, no emoji.

Law 8: what you did, what you did not, and anything you are unsure about.

Finish with exactly: `READY FOR CLAUDE`

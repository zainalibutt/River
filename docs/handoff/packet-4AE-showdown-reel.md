# Packet 4AE — The showdown, as a sequence

**Owner:** DeepSeek. **Reviewer:** Claude.

Read `docs/handoff/deepseek-laws.md` first.

---

## First, 4AD

Accepted. The empty-seat-returns-null rule is the one that mattered and you got
it, and asserting rank against `progressFor`'s own output rather than a literal
string is exactly right - that test survives a tuning change.

Your type note was the useful kind: a `Partial<NameplateInput> & { playerId }`
helper is self-contradictory and typecheck caught it before the suite could,
which is the third time on this project that running typecheck first has saved a
packet. `rankIndex` as the 1-based level is fine; leave it.

## Why this packet

`docs/design/22-shot-composition.md` records that the reference's showdown is
**not a state, it is a cinematic**: the camera cuts away, holds on the winner
mid-celebration, then shows a graphic card with the hand laid out and
`NAME WINS 9,225`.

River settles a hand and moves on. There is no sequence, no timing, and nothing
that says who is shown, in what order, or for how long.

The engine half of that is a **reel**: an ordered list of beats with durations,
derived from a settled hand. The client plays it. Nothing in the engine touches
a camera or a clock.

## Files you may create or modify

- **CREATE** `packages/engine/src/showdown-reel.ts`
- **CREATE** `packages/engine/src/showdown-reel.test.ts`
- **MODIFY** `packages/engine/src/index.ts` — exactly one export line

Nothing else. **Compose `showdown-order.ts` and `hand-narrative.ts`**; do not
restate reveal order or re-derive hand names.

## What to build

```ts
export type ShowdownBeat =
  | { kind: 'reveal'; seat: number; atMs: number; holdMs: number }
  | { kind: 'name'; seat: number; hand: string; atMs: number; holdMs: number }
  | { kind: 'award'; seat: number; amount: number; atMs: number; holdMs: number }

export interface ShowdownReel {
  beats: ShowdownBeat[]
  totalMs: number
}

export function showdownReel(input: ShowdownInput, options?: ReelOptions): ShowdownReel
```

Rules:

1. **Reveal order comes from `showdown-order.ts`.** Import it.
2. **Hand names come from `hand-narrative.ts`.** If it returns null - and it
   does, deliberately, when hole cards are absent - **emit no `name` beat for
   that seat** rather than inventing one. That refusal is a feature and this
   packet must not paper over it.
3. Beats are **strictly ordered by `atMs`**, and `atMs` is cumulative from zero.
4. Every duration is configurable through `options` with named defaults. No
   magic numbers in the body.
5. **An uncontested pot has no reveals** - one award beat, nothing else. Nobody
   showed a hand, so nothing may be shown.
6. `totalMs` is the end of the last beat, and a reel with no beats is 0.

## Hard constraints

- **Pure and total.** No `Date.now()`, no randomness. This produces a plan, not
  a playback.
- A hand with one winner, a split pot, and an all-in side pot must all produce a
  coherent reel rather than throwing.
- Do not import from `apps/`.

## Tests

Beyond the per-rule cases, three that matter:

1. **A missing hand name drops the beat, not the seat.** Feed a seat whose hole
   cards are absent and assert its `reveal` and `award` beats survive while the
   `name` beat is absent.
2. **Beats never overlap and never go backwards.** Walk the list and assert each
   `atMs` is greater than or equal to the previous beat's `atMs + holdMs`.
3. **An uncontested pot produces exactly one beat.** This is the case a reel
   built from "reveal everyone then award" gets wrong, and it is the most
   common hand in a real game.

## Gates

`npm run lint && npm run typecheck && npm test`, all green. `npm test`, never
`npx vitest`. Typecheck before trusting your own suite.

`hygiene.test.ts` applies to comments too.

## Commit and report

Law 1: stage only your three paths, `git diff --cached --name-only` before
committing. I am in `apps/web`; Codex is in `art/pipeline`.

Law 7: Zain alone. No trailer, no attribution, no emoji.

Finish with exactly: `READY FOR CLAUDE`

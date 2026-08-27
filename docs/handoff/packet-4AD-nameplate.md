# Packet 4AD — The hold-to-show nameplate

**Owner:** DeepSeek. **Reviewer:** Claude.

Read `docs/handoff/deepseek-laws.md` first.

---

## First, 4AC

Accepted, verified against the built module rather than the report: precedence
is exclusive, a committed zero is not a bet, and a nine-seat table with one
actor leaves most seats showing nothing.

## Why this packet

`docs/design/22-shot-composition.md` records that the reference carries **no
persistent nameplates at a table**. Seats show tiny pins - which 4AC now models
- and full plates appear only while a key is held, at which point they may
occlude freely because they are momentary.

River shows permanent seat plaques over the scene. I am replacing them with a
hold-to-show overlay and need the row model behind it.

## Files you may create or modify

- **CREATE** `packages/engine/src/seat-nameplate.ts`
- **CREATE** `packages/engine/src/seat-nameplate.test.ts`
- **MODIFY** `packages/engine/src/index.ts` — exactly one export line

Nothing else. Do not modify `rep-progression.ts` or `seat-pin.ts`; compose them.

## What to build

```ts
export interface NameplateInput {
  seat: number
  playerId: string | null
  name: string | null
  stack: number
  rep: number
  folded: boolean
  sittingOut: boolean
  disconnected: boolean
}

export interface Nameplate {
  seat: number
  name: string
  stack: number
  rank: string
  rankIndex: number
  /** Shown under the name when the seat is not settled into the hand. */
  note: 'folded' | 'sitting out' | 'reconnecting' | null
}

export function nameplate(input: NameplateInput): Nameplate | null
export function nameplates(seats: readonly NameplateInput[]): Nameplate[]
```

Rules:

1. **A seat with no `playerId` returns `null`.** An empty chair has no
   nameplate. Rendering a blank one is how a table ends up ringed with nine grey
   rectangles, which is the opposite of what this packet is for.
2. **A missing name falls back to a stable label** derived from the seat, never
   to an empty string and never to "undefined".
3. **Rank comes from `rep-progression.ts`.** Import it. Do not restate the
   thresholds - they are config-driven and a second copy will drift.
4. `note` precedence, highest first: `reconnecting`, then `sitting out`, then
   `folded`, then null. A disconnected player who has also folded is
   reconnecting first, because that is the thing another player needs to know.
5. `nameplates` preserves seat order and drops the nulls.

## Hard constraints

- **Pure and total.** No clock, no randomness, no I/O.
- A negative or non-finite stack must not throw. Clamp and carry on.
- Do not import from `apps/`.

## Tests

Beyond the per-rule cases, three that matter:

1. **An empty seat produces no plate**, and a nine-seat table with three players
   returns exactly three rows in seat order.
2. **Rank tracks REP through the real progression** - assert against
   `rep-progression`'s own output at two different REP values, not against a
   hardcoded string, so the test survives a tuning change.
3. **The note precedence is exclusive.** A seat that is disconnected *and*
   sitting out *and* folded returns `reconnecting` - assert the single value,
   not merely that it is truthy.

## Gates

`npm run lint && npm run typecheck && npm test`, all green.

`npm test`, never `npx vitest`. Typecheck before trusting your own suite.

`hygiene.test.ts` fails the suite if any tracked file names the reference game
or calls River a clone. It applies to comments.

## Commit and report

Law 1: stage only your three paths and run `git diff --cached --name-only`
immediately before committing. I am in `apps/web`, Codex is in `art/pipeline`.

Law 7: Zain alone. No trailer, no attribution, no emoji.

Finish with exactly: `READY FOR CLAUDE`

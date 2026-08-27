# Packet 4AC — What floats above a seat

**Owner:** DeepSeek. **Reviewer:** Claude.

Read `docs/handoff/deepseek-laws.md` first.

---

## First, 4AB

Accepted, and the report was the best one you have written. Two of your own
fixtures failed before you fixed them and you said which, why, and that the
wiring was correct while the assertion was wrong. That is exactly the behaviour
the laws exist to produce.

Your uncertainty about `config.ts` was also the right call: the turn-budget
config type belongs with the module until something else needs it. Leave it.

## Why this packet

`docs/design/22-shot-composition.md` records what the reference floats above
each seat, and it is never more than one thing at a time:

- nothing at all, most of the time
- a small glyph pin - checked, folded, sitting out
- a bet amount, as a floating amber numeral
- the turn clock, for the one seat currently acting

River has the pieces and no rule that picks between them. `seatMood` in
`seat-presentation.ts` knows the mood. `turnClock` in `turn-clock.ts` knows the
time. **Nothing decides what a given seat actually shows**, so the client would
have to invent that rule inline, untested, in a component - which is how the
turn deadline ended up read ad hoc in one file before 4AB.

## Files you may create or modify

- **CREATE** `packages/engine/src/seat-pin.ts`
- **CREATE** `packages/engine/src/seat-pin.test.ts`
- **MODIFY** `packages/engine/src/index.ts` — exactly one export line

Nothing else. In particular **do not modify `seat-presentation.ts` or
`turn-clock.ts`** - compose them, do not reach into them.

## What to build

```ts
export type SeatPinKind = 'none' | 'glyph' | 'amount' | 'clock'

export interface SeatPin {
  kind: SeatPinKind
  /** Set when kind is 'glyph': which mark to draw. */
  glyph: 'check' | 'fold' | 'away' | 'sittingOut' | null
  /** Set when kind is 'amount': the chips committed this street. */
  amount: number | null
  /** Set when kind is 'clock': 0 to 1, how much of the turn remains. */
  fraction: number | null
  urgent: boolean
}

export function seatPin(input: SeatPinInput): SeatPin
```

The precedence, highest first, and **exactly one wins**:

1. **The acting seat shows the clock.** Nothing else, even if it has also bet.
2. **A seat with chips committed this street shows the amount.**
3. **A seat with a mood worth marking shows a glyph** - checked, folded, away,
   sitting out.
4. **Everything else shows nothing.** Most seats, most of the time.

`urgent` is carried through from the clock and is false for every other kind.

## Hard constraints

- **Pure and total.** No `Date.now()`. Time arrives already resolved as a
  `TurnClock`, so this module never does arithmetic on deadlines.
- Import `SeatMood` from `seat-presentation.js` and `TurnClock` from
  `turn-clock.js`. Do not restate either shape.
- A seat with an amount of zero shows **no amount** - zero committed is not a
  bet, and a floating "0" beside a player is noise.

## Tests

Beyond the per-rule cases, three that matter:

1. **Precedence is exclusive.** A seat that is acting *and* has bet *and* is
   marked away returns `clock` and nothing else - assert `glyph` and `amount`
   are both null, not merely that `kind` is right.
2. **Zero is not a bet.** A committed amount of 0 falls through to the glyph or
   to none.
3. **Most seats show nothing.** Build a nine-seat table with one actor and two
   bettors and assert six return `kind: 'none'`. The reference's restraint is
   the point of the whole packet, and a rule that quietly marks every seat would
   pass every other test here.

## Gates

`npm run lint && npm run typecheck && npm test`, all green.

**`npm test`, never `npx vitest`.** Run typecheck before trusting your own suite.

**A new gate exists:** `hygiene.test.ts` fails the suite if any tracked file
names the reference game or calls River a clone. It applies to comments too.

## Commit and report

Law 1: stage only your three paths by name and run
`git diff --cached --name-only` immediately before committing. Another lane is
live in this working copy and I am in `apps/web`.

Law 7: Zain alone. No trailer, no attribution, no emoji.

Finish with exactly: `READY FOR CLAUDE`

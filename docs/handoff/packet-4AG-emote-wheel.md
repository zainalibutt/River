# Packet 4AG — The emote wheel

**Owner:** DeepSeek. **Reviewer:** Claude.

Read `docs/handoff/deepseek-laws.md` first.

Take this **after** the chip-format rollover fix.

---

## Why this packet

`docs/roadmap.md` packet 4B calls for a **gamepad-friendly emote wheel**, and
`docs/spec.md` names emotes as one of four separate social systems. The wire
carries emotes already - the server rate-limits them, refuses them during your
own decision window, and interrupts them on poker-critical events.

**Nothing decides which emote a pointer is aiming at.** A radial selector is
pure geometry and it is exactly the kind of thing that gets written inline in a
component, untested, with an off-by-one at the wrap point that nobody notices
until an emote fires that the player did not choose.

## Files you may create or modify

- **CREATE** `packages/engine/src/emote-wheel.ts`
- **CREATE** `packages/engine/src/emote-wheel.test.ts`
- **MODIFY** `packages/engine/src/index.ts` — exactly one export line

Nothing else.

## What to build

```ts
export interface WheelSelection {
  /** Index into the emote list, or null when the pointer is in the dead zone. */
  index: number | null
  /** 0 to 1: how far the pointer is toward the outer edge. */
  reach: number
}

export function wheelSelection(
  x: number,
  y: number,
  count: number,
  options?: WheelOptions,
): WheelSelection
```

Rules:

1. **A dead zone in the middle selects nothing.** Default radius 0.25 of the
   wheel. Resting a stick at centre must not pick an emote, and a stick that
   never quite returns to zero is the normal case, not the edge case.
2. **Segments are equal and centred on twelve o'clock.** With four emotes, the
   first spans the arc centred on straight up, not starting at it. Getting this
   wrong rotates every label by half a segment and looks almost right.
3. **The wrap is exact.** An angle a hair below twelve o'clock selects the last
   segment, a hair above selects the first, and there is no angle that selects
   nothing outside the dead zone.
4. `count` of 0 always returns null. `count` of 1 selects index 0 anywhere
   outside the dead zone.
5. `reach` is clamped to 1 - a stick reading beyond the unit circle is normal on
   real hardware.

## Hard constraints

- **Pure and total.** No `Math.random`, no clock, no throwing. Non-finite input
  returns a null selection rather than an exception.
- Screen space, not world space: `+y` is **down**, as every pointer event
  reports it. Getting this inverted mirrors the wheel top to bottom and is the
  single most likely defect in this packet.

## Tests

Beyond the per-rule cases, three that matter:

1. **Walk the full circle in one-degree steps for two, three, four, six and
   eight emotes.** Assert every step outside the dead zone returns a non-null
   index in range, and that the index changes exactly `count` times across the
   revolution. A wheel with a hole in it passes every spot check.
2. **The boundary is not shared.** For each segment edge, assert the angle just
   below and just above resolve to different, adjacent indices - including
   across twelve o'clock.
3. **Down is down.** Assert a pointer at straight down does not resolve to the
   segment a straight-up pointer resolves to, for an even count. This is the
   test that catches the inverted axis.

## Gates

`npm run lint && npm run typecheck && npm test`, all green. `npm test`, never
`npx vitest`. Typecheck before trusting your own suite.

`hygiene.test.ts` applies to comments too.

## Commit and report

Law 1: stage only your three paths, `git diff --cached --name-only` before
committing. I am in `apps/web`; Codex is in `art/pipeline`.

Law 7: Zain alone. No trailer, no attribution, no emoji.

Finish with exactly: `READY FOR CLAUDE`

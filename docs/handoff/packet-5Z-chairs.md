# Packet 5Z — Chairs that are chairs

**Owner:** Codex. **Reviewer:** Claude.

Read `docs/handoff/codex-laws.md`, then `docs/design/22-shot-composition.md`.

---

## The defect

Zain's words: "the guys all standing in a cylinder". He is right, and it is the
most visible single fault in the game.

`rooftop_chair_*` is a drum. The character is placed **inside** it, so from the
current camera you look down into an open cylinder with a torso sticking out.

Every seat in the reference is a chair: **a high curved back, a seat pad, a
chrome pedestal, and a foot ring**, with a crown emblem embroidered on the back.
The character sits **in front of** the back, never inside anything.

The chair already carries 1,432 triangles. That is more than enough. **The shape
is wrong, not the budget.**

## What to build

Rebuild the Rooftop chair as a real chair:

- A curved back rising behind the occupant's shoulder blades
- A seat pad the character sits on top of
- A single central pedestal, not a solid drum
- A foot ring near the base
- Keep the existing triangle budget; a drum is not cheaper than a chair

Then **place the character correctly against it** - seated on the pad, back to
the chair back. If the seated rest pose needs adjusting so the body reads as
sitting rather than embedded, adjust it.

## The second half, which matters as much

**Empty chairs are set dressing.** In the reference, three empty chairs sit in
the near foreground and frame the whole shot; they are why the table reads as a
real table rather than a ring of bodies.

So the chair has to look right **unoccupied**. Render one on its own and judge it
that way before judging a full table.

## Verification

The camera is moving to roughly 1.5m height and 3.2m radius this session - see
the composition spec. **Judge the chair from there, not from the current camera
and not from a Blender orbit.** A chair that reads at 4m looking down may be
wrong at 1.5m looking across, which is the whole lesson of the last two weeks.

Render an empty chair and an occupied one at the new camera and attach both.

## What not to do

- Do not touch `apps/web/`. The camera change is mine and in flight.
- Do not raise the triangle budget to solve a shape problem.
- Do not model the other two venues' chairs yet. Rooftop only - Zain's call.

## Gates and report

The pipeline's own build checks, plus `npm run lint && npm run typecheck &&
npm test`.

Law 1: stage only your own paths and run `git diff --cached --name-only` before
committing. Law 7: authored by Zain alone, no trailer, no emoji.

Republish, and check the byte counts changed. Finish with exactly:
`READY FOR CLAUDE`

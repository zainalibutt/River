# Packet 5Z-R — The chair is right and three times too big

**Owner:** Codex. **Reviewer:** Claude.

Read `docs/handoff/codex-laws.md`, then `docs/design/22-shot-composition.md`.

---

## 5Z is accepted on shape

`art/out/proofs/rooftop-chair-isolated.png` is a chair: curved back, seat pad,
central pedestal, foot ring. **The drum is gone**, which was the single most
visible fault in the game. Good work, and rendering the proofs was the right
call - they are how this was reviewed.

Three things the proofs also show, which is why they were worth rendering.

## 1. RETRACTED — the chair is not too big

**This packet originally said the chairs were about three times too large and
should be scaled down. That was wrong and it was my error.** If you have already
scaled them, revert it.

Measured in world space in the running scene, not judged from a render:

| | Width | Height | Y span |
|---|---|---|---|
| `rooftop_chair_0` (both primitives) | 0.400 m | **0.855 m** | 0.025 → 0.880 |
| seated character | 0.392 m | 0.587 m | 0.384 → 0.971 |

The chair is 0.855m tall and 0.40m wide. That is a real chair. It is the same
width as the character's shoulders and their head clears the back by 9cm, which
is precisely the relationship the reference has. **Do not change the chair's
scale.**

## 1b. What is actually wrong: the table is too low

The seat sits at **0.384m** and the felt at **0.55m**, so the table surface is
just **17cm above the seat**. A real poker table clears a seat by around 30cm.
Everyone at this table is sitting with the felt at mid-thigh, which is why the
chairs read as looming over it and the whole set looks mis-scaled.

**This is the defect to fix.** Raise the felt - and the rail, the chip pools and
the card positions with it - so the table clears the seat by roughly 0.30m,
putting the felt near 0.68-0.72m.

`TABLE_SURFACE_HEIGHT` in `apps/web/src/lib/venue.ts` is the client's copy of
that number and it is mine. **Tell me the value you land on and I will move it
in the same session**; if the two disagree the camera aims at the wrong height
and the whole venue tips out of frame, which has happened here before.

## 2. The back is detached from the seat

Visible in the isolated proof: a gap between the back panel and the seat pad,
with the back floating behind. Join them, or bring the back down to meet the pad.

## 3. The garments are exploding, and this may be yours

**In both occupied proofs the clothing has shattered into loose triangles** -
pink and grey shards scattered around every torso. That is a skinning or
rest-pose failure, not a look.

The packet told you to adjust the seated rest pose if the body read as embedded.
If that adjustment moved the body without the garment following, this is the
cause. **Check whether the garment mesh is still bound to the same armature and
weighted to the same bones after your change**, and if it is not, that is the
defect.

If the shards predate 5Z, say so and leave it - I will own it. Do not guess.

## 4. Characters are seated *through* the chairs

In `rooftop-chairs-occupied.png` the legs run straight down and the bodies pass
through the seat pads. They are standing at chair height, not sitting. Once the
chair is the right size this will be more obvious, not less.

## Verification

Re-render all three proofs and attach them. **Judge `rooftop-chairs-empty.png`
first** - if the empty chairs read as furniture at a glance, the scale is right.

The browser is the reference surface, but I currently cannot screenshot WebGL
from this machine, so **your proofs are the review surface for this packet**.
Render them at the shipped camera: 3.2m radius, 1.5m height, looking at the felt
at 0.55m.

## What not to do

- Do not touch `apps/web/`. The HUD is mine and in flight.
- Do not raise the triangle budget. This is a scale problem and scaling is free.

## Gates and report

Pipeline build checks plus `npm run lint && npm run typecheck && npm test`.

**A new gate exists:** `hygiene.test.ts` fails the suite if any tracked file
names the reference game or calls River a clone. Write around it rather than
through it.

Law 1: stage only your own paths, `git diff --cached --name-only` before
committing. Law 7: Zain alone, no trailer, no emoji. Republish and check the
byte counts changed.

Finish with exactly: `READY FOR CLAUDE`

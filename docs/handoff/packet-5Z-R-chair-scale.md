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

## 1. Scale — the headline

In `rooftop-chairs-empty.png` the chairs read as **standing stones**, not
furniture. Each back is about as tall and as wide as a seated person, and each
seat pad is wider than the person sitting on it.

The reference is unambiguous: a chair back is roughly **shoulder width**, and a
seated player **occludes most of it**. The chair is furniture behind a person,
never a slab beside one.

Target proportions, against the character rather than in absolutes so they
survive any future rescale:

- Back **width** ≈ the character's shoulder width, not more
- Back **height** ≈ from the seat pad to the character's mid-back, so the head
  and shoulders clear it entirely
- Seat pad **diameter** ≈ hip width plus a little, not wider than the shoulders
- Pedestal runs **from the floor to the seat**. In the isolated proof it is a
  short thin stalk and the whole assembly floats.
- Foot ring sits low on the pedestal and **reads as attached to it**

The test: at the current camera, a seated character should hide most of their
own chair. If you can read the chair better than the person, it is too big.

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

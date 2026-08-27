# Visual audit — the Rooftop, 2026-08-26

Audited in real Chrome against the running app, not in Blender and not from a
render. Zain's assessment was that the screen is slop. It is, and the assets are
not the reason.

## The headline

**Every venue passes the palette gate and the screen still looks wrong.** That
is the most useful thing this audit found. The gate reads base colours out of
the shipped file; what a player sees is those colours through a lighting rig, a
tone curve and a camera. Three of those four are unexamined.

The art assets measure correctly. The render does not.

## RETRACTED: "one light is doing all the work"

**This section claimed a 2.5x authored light spread became an 88x rendered
spread. That was wrong, and the error was mine.**

In three.js `RectAreaLight.intensity` is in nits (cd/m2) and
`SpotLight.intensity` is in candela. They are different units. Putting 49.92
next to 1.41 and calling it an 88x ratio compares a luminance to a luminous
intensity, which means nothing.

Worked correctly, illuminance at a surface is `L * A / d2` for an area light and
`I / d2` for a spot:

| Light | Relative illuminance delivered |
|---|---|
| LGT-sky-fill | 1.32 nits x 196 m2 / 7^2 = **5.3** |
| LGT-table (spot) | 49.92 cd / 3.9^2 = **3.3** |
| LGT-fire-key | 1.41 x 36 / 5^2 = **2.0** |

The sky fill delivers *more* light to the terrace than the spot does. The rig is
far more balanced than the retracted section claimed, and the `* 26` on the
caster is approximately a nits-to-candela bridge - the fills average around
30 m2 - rather than the hand-tuned fudge it was called.

**Do not tune `ENERGY_TO_INTENSITY` or the `* 26` on the strength of the
original claim.** Nothing here established that the conversion is wrong.

This is the second units error in one session, after reading glTF's linear
`baseColorFactor` as sRGB in the palette gate. Both had the same shape: a number
read in the wrong space, reported confidently, and acted on before it was
checked.

## What that produces on screen

- **The floor is the largest and brightest thing in frame, at night.** Its base
  is `#788183` in sRGB, a mid grey - not a night surface to begin with - and a
  50-intensity warm spot pushes it to beige. The eye lands on the floor rather
  than on the table.
- **The coloured fills read as stains, not light.** The pool light leaves a
  magenta ellipse on the terrace that looks like something spilled, because at
  0.84 against 49.92 it tints without illuminating.
- **The palms read navy.** Their base is `#16241c`, a dark green. The only
  coloured light reaching them is the blue pool and blue sky fill, and there is
  no green anywhere in the rig, so green foliage renders blue. This is not the
  `COLOR_0` defect 5W fixed; that fix is correct in the file. This is the rig.

## Composition

- **The "choose an open seat" disc eats the nearest quarter of the frame.** It
  is the largest single element on screen and it is a dead control.
- **`POT 0` is the largest text on screen**, and it reads zero for most of a
  hand's life.
- The subject - felt, board, players - occupies a thin band across the middle.
- Nine `SIT` badges float at inconsistent distances with several overlapping
  characters' heads.

## Characters

All nine read as the same pink-red torso at this camera distance. The face
atlas, the nine distinct garment loadouts and the per-instance tinting are all
real work in the file and none of it survives the shot. Either the camera is
too far or the characters are not yet worth being close to; that is an art
direction decision, not a bug.

## Props

Pale spheres scattered on the terrace and a single lone cone read as primitives
rather than objects. They are the least finished thing in frame and the eye
finds them because they are bright.

## Functional defects found while auditing

- **A page that outlives a server restart never recovers** and has to be
  hard-reloaded. Worth a reconnect that survives it.
- ~~The room socket does not stay connected.~~ **Retracted.** The drops were the
  duplicate-session handover doing its job against three tabs I did not know
  were open on the same table. The client says so plainly - "this table is open
  in another window" - and I read my own interference as a defect.
- **A hidden tab cannot be used to inspect the 3D scene at all**, and this cost
  several rounds before it was pinned down. R3F initialises its root from a
  `ResizeObserver`, which does not fire while `document.visibilityState` is
  `hidden`, so `onCreated` never runs, `window.riverScene` is never set and
  `riverFrame` does not exist. The canvas element is present the whole time,
  which is what makes it look like a scene fault rather than an instrument one.

  Chrome's screenshot path has the same root cause from the other side: a
  background tab paints DOM but never composites the WebGL layer, so the HUD
  appears over an empty background.

  **Neither is a defect in River.** Reading pixels out through the page is also
  blocked, so from an agent's side the scene can only be measured when somebody
  has the tab fronted. Codex's Blender proof renders and the numbers from
  `riverFrame` are the reliable instruments; a screenshot is not.

## What to do, in order

1. **Measure the rendered frame before changing any constant.** Nothing in this
   repository measures what a player actually sees, which is how both of this
   session's units errors survived long enough to be written down. Until a
   rendered-frame measurement exists, every lighting change is a guess with a
   confident number attached.
2. **Re-grade the terrace.** A mid-grey floor is wrong for a night rooftop
   whatever the lighting does.
3. **Give the palms a light that has green in it**, or accept blue foliage as a
   deliberate choice and stop calling it a defect.
4. **Shrink the seat control and the pot.** They are sized like the subject and
   they are not the subject.
5. Only then judge the characters, which cannot be assessed until the room they
   sit in is lit correctly.

## The rule this belongs to

A gate that passes is not a picture that works. `venue-palette` answers one
narrow question about base colours in isolation and answers it correctly; it was
never evidence that a room reads. Nothing in this repository currently measures
the rendered frame, and every visual judgement so far has been made against
either Blender or the asset bytes.

**The frame is the artefact. Nothing measures it yet.**

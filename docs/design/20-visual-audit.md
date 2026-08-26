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

## The root cause: one light is doing all the work

The Blender rig authors five lights with energies from 130 to 320 - a 2.5x
spread, balanced deliberately. Read out of the running scene, the conversion
produces this:

| Light | Blender energy | three.js intensity | Ratio to weakest |
|---|---|---|---|
| LGT-table (shadow caster) | 240 | **49.92** | 88x |
| LGT-fire-key | 320 | 1.41 | 2.5x |
| LGT-sky-fill | 300 | 1.32 | 2.3x |
| LGT-pool | 190 | 0.84 | 1.5x |
| LGT-back-fill | 130 | 0.57 | 1x |

**A 2.5x authored spread becomes an 88x rendered spread.** The rig is
functionally one hot overhead spot with four tints that contribute almost
nothing.

Two separate scales are being applied. `intensityFor` in
`apps/web/src/lib/lighting.ts` is `energy * 0.008` for everything, then fills
take a further `* 0.55` attenuation, while the one shadow-casting light becomes
a `SpotLight` carrying roughly 26x that. The authored balance does not survive
the conversion.

`ENERGY_TO_INTENSITY` was already flagged in the lane log as a first guess never
verified by eye, with the note "tune that one number, never the individual light
energies". That note is not enough. **The problem is not the magnitude of one
constant, it is that area lights and the spot go through different scales**, so
no value of that constant recovers the ratios the rig was authored with.

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
- The in-app browser pane still reports `visibilityState: hidden` when fronted,
  so R3F sizes its canvas at 300x150 and nothing renders. Real Chrome remains
  the only instrument for anything visual.

## What to do, in order

1. **Fix the light conversion so the authored ratios survive it.** One scale for
   all light types, derived rather than guessed, checked against the lookdev
   render at the same exposure. This is the single change with the most effect
   on the picture.
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

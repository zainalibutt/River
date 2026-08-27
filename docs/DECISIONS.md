# Decisions

Decisions that shaped River, with the reasoning that produced them. A decision
is recorded here when reversing it would cost real work, or when the obvious
choice was rejected for a reason worth remembering.

Product decisions live in `spec.md`. Design contracts live in `design/`. This
file is the why.

---

## Three models, one repository, one owner

River is built by three AI models working in parallel — Claude on design,
review and client, Codex on server, security and long grinds, DeepSeek on
bounded deterministic engine modules — in a single working copy, with one
human owner directing them.

**Why not one model.** The work has genuinely different shapes. A crypto
construction wants adversarial reasoning; a pure state machine wants exhaustive
enumeration; a design contract wants judgement about what a player will feel.
Sending all three to the same place is either overkill or underpowered.

**What it cost.** The git index is shared state. Twice, one model's staged
files rode along in another's commit, and once a whole history rebuild was
needed to untangle four packets from three models out of a single commit. The
fix was `docs/handoff/deepseek-laws.md` — binding operating laws, each traced
to a specific incident rather than stated as a preference — and a habit of
running `git diff --cached --name-only` before every commit.

## Every packet is bounded to named files

A model is told exactly which files it may create or modify. Anything else is
out of scope, including files that look broken and files it could improve.

**Why.** Scope creep in a shared checkout is not thoroughness, it is a merge
conflict with someone else's live work. When DeepSeek found an unused import in
another model's file, the correct action was to report it and leave it — which
it did.

## Provably fair, or do not claim it

The original shuffle derived every hand from one room seed fixed at room
creation, and derived the public invite code from that same secret. A commit
proves the server did not change its mind after committing; it proves nothing
about how the seed was chosen.

**Decision.** Fresh 32-byte server seed per hand, commit published before any
client seed is known, deck entropy over server seed plus every client seed in
seat order, SHA-256 counter-mode stream, rejection-sampled Fisher-Yates, reveal
after settle. `mulberry32` has 2^32 states against 52! orderings and never
deals a real hand again.

**Rejected.** Keeping the room seed and documenting the limitation. A fairness
claim that does not hold is worse than no claim.

## Chips are unbuyable and uncashoutable

No code path may create a purchase route for chips, decoratively or otherwise.
The chip sink is table items, bought with chips already earned.

**Why.** It keeps River out of a regulatory category it has no business being
in, and it keeps every economy question about pacing rather than revenue.

## Flat plus streak, never percentage-compounding

Daily grants pay a flat base plus a streak bonus. Compounding was rejected:
15% a day turns 10,000 into roughly 400,000 in six weeks and warps every table
in the game.

The same rule holds for REP modifiers. Three +10% table items give +30%, not
+33.1%.

## Desktop v1, PS5 as a standing commitment

No console was available to test on, so the hardware spike could not run.
Rather than delay 3D indefinitely or claim evidence that does not exist, v1
targets the desktop browser and PS5 compatibility became a designed-for,
not-yet-verified commitment.

**What stays binding without a console in the room:** conservative asset
budgets sized for a console browser rather than a desktop GPU, controller
parity in the interaction model, and a deferred — not cancelled — hardware
spike.

## The pipeline is the venue, not the .blend file

Early venues existed only as `.blend` files on one drive, outside the
repository, regenerable by nothing. Every render shown was a photograph of work
rather than the work.

**Decision.** Everything that defines a venue — geometry, measured light rigs,
camera parameters, prop placement — lives in `art/pipeline/` as code, and the
build is the only way a venue comes into existence. `docs/design/14-venue-build-spec.md`
records the measured values that seeded it.

## Characters push realism, not stylisation

The first honest character renders read as neither: too little detail to be
convincing, too much attempt at anatomy to look deliberate. That is the worst
place to sit, because it reads as a limitation rather than a choice.

The obvious cheap answer was to go deliberately low-poly and call it a style.
**Rejected.** The reference game's characters are caricatured but unmistakably
people, with faces you read across the table, and the point of River is to match
that standard rather than route around it. Choosing stylisation here would have
been choosing it because it was easier, which is exactly the kind of corner the
brief says invalidates the result.

**What this cost, and what it turned out to be.** Four packets went into building
faces out of scaled spheres, each one a little better and none of them right. The
base character was an MPFB human all along: 8,221 vertices, a 137-bone rig, nine
authored poker clips, and a face with a nose, lips and a jaw. It was buried under
hair geometry authored as alpha cutouts and exported with no textures at all, so
it rendered as opaque ribbons hanging over the face. Every replacement face was
being bolted onto the outside of a head that was only ever occluded, and in one
render the real hands with fingers are visible at the frame edge beside the
primitive ones built to replace them.

Deleting all of it took the rooftop from 94,537 triangles to 62,499 and produced
a person. **The rule that would have caught this four packets earlier: before
adding, look at what is already there with everything else turned off.**

## Budgets are gates, not notes

Triangles, materials, draw calls, texture size and download size each fail the
build when exceeded. A check that records a failure and lets the build proceed
is a log line, not a gate.

**Learned the hard way.** The download budget did not exist, and venue assets
grew from 185KB to 12MB unnoticed, because nothing measured the number a player
actually waits for.

## Verify the instrument before believing the measurement

Five separate "defects" on this project turned out to be faulty instruments
rather than faulty code: a hot-reloading dev server, an incomplete scene reset
before a GLB import, a Blender launch flag that hid every add-on, a hidden
browser tab that starves the callbacks R3F needs to size a canvas, and a gate
that read stale data and silently passed everything.

**Rule.** Before trusting a measurement, prove the instrument can observe the
thing being measured. Parse the artefact rather than importing it. Test a gate
against a known-bad input. Assert the event happened before asserting the
invariant holds.

## Does anything actually call this?

Four engine modules were complete, tested, and wired to nothing: REP had no
producer, challenges had no tally, table items had no consumer, and the measured
light rigs shipped to a browser that ignored them. Each passed its own gates and
read as finished in the commit log.

**Rule.** With several lanes running, the seam between packets is where work
quietly dies. "Does anything actually call this?" is the first review question,
not the last.

## Art is judged where the player sees it, not where it is made

Two days of venue work were signed off from Blender renders. The browser was
drawing something else entirely: the camera outside the building looking at the
exterior wall, ten-metre starbursts where the palms should be, a daylight sky on
a night rooftop. The measured values were identical in both files.

Three separate faults, none visible from the pipeline side:

- The camera was hardcoded on the opposite side of the table from every light,
  because it never went through the coordinate conversion the lights use. Round
  venues, so it still rendered - it rendered the back of the room lit for the
  front.
- Blender fits a landscape camera's angle horizontally and three.js reads it
  vertically, so the measured 64 degrees asked for a frame most of a right angle
  too wide.
- Every lamp carried rotation zero, which in Blender means straight down. A
  three.js area light emits along its own local axis until something turns it,
  so the fourteen-metre sky fill was firing horizontally into the back wall.

**Decision.** The browser is the reference surface. The lookdev renders through
AgX, so the renderer does too - matching the view transform is not a preference,
it decides whether the two pictures can be compared at all. Every conversion
between the two spaces is one function with tests, and anything that needs those
numbers calls it rather than restating them.

**The instrument came first, in the end.** Four attempts to measure the running
scene failed because nothing exposed it, and each failure produced another
plausible guess. The canvas now hands its state to the window in development,
and the conversion bug was confirmed in one query rather than argued about.

## The expensive failures are the silent ones

Fixing the camera meant importing one function into the venue registry. That
closed a cycle, because the lighting module refers back to the registry for its
venue id. The scene loads through a dynamic chunk, and a cycle there resolves to
nothing at all.

Nothing threw. No console error. Typecheck passed, all 524 tests passed, lint was
clean, and the entire 3D table was absent from the page.

The same shape appeared twice more the same day: a sibling imported with the ESM
extension the engine uses, which Turbopack cannot resolve and the test runner
can; and a canvas measured after a CSS transform, laid out at 1619 by 911 inside
a 1920 by 1080 box, so the venue stopped short of two edges and every seat label
drifted away from the player it named.

**Rule.** A green suite is evidence about the code the suite runs, in the way it
runs it. It is not evidence that the application starts. Anything whose failure
mode is silence needs a check that fails loudly - which is why the animation
driver reports the clips a rig does not carry rather than playing nothing.

## Sound: generate the effects, licence the music, synthesise the voice

Nothing existed. Three sources, chosen separately because the constraints
differ.

**Effects are generated**, in the same Python pipeline that builds the venues. A
chip is a filtered noise burst with a resonant click and a randomised pitch; a
card slide is shaped noise with an envelope. Sourcing them would mean tracking
licences for a hundred short files to save an afternoon.

**Music is licensed, and the slot is left open.** A classical composition is
public domain; every commercial recording of it is not, and dropping a
favourite recording into a public repository publishes somebody's master.
Public-domain performances fill the slot for v1. The manifest carries an
attribution field per track and reads the licence from it, so an original
composition can replace a public-domain one without touching code - which is
the point, because original music is coming.

**Voice is synthesised**, and this was reversed. It was written off as the
expensive part until it was actually priced: a full pack for thirteen
characters is on the order of fifteen thousand characters of speech, which is
about a penny through an open-weights model. Deferring it would have been
deferring an afternoon's work on the strength of an assumption nobody checked.

*Rule this belongs to:* the cost of a thing is a number, not a feeling. It took
one search to turn "defer voice lines to v2" into "voice lines cost a penny".

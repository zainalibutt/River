# Decisions

The decisions that shaped River, with the reasoning behind them. A decision is
recorded here when reversing it would cost real work, or when the obvious choice
was rejected for a reason worth remembering.

Reference poker titles were studied for interaction, pacing and staging; River's
implementation and assets are its own. Where a code comment mentions "the
reference", it means that study.

---

## Ship the 2D table first; 3D stays optional

River launched with a 2D table as the default on every device, including a
portrait phone layout. The 3D venues and characters run on the same engine and
the same server messages, so they stay available on tables whose venue has a
chair for every seat. Shipping the 2D table first put the multiplayer loop, the
economy and the bots in front of players while the character animation was still
being reviewed. A renderer is a presentation choice; the rules, the hidden
information and the money never depend on it.

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

## The pipeline is the venue, not the .blend file

Early venues existed only as `.blend` files on one drive, outside the
repository, regenerable by nothing. Every render shown was a photograph of work
rather than the work.

**Decision.** Everything that defines a venue — geometry, measured light rigs,
camera parameters, prop placement — lives in `art/pipeline/` as code, and the
build is the only way a venue comes into existence. A measured venue-build study
seeded its values.

**Scope, from 13 September.** This still holds for every venue. It no longer
holds for a character's pose and garment fit, which are now made by hand in
Blender (see *Character art is hand-authored, with the models assisting*). The
pipeline still builds, exports and gates every character the browser loads; the
hand-authored `.blend` is the source for what the pipeline cannot regenerate,
and it is kept locally rather than in the repository while it is being worked.

## Characters push realism, not stylisation

The first honest character renders read as neither: too little detail to be
convincing, too much attempt at anatomy to look deliberate. That is the worst
place to sit, because it reads as a limitation rather than a choice.

The obvious cheap answer was to go deliberately low-poly and call it a style.
**Rejected.** Poker is played by reading people across a table, so the characters
need faces that read as people at table distance. Choosing stylisation here would
have been choosing it because it was easier.

**What this cost, and what it turned out to be.** Four passes went into building
faces out of scaled spheres, each one a little better and none of them right. The
base character was an MPFB human all along: 8,221 vertices, a 137-bone rig, nine
authored poker clips, and a face with a nose, lips and a jaw. It was buried under
hair geometry authored as alpha cutouts and exported with no textures at all, so
it rendered as opaque ribbons hanging over the face. Every replacement face was
being bolted onto the outside of a head that was only ever occluded, and in one
render the real hands with fingers are visible at the frame edge beside the
primitive ones built to replace them.

Deleting all of it took the rooftop from 94,537 triangles to 62,499 and produced
a person. **The rule that would have caught this four passes earlier: before
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

**Rule.** With several workstreams running, the seam between tasks is where work
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

## Sound effects are generated, not sourced

**Effects are generated**, in the same Python pipeline that builds the venues. A
chip is a filtered noise burst with a resonant click and a randomised pitch; a
card slide is shaped noise with an envelope. Sourcing them would mean tracking
licences for a hundred short files to save an afternoon, and generated effects
rebuild on a clean checkout like everything else.

Music is a separate problem: a public-domain composition is not a public-domain
recording. The audio manifest has a music slot that carries a licence and an
attribution per track, and both the build gate and the client refuse a track
without them. No music ships yet.

## One number for the Node floor

CI failed on every push for four days - 124 red runs against 3 green, the last
green being the third commit of the project - and the cause was four sources of
truth disagreeing about one number. `package.json` declared `engines >= 22`.
The README said 20. The CI matrix tested both. The deploy pinned 22.

`socket.ts` reads the global `WebSocket`, which Node exposes unflagged from 22,
and the web tests run under `environment: 'node'`. So the matrix was testing a
version the package already refused to support, against code that could not run
on it. Node 20 reached end of life in April 2026 and GitHub deprecates it on
its runners, so it was a configuration nobody could ship to.

Dropping 20 was chosen over patching `socket.ts` to avoid the global: the
declared floor was already 22, three of four sources agreed on it, and widening
support to a dead runtime to keep a red job green is the wrong direction. 24
replaced it, because that is what the work is actually done on.

*Rule this belongs to:* when a value is stated in four places, it is stated in
zero. This is the same fault as the two colour conversions and the two camera
tables, wearing a build badge instead of a render.

## Native gold character is the source, not a browser substitute

The first credible player is being built as one authored vertical slice before
the cast is multiplied. The MPFB body, its seated rig and its expression shapes
remain the source authority; the browser export is a measured translation of
that source rather than a second face made from convenient primitives. The
earlier substitute face and hair geometry was rejected when it failed the
Chrome read, even when its isolated numbers looked tidy.

This decision costs a little export work but removes the more expensive failure
mode: a Blender proof that is not the asset the player sees. The current export
keeps the real skin, dress, eye, brow, lash and ponytail textures, then maps the
parts glTF can represent to explicit browser PBR materials. A small fitted iris
material is intentional because the Blender eye shader graph does not survive
the glTF path faithfully. The proof is judged in Chrome at the actual Rooftop
camera, not only in Blender.

The gold character is deliberately confined to the Rooftop while it is under
review. Laundromat and Executive Suite remain deferred, and the other authored
identities do not start until this one passes the close, orbit and gameplay-size
checks. That keeps a face, hair or garment correction one change deep instead of
forcing a nine-seat rebuild.

The measured isolated proof currently passes 58,110 triangles, 30 materials,
46 draw calls and 6,096 KB. The additional material headroom is a conscious
trade for readable eye, brow, lash and iris treatment under the existing
120-draw-call and 6,144 KB venue gates. Corneal occlusion, gameplay-lighting
match, the final temple transition and couture garment termination remain open;
they are not silently promoted to acceptance by a green export.

*Rule this belongs to:* use one reproducible source of truth, and spend budget
on the feature the player actually reads. A committed artefact is a milestone,
not visual acceptance.

## The seated character is baked, not posed

`apply_seated_rest_pose` posed the rig and then called `bpy.ops.pose.armature_apply`,
which makes that pose the rest pose and zeroes every pose channel. The armature
modifier then computes pose times rest-inverse, which is identity, so every bound
mesh reverted to the standing vertices it was authored with. The seating was
being calculated and then discarded, and the characters stood beside their chairs
with their arms hanging. The venue compounded it by baking the other meshes from
the depsgraph after that apply, and by skipping the body mesh entirely.

The decision is to bake the seated deformation into the mesh by hand: capture
each bone's rest matrix before and after, then move every vertex by the blended
rest-to-rest transform of the bones that own it. That is ordinary linear blend
skinning, and it is what the modifier would have done had it been evaluated while
the rig was still posed. Afterwards the mesh, the rest pose and a zero pose all
agree on a seated character, so an animation delta of zero leaves him seated.

The alternative - keeping the pose live and authoring clips as seated base plus
delta - was rejected. It makes every clip carry a copy of the seated numbers,
which is the same value in two places, and it breaks the moment the venue applies
its own seated rest on import.

*Rule this belongs to:* if a transform has to survive an export, put it in the
data rather than in a pose that something downstream is entitled to reset.

## Character scale is measured against the furniture

`CHARACTER_SCALE` was 0.73 and carried no comment, which by this repository's own
convention means it was chosen rather than measured. It was compensating for the
seating bug above: while the characters were accidentally standing, a 1.75m
figure shrunk to 1.28m meets a 0.76m table at almost exactly the proportion a
seated adult does. The moment they genuinely sat, the same number made them
children - crown at 0.991m and eyeline 0.19m above the felt, against about 1.32m
and 0.44m for a seated adult.

The venue's own furniture is the reference, because it was already right: felt at
0.760m and chair backs at 0.920m are both real dimensions. Scale is now derived
from those, at 0.92, and the seat ring and the review camera heights derive from
it rather than restating it.

*Rule this belongs to:* a constant with no stated origin is a guess, and a guess
that compensates for a bug becomes wrong the moment the bug is fixed.

## Proof cameras must point where a defect can hide

The seating defect survived several reviews because every instrument pointed the
wrong way. It was invisible from the front, invisible from the gold review
camera, and invisible in every isolated character proof - the character renders
alone, with no chair to be wrong about. It was obvious the first time anyone
orbited behind the seat.

The decision is that a proof renderer reads the published venue build rather than
the character source, so what gets photographed is what actually ships, next to
the furniture it has to agree with; and that it shoots the angles a defect can
hide from rather than the angles that flatter the work. Hands get their own frame
with the venue hidden, because they sit within two centimetres of the rail top
and every outside camera has the rail across them.

*Rule this belongs to:* a review instrument that cannot see the failure is not
evidence of its absence.


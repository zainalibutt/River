# Where River is, and what a successor needs to know

Written 2026-08-26, brought up to date 2026-09-13. Read this, then
`docs/DECISIONS.md`. Between them there should be nothing about this project
that has to be rediscovered.

For the state of the work at a glance, `docs/board/` holds the build board —
`index.html` is the source of the published page and its README carries the
live URL. It is the surface to update as work lands.

## The shape of the work

Four models in one working copy, one human owner.

- **Claude** — design, review, the web client, the server, the art pipeline, and
  reconciling the others. Reviews every packet before it counts as done, and
  writes the briefs the other models work from.
- **Codex** — characters and the art pipeline. Bound by its own operating laws.
- **DeepSeek** — bounded deterministic engine modules. Bound by its own
  operating laws.
- **Fable** — expensive, used deliberately for work where judgement is the
  scarce thing rather than throughput. Its first law is about cost, because the
  budget is the user's own money and a wandering exploration spends it faster
  than a wrong answer does.

- **Sol and Astra** — the character lanes from September. Sol chooses each next
  step and the evidence it needs; Astra builds in Blender.
- **Zain** — the owner. From 13 September, character pose and garment fit are
  done by hand in Blender, with the models measuring, rendering and gating
  around that work.

Every lane's laws exist because of specific incidents, each one named in them.
They work. They are kept as working notes beside the handoff rather than in the
tracked tree; read them before writing a packet for any model.

## The single most important pattern on this project

**Six engine modules have been finished, tested, and wired to nothing.** REP,
challenges, table items, the measured light rigs, hand history, and the bots.
Each passed its own gates and read as complete in the commit log.

The seam between packets is where work quietly dies. **"Does anything actually
call this?" is the first review question, not the last.**

## The second most important pattern

**Art verified in Blender is not verified.** Four separate faults shipped
because they were checked in the renderer that does not exhibit them:

- the camera hardcoded on the opposite side of the table from every light
- Blender's horizontal field of view read as a vertical one
- lamp rotations ignored, so a fourteen-metre fill lit the back wall
- `COLOR_0` baked and checked in Blender, which ignores colour attributes
  unless a shader node reads them, while three.js multiplies by them
  automatically

The last one was fixed and published on 2 September; the palms are green in the
browser as well as in Blender.

**The browser is the reference surface.** The scene puts its camera, controls
and graph on `window.riverScene` in development for exactly this reason - four
attempts to measure it failed before that existed.

## Current state

909 tests across 79 files. Lint passes with three warnings - two CSS
specificity, one optional chain. Typecheck clean.

Narrow scope - the poker game itself - is essentially finished. Broad scope is
around ninety percent, and everything remaining is visible rather than
structural.

### What is done and live
Engine, server, auth, economy, REP, challenges, cosmetics, lobby, fairness with
commit and reveal, hand history with a replay scrubber, three venues built
entirely from Python, characters with faces and clothes, bots that seat
themselves and play, and an animation driver fed by live room events.

### What is not
- **Sound** — deferred. The whole plan, including why, is in
  `docs/handoff/audio-plan.md`. Do not restart it from scratch.
- **Voice lines** — the schema exists (`voice-lines.ts`), the lines do not.
- **Continuous deploy** — deliberately not. `deploy.yml` runs on a manual
  dispatch or a version tag, behind the full CI suite.
- **Console** — deferred by decision, not by effort. See DECISIONS.md.
- **A seated poker pose** — none is accepted yet. The silver character's
  standing black tie (A11) and seated default pose (A22) are accepted; the pose
  is now being finished by hand, and the black-tie wardrobe is not yet in the
  served venue.

## Things that will bite

- **The git index is shared.** Three collisions so far, one needing a history
  rebuild. Always `git diff --cached --name-only` before committing.
- **`npm test` runs `pretest`, which builds the engine.** Running `npx vitest`
  directly tests a stale `dist` and will lie to you.
- **`apps/web` resolves siblings through the `@` alias.** An ESM `.js`
  extension typechecks, passes every test, and fails in Turbopack with a blank
  page.
- **A cycle in a module the scene imports resolves to nothing** with no error,
  no console message, and every gate green. The 3D table simply is not there.
- **Published assets drift.** `art/out` is not what the app serves. Run
  `publish_assets.py`, and check the byte counts.
- **The in-app browser pane does not composite when hidden**, so R3F never
  sizes its canvas and nothing renders. Use real Chrome to judge anything
  visual.
- **Chrome can be hidden too.** A tab in a window that is not in front reports
  `document.hidden`, throttles timers and stops the render loop. Check
  `document.hidden` before believing anything a tab says, and step frames with
  the scene handle's `advance()` if the window cannot be brought forward.

## What I would do next, in order

As of 13 September. The earlier list - watch the characters move, the blue
palms, the palette gate, a deploy workflow - is done: the silver character's
head and spine move under the idle in Chrome, the palms are green, and
`deploy.yml` exists.

1. **The seated silver pose, by hand.** Zain is finishing it in Blender. When it
   is accepted, bring the black-tie wardrobe into the served venue - with the
   CC-BY attribution its jacket's donor topology carries.
2. **Amber's open items.** The report names a pale band in the collar V, two
   collar wings and deltoid highlights. Then decide whether Amber joins the
   venue.
3. **Bronze** continues.
4. **The other two venues** stay deferred until the Rooftop is finished.

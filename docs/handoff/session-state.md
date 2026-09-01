# Where River is, and what a successor needs to know

Written 2026-08-26. Read this, then `docs/DECISIONS.md`. Between them there
should be nothing about this project that has to be rediscovered.

For the state of the work at a glance, `docs/board/` holds the build board —
`index.html` is the source of the published page and its README carries the
live URL. It is the surface to update as work lands.

## The shape of the work

Four models in one working copy, one human owner.

- **Claude** — design, review, the web client, the server, the art pipeline, and
  reconciling the others. Reviews every packet before it counts as done, and
  writes the briefs the other models work from.
- **Codex** — characters and the art pipeline. Bound by
  `docs/handoff/codex-laws.md`.
- **DeepSeek** — bounded deterministic engine modules. Bound by
  `docs/handoff/deepseek-laws.md`.
- **Fable** — expensive, used deliberately for work where judgement is the
  scarce thing rather than throughput. Bound by `docs/handoff/fable-laws.md`,
  whose first law is about cost, because the budget is the user's own money and
  a wandering exploration spends it faster than a wrong answer does.

Both law files exist because of specific incidents, each one named in them.
They work. Read them before writing a packet for either model.

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

The last one is **open**: the Rooftop palms render green in Blender and blue in
the browser. Codex packet 5W has the diagnosis.

**The browser is the reference surface.** The scene puts its camera, controls
and graph on `window.riverScene` in development for exactly this reason - four
attempts to measure it failed before that existed.

## Current state

725 tests. Lint has one long-standing CSS specificity warning and is otherwise
clean. Typecheck clean.

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
- **Continuous deploy** — only `ci.yml` exists; Railway is manual.
- **Console** — deferred by decision, not by effort. See DECISIONS.md.

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

## What I would do next, in order

1. **Watch the characters move.** The clips landed in packet 5U and the mixer
   binding was corrected immediately after, but nothing has been seen animating
   yet. Expect at least one more fault; this scene has produced four.
2. **The blue palms** — Codex 5W.
3. **Wire the palette check as a gate.** DeepSeek's `venue-palette.ts` can
   answer "is the biggest thing in frame also the brightest", which is what was
   wrong with the Rooftop for two days. Nothing calls it yet, so it is
   currently the seventh module in the list above.
4. **Deploy.** One workflow file stands between this and a link somebody can
   click.

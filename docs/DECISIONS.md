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

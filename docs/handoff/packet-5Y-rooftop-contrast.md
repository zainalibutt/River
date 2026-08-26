# Packet 5Y — The Rooftop floor and its wall read as one shape

**Owner:** Codex. **Reviewer:** Claude.

Read `docs/handoff/codex-laws.md` first.

**Queued behind 5X.** Do not start this until 5X is committed and reported.

---

## The defect, as a number

The Rooftop terrace and the parapet that surrounds it are almost the same
value, so the floor and the wall read as a single mass rather than as a plane
and the thing standing on it.

| Surface | Base colour | Relative luminance |
|---|---|---|
| `rooftop_floor` | `#30383a` | 0.0376 |
| `rooftop_parapet` | `#2a2f3a` | 0.0283 |

**Contrast ratio 1.119**, against a threshold of 1.4. Each surface is over
twelve percent of the room's area, so this is two large shapes with nothing
separating them.

This is the "the Rooftop looks flat" complaint that has been open for two days
as a feeling. It is now a pair of hex values and a ratio.

## How it is measured, and how you know when it is fixed

`apps/web/src/lib/venue-art.test.ts` grades the shipped venue files against
`packages/engine/src/venue-palette.ts`. It weights every material by the
triangle area carrying it and by how often that mesh is instanced, and it
separates the room from the backdrop at twelve metres so that the mountains -
83.9 percent of the venue's triangles and a few hundred pixels of sky - do not
dominate the judgement.

**The gate is currently held out of the suite by an exclude in
`vitest.config.ts`.** Against your republished assets it already passes on the
Laundromat, on the Executive Suite, and on the room/backdrop split. This defect
is the only thing still failing it.

Run it:

```
npx vitest run --config <a config whose include is that one file>
```

or point it at a build before publishing:

```
RIVER_ASSET_DIR=art/out npx vitest run apps/web/src/lib/venue-art.test.ts
```

**When this packet is done, delete the exclude line in `vitest.config.ts`** so
the gate runs for every lane on every commit. That file is otherwise Claude's;
this one line is yours to remove, and removing it is part of the packet. A gate
that stays excluded is decoration.

## What to change

Separate the two in value. Some targets, computed against the current floor:

| Change | Resulting contrast |
|---|---|
| Parapet down to `#1e2229` | 1.332 |
| Parapet down to `#171b21` | **1.442** |
| Parapet up to `#3f4a4d` | 1.311 |
| Parapet up to `#454f52` | **1.423** |

Darker is the better direction here. A night rooftop wants the parapet reading
as a dark edge against a lit terrace, not as a second floor; lifting the
parapet instead would push it toward the skyline it is supposed to occlude.

**Do not chase the number.** 1.42 that looks wrong is worse than 1.39 that
looks right — if the honest answer is that the value separation should come
from the lighting rig rather than the base colour, say so and propose that
instead. The threshold is a floor for "two large shapes must be
distinguishable", not a target to hit exactly.

## What not to do

- **Do not weaken the check.** The 1.4 threshold and the 12 percent area rule
  live in `venue-palette.ts` and are not yours to adjust. If you believe the
  threshold is wrong, stop and report it with the reasoning - that is a
  decision, not a number to move.
- **Do not touch `apps/web/`** beyond deleting the one exclude line in
  `vitest.config.ts` named above.
- Do not restyle the other two venues. They pass.

## Verification

Republish, then run the gate against the published files - not against
`art/out`, and not from a Blender render. The whole point of this gate is that
it reads the bytes the player downloads.

Then look at it in real Chrome. A ratio clearing 1.4 while the room still reads
flat means the measurement and the eye disagree, which is worth knowing and
worth reporting rather than quietly satisfying the number.

## Gates and report

`npm run lint && npm run typecheck && npm test`, all green, with the exclude
removed so the palette gate is part of that run.

Law 1: stage only your own paths and run `git diff --cached --name-only`
immediately before committing.

Law 7: the commit is authored by Zain alone. No trailer, no attribution, no
emoji.

Finish with exactly: `READY FOR CLAUDE`

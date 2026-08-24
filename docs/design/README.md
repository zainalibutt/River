# River — design contract

Implementation-ready visual, behavioural and interaction contract for River.

This directory is the design equivalent of `docs/spec.md`: it is canonical. Where an implementation and this contract disagree, fix the disagreement rather than silently choosing one. Where this contract and `docs/spec.md` disagree, the spec wins on product behaviour and this contract is corrected.

## Source of truth for behaviour

`docs/behaviour-reference.md` is the **behavioural source of truth** — 1,592 lines of researched the reference behaviour with Zain's inline decisions. Every document here was revised against it on 2026-08-24. Where any of these files still contradicts it, the reference wins and the file is stale.

## Status

| Field | Value |
|---|---|
| Author | Claude (Opus tier) |
| Reviewer | Zain |
| Behaviour baseline | `docs/behaviour-reference.md` |
| Engine baseline | `9717339` and later |
| Consumer | Packet 5B-R (Codex), 5B-P2 (DeepSeek) |

## Documents

| File | Contents | Revised |
|---|---|---|
| [`01-thesis.md`](01-thesis.md) | Visual and behavioural thesis. **Fully rewritten** — the old "dark room, lit felt" thesis is dead | 2026-08-24 |
| [`02-tokens.md`](02-tokens.md) | Colour, typography, spacing, radii, elevation, materials, focus. Verified contrast ratios | — |
| [`03-layout.md`](03-layout.md) | 2D renderer layout, safe areas, seat geometry, minimum viewport, TV Mode. **2D only** — 3D camera is in `06` | 2026-08-24 |
| [`04-anatomy.md`](04-anatomy.md) | Component anatomy. **Rewritten** — radial action menu, world/HUD split, chip magnitude, nameplates, muck UI | 2026-08-24 |
| [`05-states.md`](05-states.md) | State tables from real fixtures, plus turn indication, preset, peek, muck and cinematic states | 2026-08-24 |
| [`06-interaction.md`](06-interaction.md) | **Rewritten** — orbit camera, RAM, betting dial, presets, peek, timers, input maps | 2026-08-24 |
| [`07-motion.md`](07-motion.md) | Motion grammar, step queue, **animation priority tiers**, pacing modes, cinematic policy | 2026-08-24 |
| [`08-handoff-2c.md`](08-handoff-2c.md) | Binding constraints and contract gaps for the 2D renderer | — |
| [`09-acceptance-2d.md`](09-acceptance-2d.md) | 2D visual acceptance punch list (Codex fallback pass) | — |
| [`10-art-direction.md`](10-art-direction.md) | Venues, tables, budgets, lighting studies, measured findings. **Five venues** | 2026-08-24 |
| [`11-character-pipeline.md`](11-character-pipeline.md) | Character process contract, gates, customisation model, MPFB stages 1-3 executed | 2026-08-24 |
| [`12-multiplayer-ux.md`](12-multiplayer-ux.md) | Invite, waiting, reconnect, kick, expired-link, account upgrade. Packet 3C | 2026-08-24 |
| [`13-animation-set.md`](13-animation-set.md) | Nine clips, procedural authoring, reaction pools, transitions. Resolves Q10 | 2026-08-24 |

## The one rule

From the behaviour reference, and it is the failure mode River is most at risk of:

> The biggest mistake would be to build a standard browser-poker HUD and merely put a 3D table behind it.

The 2D renderer shipped in Phase 2 is exactly that, and it was the right thing to build then. It is not the target.

## Open questions

- ~~**Q10**~~ — resolved. Clips are procedurally authored; see `13-animation-set.md`.
- ~~**Parametric human generator**~~ — resolved. MPFB installed from the official Blender repo.
- **Verify panel** cannot show the revealed seed — the view exposes `commit` but no seed.

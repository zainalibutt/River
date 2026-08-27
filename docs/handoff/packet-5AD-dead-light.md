# Packet 5AD — A light that lights nothing, and a terrace that outshines the table

**Owner:** Codex. **Reviewer:** Claude.

Read `docs/handoff/codex-laws.md`, then `docs/design/22-shot-composition.md`.

Both findings below were measured by ablation in the running scene - each light
switched off in turn and the frame re-read - not reasoned about. Three claims
from this lane were retracted this week for being reasoned about.

---

## 1. The pool light is outside the building

`LGT-pool` sits at `(-5, 0.9, -5.6)`: **7.51m from the table centre on a terrace
4.0m across.** It is beyond the parapet, lighting open air.

Removing it changes the frame by **0.0 percent**. It costs a draw and
contributes nothing.

This is the spec-versus-pipeline radius mismatch the lane log already records -
`14-venue-build-spec.md` assumes a 6.48m terrace and the built one is 4.0m, so
every radius in the spec is wrong for the venue that exists.

**Bring the Rooftop rig inside the venue it lights**, deriving positions from
the terrace that was built rather than the one the spec assumed. Check each lamp
the same way afterwards: if switching it off changes nothing, it is decoration.

## 2. The terrace outshines the table

Measured shares of the frame's light against share of its area:

| Region | Light | Area |
|---|---|---|
| floor-far | largest share | 16.3% |
| floor-near | 16.5% | 26.7% |
| **table** | **7.5%** | **11.6%** |

The subject is the dimmest thing in the shot and the surround is the brightest.
The reference is the other way round.

**What is already ruled out:** the caster. Its cone was a hardcoded angle
throwing a 2.24m pool across a 1.24m felt; deriving it from the table cut floor
spill from 21.5 to 16.5 percent. But a sweep of its intensity from 50 to 200
lifts the floor faster than the table at every step, with the far terrace
staying brightest throughout. **The caster cannot fix this ratio and raising it
is not the answer.**

So the brightness is in the terrace **material** or in the **fills**. Find out
which, with numbers, and report before changing anything.

## What not to do

- Do not tune by eye. Say what you measured.
- Do not touch `apps/web/`.
- Rooftop only.

## Verification

Re-render proofs at radius 3.2m, height 1.5m, **target 0.76m**, and report the
per-lamp ablation for the rig you land on.

## Gates and report

Pipeline checks plus `npm run lint && npm run typecheck && npm test`.
Law 1: stage only your own paths. Law 7: Zain alone, no trailer, no emoji.
Republish and check the byte counts changed.

Finish with exactly: `READY FOR CLAUDE`

# Packet 5AB — The garment is not one mesh

**Owner:** Codex. **Reviewer:** Claude.

Read `docs/handoff/codex-laws.md`.

---

## 5AA is accepted, and it settled the question

You proved from `801129e` that the shattered garments predate 5Z, and that the
nine garment meshes carry identical skin, joint and weight mappings before and
after your change. That was the right first move and it means the binding is not
the fault. **The shards are mine to own, not yours.**

## The diagnosis

Counted out of the shipped GLB:

| Mesh | Vertices | Triangles | Vertices per triangle |
|---|---|---|---|
| `char_male_body` | 3,948 | 5,837 | **0.68** |
| `char_male_garment` | 2,210 | 952 | **2.32** |

A welded, closed mesh sits near 0.5 - the body does. A mesh where every triangle
owns its own corners sits at 3.0. **The garment is at 2.32, so roughly
three-quarters of its triangles are islands sharing no vertices with their
neighbours.**

That is why it explodes when posed. Each island is skinned independently, the
duplicated corners take slightly different weights, and the seams pull apart the
moment a bone moves. It is not a binding fault and no reweighting fixes it -
the mesh was never welded in the first place.

## What to do

**Weld the garment before it is skinned.** Merge by distance at a tolerance
tight enough to keep genuinely separate pieces apart - a collar and a cuff
should stay distinct - and loose enough to close the seams inside a panel.

Then re-bind and confirm the ratio has come down. **The number to watch is
vertices per triangle**: if the garment does not land near the body's 0.68 it is
still full of islands, whatever the render looks like from one angle.

Do this in the pipeline where the garment is generated, not as a post-process on
the export. A weld applied after skinning re-introduces the same problem the
next time the garment is rebuilt.

## Verification

- Print vertices and triangles per garment in the build output, so the ratio is
  visible on every run rather than discovered later.
- Re-render the three proofs at radius 3.2m, height 1.5m, target 0.76m.
- `rooftop-chairs-occupied.png` is the one that matters: clothing intact, no
  loose triangles round any torso.

## What not to do

- Do not touch `apps/web/`.
- Do not raise the triangle budget. Welding **reduces** vertex count; it does
  not add geometry.
- Do not change the chair or the table. Both are correct and confirmed twice.

## Gates and report

Pipeline checks plus `npm run lint && npm run typecheck && npm test`.
`hygiene.test.ts` fails the suite if any tracked file names the reference game.

Law 1: stage only your own paths, `git diff --cached --name-only` before
committing. Law 7: Zain alone, no trailer, no emoji. Republish and check the
byte counts changed.

Finish with exactly: `READY FOR CLAUDE`

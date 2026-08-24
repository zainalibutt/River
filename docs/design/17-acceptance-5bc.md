# 17 — Acceptance review, Packets 5B-C / 5B-A / 5B-X

Character pipeline output at `art/out/char_male.glb` and `char_female.glb`, reviewed by Claude 2026-08-24 by importing both exports and inspecting the scene graph. `build_characters.py` is modified and uncommitted — DeepSeek stopped mid-packet for the third time, so this reads the last shipped artefacts.

**Verdict: two packets substantially delivered, one P0, three P1s, all four sharing one root cause.**

---

## Delivered

| Item | Evidence |
|---|---|
| **Materials now export** — 5B-X defect 1 fixed | `char_male_skin`, `garmentmale_mat` present on import |
| **All nine animation clips generate** — 5B-A delivered | `IDLE_breathe`, `PEEK_card`, `PRESET_reach`, `CHIP_toss`, `DEAL_toss`, `ALLIN_standup`, `REACT_win`, `REACT_lose`, `FOLD_muck` |
| **Garment is a separate weighted mesh** | `garment_male` / `garment_female`, 4,652 tris |
| **Rig intact** | 137 bones, matching the documented pipeline |

The animation stage is the significant one. DeepSeek was blocked on the Blender 5.2 layered Action API and got past it — the nine-clip set now generates from script, which is what closes Q10 in practice rather than in principle.

---

## P0 — the garment is not weighted and will not deform

```
MESH garment_male    tris=4652  verts=9618  vgroups=0
MESH base            tris=8972  verts=5449  vgroups=137
```

**The garment carries zero vertex groups.** The body has 137. In glTF, skinning arrives as `JOINTS_0` / `WEIGHTS_0` and imports as vertex groups; none are present on the garment.

Consequence: the body animates and the clothing stays rigid. Every one of the nine clips will tear the character apart — the `ALLIN_standup` in particular moves the whole torso through a 1.8s rise while the shirt remains fixed in space.

The manifest also reports `garment_verts: 0` while the mesh has 9,618 vertices, so the checker is not measuring what it claims to.

**Expected correction:** the garment must inherit the body's vertex groups. It is built from a subset of body vertices, so the weights already exist on the source — they are being dropped on the duplicate. Copy the vertex groups across before export, or parent the garment to the armature with `ARMATURE_AUTO` as a fallback.

**Acceptance:** import the GLB, pose `upperarm01.L` by 40 degrees, confirm the garment follows the body.

---

## P1 — the build does not reset between characters

`char_female.glb` contains:

```
ARMATURE char_female.rig   bones=137
ARMATURE char_male.rig     bones=137     <-- contamination
MESH     Icosphere
MESH     Icosphere.001                   <-- two now
ACTIONS  ['FOLD_muck']                   <-- one of nine
```

The female export carries **the male's armature**, **two** stray Icospheres where the male has one, and **one action instead of nine**.

All three symptoms are the same defect: **the scene is not cleared between the two character builds.** The male build leaves its rig and debris behind, the female build adds to it, and the action assignment ends up pointing at whatever was last created rather than the full set.

**Expected correction:** a full scene reset at the top of each character build — remove all objects, orphan-purge actions, armatures, meshes and materials — rather than building the second character into the residue of the first.

---

## P1 — the stray Icosphere is still shipping

5B-X defect 2 was reported and is not fixed. It has doubled: one in the male export, two in the female. An 80-triangle sphere with no material and no vertex groups.

It is almost certainly MPFB scaffolding or a leftover primitive. Whatever creates it, the export filter should ship only named pipeline objects rather than everything in the scene.

---

## P1 — male and female remain structurally identical

5B-X defect 3 was reported and is not fixed.

```
char_male    faces 4873   tris 8972   verts 5449
char_female  faces 4873   tris 8972   verts 5449
```

Byte-identical topology. The file sizes now differ, but only because the male carries nine actions and the female carries one — the meshes themselves are the same.

The customisation model in `11-character-pipeline.md` requires **two genuinely different bases sharing one rig**. MPFB drives sex through morph targets before the shape keys are baked; the female build appears to be baking the same neutral base.

**Expected correction:** apply the female morph target before `bake_shapekeys`, and assert in the checker that the two bases differ — a vertex-position hash comparison is sufficient and cheap.

---

## P2 — the build ships while failing its own check

```
"checks": ["quad ratio 0.841 below 0.85"]
```

The checker correctly flags the quad ratio and the export proceeds anyway. `check_assets.py` was specified to **exit non-zero on any violation**. A check that records a failure without blocking is a log line, not a gate.

Also worth noting: triangle count dropped from the documented 14,114 to 8,972, and the quad ratio from 85.3% to 84.1%. Something in the reduction changed. Lower is not automatically better — the budget is 15,000 and the quad floor exists because the mesh has to deform.

## P2 — manifest disagrees with the export

| Manifest claims | Export contains |
|---|---|
| `vertex_groups: 265` | 137 on the base mesh |
| `garment_verts: 0` | 9,618 on the garment |

Two fields measuring something other than what they name.

---

## Root cause

Four of the six findings reduce to **the build not isolating each character**. Fix the scene reset and the contamination, the duplicated debris and most likely the action loss all resolve together. Fix the vertex-group copy and the P0 resolves. Two changes, five findings.

## What is not affected

The animation clips themselves are correct where they exist — nine named actions on the male, matching `13-animation-set.md` exactly. The rig is correct at 137 bones. Materials export. The garment geometry is the right shape and the right size. This is a pipeline-plumbing failure, not a modelling one.

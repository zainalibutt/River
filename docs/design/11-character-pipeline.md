# 11 — Character pipeline

How River's seated characters get made. This is a process contract, not an art contract — visual decisions live in `10-art-direction.md` and are not restated here.

**Rule: one character end to end before nine.** Every stage below has an acceptance gate. A failure at any gate stops the run and routes back rather than continuing with a compromised asset. Proving the whole chain on a single character costs a day; discovering the chain is broken after building a cast costs a fortnight.

## Why parametric, not AI mesh generation

Recorded because it will be re-litigated otherwise.

AI mesh generation — text-to-3D, image-to-3D — produces good silhouettes and unusable topology: dense unstructured triangles with no edge loops at the elbow, shoulder or hip. That is fine for a static prop and wrong for anything that deforms. A generated humanoid creases and tears the moment the rig moves, and retopologising it into deformation-friendly geometry is skilled manual work.

Parametric human generation gives clean topology, a correct armature, controllable proportions, and consistency across the cast — so a single animation set retargets to every seat. It is scriptable, which keeps it in DeepSeek's lane.

AI generation is still used, at the texture stage, where it is genuinely strong.

## Stages

### Stage 1 — Base mesh

Parametric human generator (MakeHuman or an equivalent Blender addon), driven by script. Two base bodies for v1 per `10-art-direction.md`.

**Gate:** mesh is manifold, has edge loops at shoulder, elbow, hip and knee, and sits at or under 12,000 triangles before any clothing. Proportions consistent between the two bases so one rig serves both.

### Stage 2 — Seated pose adaptation

Characters never walk. The mesh is authored and weighted for a seated pose; below-waist geometry is simplified since it is occluded by the table in every camera position from the camera table.

**Gate:** at the default camera, no occluded geometry is being drawn. Silhouette above table height is unchanged from stage 1.

### Stage 3 — Rig

Mixamo auto-rig, or an equivalent armature, matching the spec's stated Mixamo-style pipeline.

**Gate:** the armature drives the mesh through a full range-of-motion test — shoulder to full extension, elbow to full flexion, spine twist — with no visible creasing, tearing or weight-bleed. This is the gate most likely to fail, and failing it here is the entire point of the one-before-nine rule.

### Stage 4 — Clothing and texture

AI-generated texture painted onto the fixed UV layout. Palette swaps plus three head accessories over two base bodies, per `10-art-direction.md`.

**Gate:** one shared 1024 atlas across the cast. No stretching at deformation zones under the stage 3 range-of-motion test. Materials count stays inside the budget table.

### Stage 5 — Animation

Six clips, listed in `10-art-direction.md`: idle breathe and sway, card peek, chip toss, win react, lose react, stand up on all-in.

**These are hand-keyed.** Mixamo has no seated-poker library, so none of the six can be pulled from a stock set. This is the one stage in the pipeline that no tool removes, and it is the real labour in the whole 3D track.

What "polish deferred" means concretely, per Zain's decision: v1 targets **the correct clip firing at the correct moment with correct timing**. Weight, secondary motion, blend quality and per-archetype personality are a later pass. A stiff clip that fires correctly passes this gate. A beautiful clip that fires late does not.

**Gate:** all six clips exist, loop or resolve cleanly, and fire from the correct `SessionStep`.

### Stage 6 — Export and load

glTF export, validated naming, loaded in the R3F scene.

**Gate:** measured in-scene against the budget table in `10-art-direction.md` — triangles, texture memory, draw calls, materials. Nine instances at the default camera stay inside the total scene ceiling. Silhouette test passes: greyscale the frame at 1280x720 and every seat remains distinguishable.

## Ownership

| Stage | Owner |
|---|---|
| 1, 2, 3 | DeepSeek — scripted, deterministic, gate-checked |
| 4 | Zain and Claude — texture direction; DeepSeek applies |
| 5 | Hand work. Owner unassigned; see open question below |
| 6 | Codex, against the R3F scene |
| All gates | Claude verifies against the art contract |

## Prerequisites — resolved 2026-08-24

Blender **5.2.0 LTS** is installed at `D:/Blender/Blender 5.2/blender.exe`, the Blender Lab MCP add-on is enabled, and the MCP bridge runs headlessly via `blender --command blender_mcp`. Headless scripting and live-scene inspection are both verified working.

One prerequisite remains: **a parametric human generator is not installed.** MakeHuman, MPFB2 or an equivalent Blender addon is required before stages 1 to 3 can begin. Nothing else blocks the pipeline.

## Open question

**Q10 — who keys the six animation clips?** No tool generates seated poker animation, and none of DeepSeek, Codex or Claude can hand-key in Blender's dope sheet. Realistic options: Zain animates them; a stock seated-animation pack is bought and adapted; or the clip list is cut for v1 to the two that carry the most meaning — idle and the all-in stand-up — with the rest deferred alongside the polish pass. Recommend the third: it preserves the signature moment and the sense of an occupied table at a fraction of the labour.


---

# Revision — customisation model (2026-08-24)

Zain's decision, confirmed against the reference frames: the pipeline produces **two rigged base meshes plus a customisation layer**, not a fixed cast.

| Layer | Contents |
|---|---|
| Base | One male, one female. Shared skeleton, shared animation set |
| Customisable | Face, hair, skin tone, outfit, accessories |
| **Headwear** | The primary silhouette differentiator — bowlers, fedoras, caps, headbands. Present in every reference frame and doing most of the work of making nine seats distinguishable |

This makes parametric generation more clearly correct than before: two consistent bases sharing one rig is exactly what a parametric generator is for, and a fixed cast of nine would have been the wrong shape.

## Evidence from the venue study

Nine seated figures were assembled from primitives and placed at the table. Two results:

- **They transform the frame.** An empty table reads as a set; an occupied one reads as a place. Zain's judgement that characters matter most is confirmed.
- **Primitives are a hard ceiling.** Cylinder-and-sphere figures read as robots and no amount of further primitive work fixes it. At 1,076 triangles each they are nowhere near the 12,000 budget, so the constraint on real characters is **authoring effort, not polygons**.

## Animation set, revised

The behaviour reference adds required clips beyond the original six. Full set:

| Clip | Trigger | Tier |
|---|---|---|
| Idle breathe and sway | default | 4 |
| **Card peek** | hole-card peek input held | 1 |
| **Preset intent reach** | preset action selected | 1 |
| Chip toss | bet, call or raise | 1 |
| **Deal** | rotating player-dealer venues | 1 |
| Win react | award | 2 |
| Lose react | losing showdown | 2 |
| Stand up on all-in | all-in commit | 1 |
| Emote pool | player-triggered | 3 |

Card peek and preset intent are **social tells** and are load-bearing gameplay, not polish — they move up to tier 1. Win and lose reactions need a varied pool; the reference notes the reference tripled its reaction count because repetition was noticeable.

Zain's polish deferral still applies: v1 targets the correct clip firing at the correct moment with correct timing. Weight, secondary motion and per-archetype personality are a later pass.


---

# Stage 1-2 executed (2026-08-24)

## MPFB is in the official Blender repo

The blocker is gone and it never needed a third-party download. **MPFB — "Human character generator and editor"** is published on `extensions.blender.org` and installs through the same trusted path as the MCP add-on. Installed and enabled as `bl_ext.blender_org.mpfb`.

It ships everything the pipeline needs: **1,445 morph targets, 18 rigs, 5 poses**, base mesh, UV layers and materials. 143 operators including `create_human`, `add_standard_rig`, `add_rigify_rig` and `auto_transfer_weights`.

What it does **not** ship is proxies and clothing — those are separate community asset packs. Stage 4 will need them or an equivalent.

## Stage 1 result — base mesh

```
verts 19,158   faces 18,486   tris 36,972   quads 100%   ngons 0
```

**Perfect topology.** 100% quads, zero ngons, correct edge loops, articulated hands with individual fingers, real facial geometry. This is exactly what the "why parametric, not AI mesh generation" section predicted and it settles the argument with evidence.

## Stage 2 result — reduction to game resolution

Two traps, both now documented:

**Shape keys block modifiers.** The MPFB human carries its morph targets as shape keys, and Blender refuses to apply a Decimate modifier to a mesh that has them. `bpy.ops.mpfb.bake_shapekeys()` resolves it, followed by collapsing any residual keys with `shape_key_add(from_mix=True)` and removing them.

**Decimate mode matters enormously.** `COLLAPSE` shreds quad topology into triangles and destroys the deformation loops. `UNSUBDIV` halves density while preserving quads.

| Approach | Tris | Quad % |
|---|---|---|
| Raw base mesh | 36,972 | 100% |
| UNSUBDIV x1 | 18,440 | 85% |
| UNSUBDIV x2 | 10,536 | **60%** |
| **UNSUBDIV x1 + occluded leg cull** | **14,114** | **85%** |

Two unsubdiv passes hit the budget but dropped quad quality to 60%, which is poor for a mesh that has to deform. One pass plus cutting the mesh at upper thigh — geometry that is occluded by the table at every permitted orbit pitch — keeps 85% quads at 14,114 triangles.

## Budget revision — 12,000 to 15,000 per character

The 12,000 figure was **my estimate, written before a real character existed**. It is now measurable and it was too tight.

| | Value |
|---|---|
| Measured, one character at game res | 14,114 tris |
| Revised per-character budget | **15,000** |
| Nine seated characters | 135,000 |
| Venue, measured | 24,000 - 64,000 |
| Total worst case | ~199,000 |
| Scene ceiling | 250,000 |

Still inside the ceiling with roughly 50,000 of headroom. Revising a guessed number against measurement is correct; chasing an invented one by degrading topology is not.

**Hands are not culled.** They are expensive but load-bearing — card peek, chip toss and the preset-intent reach are all hand gestures, and they are the game's social tells.

## Remaining stages

Stage 3 rig is next and is the gate most likely to fail. `add_standard_rig` and `auto_transfer_weights` are available. Stage 4 needs clothing assets MPFB does not bundle.


## Stage 3 executed — rig gate PASSED

```
armature Human.rig   137 bones   265 vertex groups
game-res mesh        14,114 tris   85% quads   ARMATURE + MASK modifiers
```

Shoulder extension and elbow flexion posed and rendered: **no creasing, no tearing, no weight-bleed.** Deltoid and armpit deform correctly at game resolution. This is the gate the whole one-character-before-nine rule exists to catch, and the chain survives it.

### The stage order in this document was wrong

**Rig before decimate, not after.** Running `add_standard_rig` on an already-decimated mesh fails with `float division by zero` — MPFB expects its own base topology. The corrected order is:

1. `create_human`
2. **`add_standard_rig`** — while topology is intact
3. `bake_shapekeys` and clear residual keys
4. `UNSUBDIV` decimate
5. Cull occluded geometry below upper thigh

Weights survive steps 4 and 5 intact — all 265 vertex groups carried through, and the ARMATURE modifier stays bound. Stages 2 and 3 in the numbered list above should be read in this order.

### Rigify

`add_rigify_rig` requires the Rigify addon, which ships with Blender but is **not enabled by default**. The module name is `rigify`, not `bl_ext.blender_org.rigify` — enabling by the extension path fails. Not needed for the standard rig, but required if the pipeline ever wants a control rig for hand animation.

### Bone naming

MPFB splits limbs across numbered segments — `upperarm01.L`, `upperarm02.L`, `lowerarm01.L`, `spine01` through `spine05`. Any animation or retarget script must address the correct segment; rotating only `upperarm01` gives partial limb motion, which is correct behaviour and not a rig fault.

### Remaining

Stage 4 clothing needs asset packs MPFB does not bundle. Stage 5 animation is still the hand-keyed labour recorded in Q10.


## Seated pose and venue placement (2026-08-24)

### The base rig is an A-pose, not a T-pose

`upperarm01.L` points along `(0.653, 0.007, -0.757)` — already hanging at roughly 49 degrees. An initial pose attempt rotated the arms *up* into a T-pose by assuming otherwise.

Arm bone local axes: **local Y runs along the bone, local Z is world -Y.** Rotating about local Z swings the arm in the vertical plane. Negative on the left, positive on the right, brings arms down and in.

Working seated pose:

| Bone | Rotation |
|---|---|
| `upperleg01.L/R` | x -82 (thighs to horizontal) |
| `lowerleg01.L/R` | x +78 (shins down) |
| `spine02`, `spine03` | x +4, +5 (slight forward lean) |
| `upperarm01.L` / `.R` | z -30 / +30 |
| `lowerarm01.L` / `.R` | z -55 / +55 (forearms onto the rail) |
| `head` | x +7 |

### Placement — measure, do not assume

**The MPFB origin sits at the feet of a standing figure.** After the upper-thigh cull there are no feet, so placing the rig at seat height puts the body roughly 0.6m in the air. The first placement attempt did exactly this.

Correct procedure: place the rig at z=0, update the depsgraph, measure the posed mesh's world-space bounding box, then set `z = seatHeight - measuredZmin`. Verified: `zmin 0.46, zmax 1.298` against a 0.46m chair seat.

**Default forward is -Y.** Facing the table centre from a seat at `(cx, cy)`:

```python
yaw = math.atan2(-cy, -cx) + math.pi/2
```

### Result

Three MPFB characters placed at the Rooftop alongside six primitive stand-ins. Scene at **114,234 triangles** with three real characters; nine would land near 180,000 against the 250,000 ceiling, consistent with the revised 15,000 per-character budget.

The comparison in-frame settles the question the pipeline document opened: primitives read as toys next to a real body. Parametric generation was the correct route.

Characters remain nude and untextured — stage 4 needs clothing assets MPFB does not bundle.


## Stage 4 — clothing without asset packs (2026-08-24)

MPFB bundles no garments or proxies, so clothing was built from the body mesh itself. **No asset pack purchase is required for v1.**

### Method: garment shell from vertex-group selection

1. Identify vertices whose dominant **bone** weight belongs to a covered bone group — `spine`, `clavicle`, `shoulder`, `upperarm`, `breast`, `pelvis`.
2. Duplicate the body, keep only those vertices, push each along its own normal by 20mm.
3. **Delete the same vertices from the body.** Skin under clothing is not rendered.
4. Parent the garment to the same armature. It deforms with the body for free — no separate rigging, no weight transfer.

| Part | Triangles |
|---|---|
| Body — head, neck, forearms, hands, thigh stumps | 8,432 |
| Garment | 3,450 |
| Hat brim and crown | 184 |
| **Dressed total** | **12,066 / 15,000 PASS** |

### Trap 1 — MPFB helper vertex groups poison dominance tests

The mesh carries 265 vertex groups, but many are MPFB working groups — `body`, `Left`, `Right`, `HelperGeometry`, `JointCubes`, `helper-*`, `joint-*` — and several hold **weight 1.0 on every vertex**. A naive "highest weighted group" test returns `body` for the entire mesh and selects nothing.

Filter to groups whose name matches an actual bone in the armature before testing dominance:

```python
BONES = {b.name for b in rig.data.bones}
bone_idx = {g.index: g.name for g in obj.vertex_groups if g.name in BONES}
```

### Trap 2 — Solidify doubles the garment

A Solidify modifier turned a 1,963-vertex shell into 7,704 triangles and pushed the character to 16,320, over budget. Displacing vertices along their own normals gives a single-sided garment at 3,450 triangles. Backface culling makes single-sided correct for clothing viewed from outside.

### Trap 3 — bone parenting anchors at the bone tail

Accessories parented to a bone land at the **tail**, not the head, and not where the object was sitting. Three attempts were wasted before the reliable pattern emerged:

```python
world = obj.matrix_world.copy()
obj.parent = rig; obj.parent_type = 'BONE'; obj.parent_bone = "head"
bpy.context.view_layer.update()
obj.matrix_world = world     # restore the measured placement
```

Position from the **posed head bone's world tail**, never from the mesh bounding box — the box includes forward-projecting thighs and arms and pulls accessories off-centre.

### Known limitations

- **Jagged boundaries** at collar, sleeve and waist. The garment edge follows an irregular vertex-group boundary. A hem or a weight-threshold falloff instead of strict dominance would soften it.
- Minor z-fighting on the chest where garment and body nearly coincide.
- One garment style only. Variation currently comes from material tint plus headwear.

Good enough to prove the method and unblock the look. Not finished art.

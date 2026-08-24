# River asset pipeline — Packets 5B-P and 5B-P2

Procedural bpy assets for the three venues (Rooftop, Basement, Suite). Every
dimension, colour and material comes from `docs/design/10-art-direction.md`
(including the reference-derived REVISION section and the measured venue-build
study) and `docs/design/02-tokens.md`; the scripts implement the contract, they
do not decide it.

## Files

- `values.py` — single source of budget ceilings, measured table geometry
  (felt 1.24 x 0.72 m at 0.76 m, seat 0.46 m, seat ring 1.42x/1.58x, rail
  contact 1.05x/1.09x), and the per-venue palettes.
- `geo.py` — deterministic pure geometry (no bpy import): oval table (felt, rail,
  pedestal), chips, cards, three chair variants (rooftop swivel / basement
  folding / suite dining), and all venue props. One plane + texture for the
  basement checkerboard — never an object grid.
- `buildkit.py` — Blender-side helpers: material construction, `retint()` which
  edits ColorRamp stops (setting Principled BSDF Base Color does nothing when a
  ramp drives it — the trap the study called out), checker-texture generation,
  seat positioning.
- `build_assets.py` — headless build of all three venues; per-venue GLB export
  plus a manifest that reports per-asset and total triangles, props/environment
  buckets, material count, object (draw-call) count, texture dimensions and
  memory, and the budget verdict.
- `build_characters.py` — character generation via MPFB, following the
  documented stage order (create_human → add_standard_rig BEFORE reduction →
  bake_shapekeys/clear residual → UNSUBDIV decimate → bmesh cull below 0.34).
  Has a hard MPFB-availability guard that fails fast with a clear message if the
  extension is not enabled.
- `check_assets.py` — reads exported GLBs and fails loudly (exit 1) on any
  scene/props/environment triangle, material, draw-call, texture-dimension or
  texture-memory budget violation. Also validates `char_*` skeletons: triangle
  budget, armature binding (skin + weight attributes), and bone count.
- `test_checker.py` / `test_checker_chars.py` — negative tests proving every
  budget axis (including character axes) fails loudly.

Output goes to `art/out/` (gitignored). Use `RIVER_OUT` to redirect.

## Usage

```sh
# build + export all three venues (requires Blender 5.2 LTS)
"/d/Blender/Blender 5.2/blender.exe" --background --python art/pipeline/build_assets.py

# validate every export against the budget table
python art/pipeline/check_assets.py art/out/*_assets.glb

# prove the checker fails loudly on every budget axis
python art/pipeline/test_checker.py
python art/pipeline/test_checker_chars.py

# generate characters (requires MPFB extension enabled)
"/d/Blender/Blender 5.2/blender.exe" --background --python art/pipeline/build_characters.py
```

## Contract notes

- Chips and cards use glTF `EXT_mesh_gpu_instancing`: one pooled node per chip
  denomination and one board-card node. Each node carries stable instance IDs in
  `extras.riverInstanceIds` plus translation, quaternion rotation, and scale
  accessors. Runtime animation updates one instance matrix, so a chip toss never
  moves its stack and changing the pot size does not add draw calls. Board cards
  follow the same addressable pool. Board cards sit at HUD-readable size in the
  3D scene; hero cards are DOM-only per the card-legibility study.
- Character tinting groundwork is atlas-first: one shared 1024 atlas with fixed
  UV islands for skin, garment, hat, and accessories; neutral colour data plus
  mask channels for each tintable region; and a palette lookup indexed by one
  per-instance `paletteIndex` property. The renderer must apply that property in
  the shared shader or instance buffer. It must not clone material datablocks.
- Venue character integration uses weighted seated LOD meshes of the two rigged
  bases, alternating five male and four female seats. Each seat keeps its own
  armature, root transform, and `paletteIndex`; the body and garment LODs remain
  skinned and share the atlas. The LOD costs about 3,491 triangles per seat,
  31,423 character triangles across nine seats, and 18 character draw calls.
  Venue exports omit the source standing/action clips; the full nine-clip GLBs
  remain in `art/out/` for runtime use where needed.
- Venue materials are built from ColorRamp-driven shaders; `retint()` changes the
  ramp stops, so a shared material can be re-paletted per venue without the
  silent-no-op BSDF trap.
- Exports are deterministic: identical GLB bytes across runs (verified by
  SHA-256). The `.blend` file embeds Blender save metadata and is not byte-stable,
  but geometry is.
- Measured result (2026-08-24), before -> after: rooftop 172,440 -> 41,125
  triangles and 12,399 -> 2,982KB; basement 165,956 -> 34,641 triangles and
  12,049 -> 2,631KB; suite 179,642 -> 48,327 triangles and 12,764 -> 3,347KB.
  Each venue is hard-gated at 250,000 triangles, 24 materials, 120 draw calls,
  and 6,144KB download size.
- Character validation (triangles, armature binding, bone count) is exercised
  against a synthetic rigged GLB fixture produced deterministically; it passes a
  valid skinned mesh and fails loudly on missing skin/weights or insufficient
  bones. Quad % and vertex-group count are validated at build time inside
  `build_characters.py`, since glTF output is triangulated and loses them.
- NOTE (2026-08-24): MPFB is **not installed** in the current Blender profile
  (no extension on disk, not in prefs.addons, phantom `bpy.ops.mpfb` with no
  operators). `build_characters.py` therefore fails fast with a clear BLOCKED
  message and has not been run. It is written against the documented stage order
  and is unverified pending MPFB availability.

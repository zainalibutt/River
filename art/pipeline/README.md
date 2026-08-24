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
- `check_assets.py` — reads exported GLBs and fails loudly (exit 1) on any
  scene/props/environment triangle, material, draw-call, texture-dimension or
  texture-memory budget violation.
- `test_checker.py` — negative tests proving every budget axis fails loudly.

Output goes to `art/out/` (gitignored). Use `RIVER_OUT` to redirect.

## Usage

```sh
# build + export all three venues (requires Blender 5.2 LTS)
"/d/Blender/Blender 5.2/blender.exe" --background --python art/pipeline/build_assets.py

# validate every export against the budget table
python art/pipeline/check_assets.py art/out/*_assets.glb

# prove the checker fails loudly on every budget axis
python art/pipeline/test_checker.py
```

## Contract notes

- Chips and cards share one base mesh each, varied by material (instanced, never
  modelled per-chip). Board cards sit at HUD-readable size in the 3D scene; hero
  cards are DOM-only per the card-legibility study.
- Venue materials are built from ColorRamp-driven shaders; `retint()` changes the
  ramp stops, so a shared material can be re-paletted per venue without the
  silent-no-op BSDF trap.
- Exports are deterministic: identical GLB bytes across runs (verified by
  SHA-256). The `.blend` file embeds Blender save metadata and is not byte-stable,
  but geometry is.
- Measured result (2026-08-24): rooftop 4,038 triangles / 20 materials / 46
  objects; basement 1,368 / 18 / 43 (one 128x128 checker texture); suite 2,614 /
  20 / 42. All comfortably inside the budget table.

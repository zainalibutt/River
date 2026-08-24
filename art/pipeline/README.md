# River asset pipeline — Packet 5B-P

Procedural bpy assets for the Rooftop Bar table set. Every dimension, colour
and material comes from `docs/design/10-art-direction.md` and
`docs/design/02-tokens.md`; the scripts implement the contract, they do not
decide it.

## Files

- `values.py` — single source of budget ceilings and contract colours/dimensions.
- `geo.py` — deterministic pure geometry (no bpy; triangle count computable by export).
- `build_assets.py` — headless Blender build: creates table (felt, rail, wood body),
  six chip denominations (shared base geometry, material variants), and a cheat-scaled
  board card; writes `river_assets.blend`, exports `river_assets.glb`, writes a manifest.
- `check_assets.py` — reads an exported GLB and fails loudly (exit 1) on any triangle,
  material, or embedded-image violation of the budget table.

Output goes to `art/out/` (gitignored). Use `RIVER_OUT` to redirect.

## Usage

```sh
# build + export (requires Blender 5.2 LTS)
"/d/Blender/Blender 5.2/blender.exe" --background --python art/pipeline/build_assets.py

# validate the export against the budget table
python art/pipeline/check_assets.py art/out/river_assets.glb
```

## Contract notes

- Chips (39mm, 11.5mm thick) and cards (1mm thick, 2.4x cheat scale per the card
  legibility study) are built from one shared base mesh each; the six chip
  denominations differ only by material, so the scene exports one geometry per
  shape referenced by many nodes (`export_shared_accessors`). Cards are instanced
  across board positions.
- Exports are deterministic: identical `river_assets.glb` bytes across runs
  (verified by SHA-256). The `.blend` file embeds Blender save metadata and is not
  byte-stable, but geometry is.
- Budget enforcement: total props triangles 800 of 60,000 ceiling; 16 materials of
  24; 0 embedded textures. The checker also fails loudly if these are ever exceeded.
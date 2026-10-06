# Art pipeline

River's 3D venues and characters are built by code. The scripts in
[`art/pipeline`](../art/pipeline) run Blender headlessly, build each asset from
measured values, export it to glTF, and check the export against budgets before
the web app is allowed to load it.

## Venues

- [`values.py`](../art/pipeline/values.py) is the single source of numbers:
  table geometry, camera orbits, colours and the budget ceilings every export
  must meet.
- [`geo.py`](../art/pipeline/geo.py) holds the geometry that does not need
  Blender (the oval table, rail and felt), so it can be tested on its own.
- [`build_assets.py`](../art/pipeline/build_assets.py) builds the Rooftop,
  Basement and Suite and exports one GLB each.
- [`check_assets.py`](../art/pipeline/check_assets.py) reads the exported files
  and exits non-zero on any budget breach: triangles, meshes, materials, draw
  calls, texture dimensions and texture bytes. [`test_checker.py`](../art/pipeline/test_checker.py) proves the
  checker fails on every axis it claims to check, because a gate that never
  fires looks exactly like a pass.

A venue exists only as the output of its build. There is no hand-edited scene to
drift away from the code.

## Characters

Character bodies, clothing and hair come from MakeHuman asset packs released
under CC0, assembled through MPFB in Blender. The build scripts fit garments,
apply looks (Gold's presets are data in
[`gold_looks.json`](../art/pipeline/gold_looks.json)), bake the seated pose and
export the animation clips the table uses: check, peek, chip push, fold and the
all-in stand-up. The checks measure what a player could actually see:
penetration between body and clothing, seating against the chair, and the
exported GLB's structure.

The `.blend` master scenes that seed the characters are kept out of this
repository. The pipeline code and its checks are here; the masters stay
private with the rest of the working material.

## Sound

[`audio.py`](../art/pipeline/audio.py) synthesises every sound effect from
code: card deals, chip stacks, the turn alert. [`check_audio.py`](../art/pipeline/check_audio.py)
gates length, peak and RMS level, clipping and file size, so the effects are reproducible and owe
nothing to a sample library.

## Into the app

[`publish_assets.py`](../art/pipeline/publish_assets.py) copies checked exports
into `apps/web/public/assets`. The client loads them with three.js through
React Three Fiber, and the venue and seat logic that positions them lives in
tested TypeScript modules rather than in the scene.

See the pipeline's own [README](../art/pipeline/README.md) for usage.

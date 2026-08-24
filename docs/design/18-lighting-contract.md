# 18 — Lighting contract

The venue pipeline built geometry and materials with **no lights at all**. Every
venue rendered flat, and the R3F scene lit itself with a hemisphere and a
directional light unrelated to any measured value. The lookdev looked like the
lookdev and the app looked like a default three.js scene, because they shared
nothing.

This closes that. The measured rigs from `14-venue-build-spec.md` now live in
`art/pipeline/values.py` as `VENUE_LIGHTS` and `VENUE_CAMERA`, are built into
every venue by `build_lighting()`, and are emitted to `art/out/lighting.json`.

## Why a sidecar and not the GLB

glTF carries `KHR_lights_punctual`, which defines **point, spot and directional
only**. Every light in all three venues is an area light. The exporter drops
them:

```
WARNING: Unsupported light source AREA   x17
```

Degrading them to point lights would lose the thing that makes them work — a
5.5m soft source over the felt is not a point, and the shadow it casts is the
difference between the render and a flashlight. three.js has `RectAreaLight`,
which is the same primitive, so the rig travels beside the GLB instead of
through it.

## Sidecar shape

`art/out/lighting.json`, keyed by venue id:

```json
{
  "rooftop": {
    "world":  { "colour": "#101613", "strength": 1.5 },
    "camera": { "radius": 6.1, "height": 4.05, "pitch": 62.0, "fov": 64.0, "clear_radius": 8.4 },
    "lights": [
      { "name": "table", "type": "area", "colour": "#FFE2BC", "energy": 240.0,
        "size": 5.5, "shadow": true, "position": [0.0, 0.0, 3.9], "rotation_deg": [0, 0, 0] }
    ]
  }
}
```

Counts: Rooftop 5, Laundromat 5, Suite 7.

## Consuming it — Codex, `apps/web`

`river-venue-scene.tsx:126` currently hardcodes:

```tsx
<hemisphereLight args={['#dbeeff', '#403225', 1.7]} />
<directionalLight intensity={2.1} ... />
```

Replace with the rig, read from the sidecar. Binding requirements:

1. **One shadow caster per venue.** Exactly one light in each rig carries
   `shadow: true` — Rooftop `table`, Laundromat `fluoro_0..3` (four, reduce to
   the nearest to the table), Suite `chandelier`. The art direction budgets one
   soft realtime caster and the rest are unshadowed fill.
2. **`RectAreaLight` needs `RectAreaLightUniformsLib.init()`** once before any
   is created, or they render black. It also ignores shadows in three.js, so the
   caster must be a `SpotLight` or `DirectionalLight` positioned to match while
   the area lights carry the look.
3. **Energy is Blender watts, not three.js intensity.** These are not the same
   unit. Calibrate once against a lookdev frame per venue and record the scalar
   in the loader rather than hand-tuning per light — hand-tuning is how the two
   renderers drifted apart in the first place.
4. **World colour and strength drive the environment**, not a background clear
   colour. The Rooftop world is a vertical gradient per `14-venue-build-spec.md`;
   the flat value in the sidecar is the fallback.
5. **The camera block is the same data** the orbit camera already uses. Read it
   from here rather than keeping a second copy.

`PCFSoftShadowMap` is deprecated and silently downgrading to hard PCF — noted in
`15-acceptance-5br.md` as P2 and now blocking, because the one soft caster is
the whole shadow budget.

## Clear radius, now enforced

`clear_radius_violations()` fails the build when any mesh over 2m tall sits
inside the orbit annulus. This is the rule that stopped the Rooftop camera
rendering from inside a palm tree — the fronds read convincingly as shadow
artifacts and cost three diagnostic passes. It is a gate, not a note: verified
to fire at r=4.80 against an 8.40 clear radius and to stay silent at r=12.0.

## Closed since first write

- **Rooftop gradient world.** Built as the specified
  `TexCoord > SeparateXYZ > ColorRamp > Background` chain with stops at 0.46
  `#8E3A6B`, 0.55 `#4A2352`, 0.68 `#0E0A18`. Verified present with those three
  positions. `world_gradient` in the sidecar carries the stops; `world` remains
  the flat fallback for renderers that cannot build a ramp.
- **One shadow caster per venue.** The Laundromat had four fluoros casting
  against a one-caster budget. `fluoro_2` is nearest the table centre and keeps
  the shadow; the other three are now fill. Verified: rooftop 1, basement 1,
  suite 1.

## Still open

- Energy calibration between Blender watts and three.js intensity is unmeasured.
  Do this once per venue against a lookdev frame and record the scalar in the
  loader. Hand-tuning per light is how the two renderers drifted apart before.

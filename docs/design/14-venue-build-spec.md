# 14 — Venue build spec

Exact numeric recipe for the three launch venues, extracted from the lookdev builds on 2026-08-24. **This document exists so the lookdev is reproducible.**

Until now the venues lived only as `.blend` files on one drive, outside the repo, regenerable by nothing. Every render shown was a photograph of work rather than the work. These are the values that produce those frames.

Implemented by DeepSeek in `art/pipeline/`. Claude does not edit that directory — this is the contract, not the code.

## Shared geometry

Constant across all three venues.

| Property | Value |
|---|---|
| Felt radii | 1.24m x 0.72m (2.48 x 1.44m oval) |
| Table surface height | 0.76m |
| Rail contact radii | 1.05x / 1.09x the felt radii |
| Seat ring radii | 1.42x / 1.58x felt (Rooftop, Basement); **1.30x / 1.44x** (Suite, chairs are deeper) |
| Chair seat height | 0.455m |
| Seated shoulder height | 0.99m |
| Seated head centre | 1.22m |
| Chip radius / thickness | 19.5mm / 3.3mm |
| Card | 63.5 x 88.9 x 0.9mm, backs only |

## Camera and orbit

Per-venue, from `06-interaction.md`. The interaction model is common; the numbers are not.

| Venue | Orbit radius | Height | Pitch | FOV | Prop clear radius |
|---|---|---|---|---|---|
| Rooftop | 6.1m | 4.05m | 62 deg | 64 | **8.4m** |
| Laundromat | 3.6m | 2.45m | 72 deg | 66 | room walls at 6.0m |
| Executive Suite | 3.9m | 2.85m | 68 deg | 66 | **5.4m** (balustrade) |

Nothing over 2m tall may sit inside the clear radius. This is the rule that stopped the Rooftop camera rendering from inside a palm tree.

## Rooftop

### Lighting

| Light | Type | Energy | Size | Shadow | Position |
|---|---|---|---|---|---|
| `LGT-table` | Area | 240 | 5.5 | **yes** | (0, 0, 3.9) |
| `LGT-sky-fill` | Area | 300 | 14.0 | no | (0, 1.0, 7.0) |
| `LGT-fire-key` | Area | 320 | 6.0 | no | (-4.2, 3.0, 1.6) |
| `LGT-pool` | Area | 190 | 5.0 | no | (-5.0, 5.6, 0.9) |
| `LGT-back-fill` | Area | 130 | 7.0 | no | (0, 6.5, 3.2) |

World strength **1.5**. The world uses a **vertical gradient**, not a flat colour — a `TexCoord > SeparateXYZ > ColorRamp > Background` chain with stops at 0.46 `#8E3A6B`, 0.55 `#4A2352`, 0.68 `#0E0A18`. A flat background read gives a misleading value.

### Prop rings

| Group | Count | Radius | Height |
|---|---|---|---|
| String bulbs | 48 | 8.40m | 3.00-3.30 |
| Palm fronds | 45 + 27 | 8.40m | 2.41-3.05 |
| City towers | 27 | 20.8-45.4m | -5.9 to -2.0 (below the parapet) |

Terrace disc scaled 1.62x, parapet 1.66x. Bar at 45 deg, entrance and signage at 135, lounge and second fire bowl at 180, planters and palms at 225/270/315, glass balustrade 250-290.

## Laundromat

### Lighting

| Light | Type | Energy | Size | Shadow | Position |
|---|---|---|---|---|---|
| `LGT-fluoro-0..3` | Area | 90 each | 2.2 | yes | (+/-2.6, 2.2 / -1.6, 2.92) |
| `LGT-basement-amb` | Area | 70 | 9.0 | yes | (0, 0, 2.7) |

World `#0E1614` at strength **0.35**.

### Room

Walls at +/-6.0m (x) and +5.0 / -4.6m (y), 3.1m tall, ceiling at 3.35m. Machine banks on the north and west walls, 28 units across two rows at radius 5.0-7.1m, z 0.42 and 1.36. Counter and carts east, door / notice board / vending south, four ceiling pipes spanning the full width at z 3.02.

**The checkerboard floor must be one plane with a checker texture.** The lookdev built it as 304 separate plane objects. That is the single worst object-count offender in the whole project.

## Executive Suite

### Lighting

| Light | Type | Energy | Size | Shadow | Position |
|---|---|---|---|---|---|
| `LGT-chandelier` | Area | 260 | 2.2 | **yes** | (0, 0, 3.3) |
| `LGT-sconce-0..3` | Area | 90 each | 1.6 | no | radius 6.9m, z 2.5, at 4 compass points |
| `LGT-bar` | Area | 120 | 4.5 | no | (0, 6.0, 1.9) |
| `LGT-amb` | Area | 80 | 10.0 | no | (0, 0, 3.9) |

World `#1A0A0E` at strength **0.6**.

### Room

Floor disc radius 8.2m, walls to 4.4m with flipped normals, ceiling at 4.4m.

| Element | Count | Radius | Height |
|---|---|---|---|
| Balusters | 56 | 5.40m | 0.52 |
| Scroll ornaments | 56 | 5.40m | 0.72 |
| Handrail torus | 1 | 5.40m | 1.06 |
| Chandelier rods | 34 | 0.55-0.99m | 3.05 |
| Bar bottles | 66 | 7.15-7.48m | 1.70-2.80 |
| Wall sconces | 8 | 7.70m | 2.35 |

Bar at 0 deg radius 6.6m, three lit shelves. Five standing patrons beyond the rail at 40/95/150/215/300 deg.

## Chairs

Three variants at `D:/River-art/blend/chairs.blend`, to be ported as parameterised generators.

| Venue | Design | Tris | Parts |
|---|---|---|---|
| Rooftop | Swivel: contoured leather seat and back, side wings, chrome column, five-star castor base | 1,432 | 16 |
| Laundromat | Folding metal: rear legs continue up to form the backrest frame, X-braces, cross rails | 396 | 13 |
| Suite | Dining: padded seat, back with timber crest rail, turned legs with stretchers | 760 | 14 |

Suite back top at **0.965m** — an earlier version at 1.235m was taller than a seated person's head and dwarfed the characters.

Bevel every hard edge, 12-25mm at 2-3 segments. That is most of the difference between furniture and primitives.

## Materials

Noise, never wave — see Finding 14. Wave textures produced corduroy stone and confetti filigree across three failed passes.

| Surface | Recipe |
|---|---|
| Stone, concrete, plaster | Noise scale 2.0-3.0, detail 6, tight ColorRamp, bump 0.03-0.05 |
| Fabric nap | Noise scale 340-420, detail 2, bump 0.08-0.10 |
| Leather, timber | Noise scale 6-12, detail 4-6, bump 0.15-0.40 |
| Ornament and line work | **Geometry or a texture map.** Never procedural |

Retinting a textured material requires editing the **ColorRamp stops**. Setting `Principled BSDF > Base Color` on such a material silently does nothing.

## Known defects to fix on port

1. **304 tile objects** in the Laundromat floor. One plane, one texture.
2. **Chips as individual objects** — 51 in the pot alone, 684 objects in the populated Suite against a 120 draw-call budget. Instancing is a requirement, not an optimisation.
3. **91 materials** in the populated Suite against a budget of 24. Per-instance character tinting must become one atlas with an instance property, not material datablock copies.
4. Garment collar and sleeve boundaries are jagged where the vertex-group selection ends. Needs a hem or a weight-threshold falloff.

None of these are visible in the renders. All of them block production.

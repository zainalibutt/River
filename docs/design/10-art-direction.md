# 10 — Art direction: Rooftop Bar and the 3D venue system

Art direction for River's 3D presentation, starting with venue one. Extends `01-thesis.md` and reuses the token system in `02-tokens.md`; where this document gives a value, it is the 3D value and the 2D token stays unchanged.

**Mandate: the reference staging, River grade.** Take the composition from the reference — round table, seated bodies, per-seat HUD floating over the scene, venue as backdrop, mid-height camera looking across the felt — and light it the way River lights things: dim room, one warm practical over the table, no neon rims, no glow bursts.

## Ordering, and why it is not negotiable

Art direction, then assets, then renderer. A 3D table with placeholder geometry and no seated bodies reads as **less** finished than the 2D mode already shipped. the reference looks good because of lighting, materials, venue character and people at the table. It does not look good because it is 3D. Building the renderer first produces a grey room that makes the project look worse than it did before it started.

## Budget

Conservative by policy, per the Q9 retarget in `docs/spec.md`. Desktop can exceed all of this; we do not, because a PS5 browser has to stay reachable and Packet 5A is deferred rather than cancelled. **Headroom is deliberately left unused.** These numbers are revisited only by real console measurement, never because a development machine copes.

| Budget | Ceiling | Notes |
|---|---|---|
| Scene triangles, total | 250,000 | Everything visible at once |
| Table, rail, chips, cards | 60,000 | Chips instanced, never modelled per-chip |
| One seated character | 12,000 | Nine seated = 108,000 worst case |
| Environment and backdrop | 80,000 | Skyline is a card, not geometry |
| Texture memory | 128 MB | Compressed where supported |
| Max texture dimension | 2048 | 1024 preferred; characters share one atlas |
| Unique materials | 24 | Atlas-first, share aggressively |
| Draw calls per frame | 120 | Instancing mandatory for chips and cards |
| Realtime shadow casters | 1 | The table practical only. Everything else baked or contact-blob |
| Frame target | 60fps desktop | Design assuming a 30fps floor on weaker hardware |

Lightmaps bake the room. Only the table light is realtime, and only because chips and cards move under it.

## The Rooftop Bar

### The place

A private rooftop terrace above a city, an hour after sunset. Not a club, not a casino — the sort of place a small group takes over for the evening. Low planters of dark foliage, a short bar along one edge with warm backlight, scattered string lights overhead, and a single hanging shade directly over the poker table. The skyline sits far below and out of focus.

The player never sees the whole terrace. The camera lives at the table, and the venue reads through what falls into frame at the edges: a planter, the bar's glow, a strand of lights, the drop to the city.

### Time and sky

Dusk, holding. The sky never cycles — a fixed gradient, because a changing sky changes every material's read and there is no budget to light for two conditions.

| Element | Value | Notes |
|---|---|---|
| Sky zenith | `#10131F` | Deep blue-violet, dark enough that the felt is the brightest thing on screen |
| Sky horizon | `#2A2437` | |
| Horizon warm band | `#3E3140` | Thin, the last of the sun |
| Skyline silhouette | `#0C0F16` | A single card with alpha, not geometry |
| Skyline window points | `#E8A93C` at 18% | Sparse warm pinpricks, heavily bokeh'd |

**The sky is a backdrop, not a light source.** It contributes almost nothing to the table. This is what keeps the Rooftop from becoming the neon venue it is in the reference.

### Lighting rig

Four lights, one of them realtime.

| Light | Type | Colour | Intensity | Purpose |
|---|---|---|---|---|
| Table practical | Realtime spot, hanging shade | `#FFD9A0`, ~3200K | Key | The one lamp. Pool of light on the felt, sharp falloff at the rail |
| Bar backlight | Baked area | `#B87333` | Low fill | Warm copper wash on the frame's left edge |
| String lights | Baked points | `#FFC07A` | Very low | Overhead sparkle, visible in frame, lighting almost nothing |
| Sky ambient | Baked hemisphere | `#1A2030` | Floor | Cool, minimal. Keeps shadows blue rather than black |

The practical is the only caster. Its cone is tuned so the felt centre reads at roughly the `--river-felt-lit` value from `02-tokens.md` and the rail edge falls to `--river-felt-shadow`. **The 2D radial gradient and the 3D light must produce the same felt read** — that is the mechanism that makes the two renderers feel like one game.

### Materials

| Surface | Treatment |
|---|---|
| Felt | Deep green, high roughness, subtle directional nap. No specular highlight. Base `--river-felt` |
| Rail | Worn leather, `--river-rail`, roughness varied by a subtle mask so wear reads at the elbows. Copper stitch line |
| Table body | Dark stained wood, low sheen. Visible grain at close camera only |
| Chips | Clay, matte, slight edge chamfer catching the practical. Denomination colours from `02-tokens.md`. **Instanced** |
| Cards | Warm white `--river-card-face`, matte, 1mm thickness modelled. Four-colour faces per Decision 1 |
| Bar | Dark timber, brushed brass rail, bottles as a single alpha card |
| Planters | Concrete, dark foliage `#16241C` reading near-black |
| Floor | Wet-look composite decking, low roughness so the practical throws one soft reflection |

Refused outright: emissive table rims, LED strips, animated neon, glass with heavy refraction, chrome, anything that reads as a casino floor.

## Camera language

Fixed cinematic angles with automatic drama, per `docs/spec.md`. No free orbit in v1.

| State | Height above table | Distance from centre | Pitch | FOV | Transition |
|---|---|---|---|---|---|
| Default | 1.05m | 2.60m | -22 degrees | 38 | — |
| Showdown | 1.00m | 2.35m | -20 degrees | 36 | Slow push, 1400ms `--ease-in-out` |
| All-in | 0.90m | 1.90m | -16 degrees | 32 | 600ms `--ease-settle` |
| Between hands | 1.05m | 2.60m | -22 degrees | 38 | Return, 800ms `--ease-out` |

38 degrees is a longer lens than most games use. It flattens perspective, keeps opposite seats from distorting, and reads as photographed rather than rendered. The hero's cards anchor the bottom of frame at all times.

The camera never moves during a betting round. Motion is reserved for showdown and all-in, so when it moves the player knows something happened.

## Seated bodies

Confirmed for v1 by Zain. the reference's characters are a large part of why its tables feel occupied, and an empty 3D table reads worse than a 2D one.

| Property | Value |
|---|---|
| Style | Stylised-realistic, the reference-adjacent. Not cartoon, not photoreal |
| Budget | 12,000 triangles, one shared 1024 atlas across the cast |
| Rig | Upper body only below the waist is static — characters are seated and never walk |
| Faces | No facial animation, per spec. Features are textured, not rigged |
| Silhouette | Must read at 10 feet. Distinct headwear, shoulder line and posture per archetype. Silhouette test is an acceptance criterion below |
| Variation | Palette swaps plus three head accessories over two base bodies for v1 |

### Animation set, v1

| Clip | Length | Trigger |
|---|---|---|
| Idle breathe and sway | 4.0s loop | Default |
| Card peek | 1.2s | On deal, once |
| Chip toss | 0.8s | On bet, call or raise |
| Win react | 1.6s | On award |
| Lose react | 1.4s | On losing showdown |
| Stand up on all-in | 1.8s | The signature moment |

**Movement polish is explicitly deferred.** V1 targets *readable*, not *refined* — the correct clip fires at the correct moment with correct timing. Weight, secondary motion, blending quality and personality per archetype are a later pass, recorded here so it is not mistaken for finished work. Zain confirmed this ordering.

## The all-in moment

River's signature, inherited from the reference and named in the spec. In order:

1. Chips push to the pot line, 320ms.
2. Character stands, 1800ms, starting 100ms after the chips.
3. Camera moves to the all-in framing, 600ms, overlapping the stand.
4. Table practical intensity lifts 15% over 400ms and returns over 800ms. The room does not change — only the lamp.
5. `ALL IN` sets over the felt in the display face, 700ms, then clears.
6. Remaining streets deal at normal pace.

No screen shake, no colour flash, no particles. The weight comes from a person standing up and the light tightening.

## HUD over 3D

**The HUD stays in the DOM. It is not drawn into the WebGL canvas.**

This is the most important technical decision in this document. Text legibility, focus management, screen-reader support, reduced motion and the hold-to-confirm semantics are all solved in `apps/web` already and are all genuinely hard inside a canvas. Keeping the HUD in DOM means the entire 2C/2D layer survives the move to 3D.

| Layer | Owner |
|---|---|
| Venue, table, chips, cards, characters | R3F canvas |
| Seat plates, stacks, pot, action rail, status line, verify pill, menus, focus ring | DOM, unchanged from 2D |

Seat plates become **world-anchored**: the renderer projects each seat's 3D position to screen space each frame and positions the existing DOM plate there. The plate component itself does not change. Everything in `02-tokens.md`, `04-anatomy.md`, `05-states.md`, `06-interaction.md` and `07-motion.md` continues to apply.

What the 2D mode keeps: the identical HUD over a flat felt instead of a scene. That is what makes it a genuine graphics-saver mode rather than a lesser product.

## Venues two and three

Direction only. Production follows venue one.

| Venue | Read | Key light | Palette shift |
|---|---|---|---|
| Underground Basement | Low ceiling, concrete, a single caged bulb, cigarette haze. The dimmest room and the closest to River's thesis | Bare bulb, ~2700K, harsh falloff | Cooler shadows, `#0E1210` room, warmer single key |
| High-end Suite | Panelled wood, deep carpet, table lamps, a city window. Quiet money rather than casino glamour | Layered warm practicals, ~3000K | Richer browns, `--river-copper` more present, felt slightly bluer |

All three share the same table, chips, cards, characters and HUD. **Only the room and the lighting change.** That is what makes three venues affordable.

## Acceptance criteria

- [ ] Scene triangle count, texture memory, draw calls and material count all measured under the budget table, on the default camera with nine seated characters
- [ ] Felt centre and rail edge in 3D read within perceptual tolerance of the 2D `--river-felt-lit` and `--river-felt-shadow` values, side by side
- [ ] No emissive rim, LED strip or neon element anywhere in the scene
- [ ] Character silhouette test: greyscale the frame to pure black shapes at 1280x720 and confirm every seat is distinguishable
- [ ] Camera does not move during any betting round
- [ ] All six v1 animation clips fire on their correct triggers
- [ ] HUD renders in DOM; no text is drawn into the canvas
- [ ] Every `05-states.md` state renders identically over the 3D scene as over the 2D felt
- [ ] Toggling to 2D graphics-saver mode preserves all HUD state and focus position
- [ ] Full gamepad path works in 3D mode with no pointer-only affordance
- [ ] Scene holds 60fps desktop, and degrades to the 2D renderer cleanly rather than dropping frames

## Handoff constraints

**DeepSeek — asset pipeline.** Procedural bpy scripts for table, rail, chips and cards against the budget table. Deterministic output, validated export, consistent naming. No art direction decisions: colours, dimensions and materials come from this document.

**Codex — renderer.** R3F scene, resource lifecycle, instancing, DOM HUD projection, 2D/3D parity, profiling, graceful fallback. Does not reinterpret the lighting rig or camera table; departures route back here.

**Both.** The budget ceilings are policy, not guidance. Exceeding them because a desktop machine copes defeats the entire reason the Q9 retarget was acceptable.

# 10 — Art direction: Rooftop Bar and the 3D venue system

Art direction for River's 3D presentation, starting with venue one. Extends `01-thesis.md` and reuses the token system in `02-tokens.md`; where this document gives a value, it is the 3D value and the 2D token stays unchanged.

> **READ THE REVISIONS FIRST.** This document grew by accretion across one working session. The sections below the first horizontal rule — the reference-derived revision, the lighting study, the card study, the venue build study, the orbit study and the material study — **supersede the original text above them wherever they disagree.** The original header described a dark single-lamp room with a fixed cinematic camera; both were wrong and are corrected further down.

**Mandate: reference staging, River grade.** Take the composition from the reference game — oval table, seated bodies, per-seat HUD floating over the scene, venue as backdrop — and give each venue its own light. The Rooftop is bright and open; the Basement is dim and fluorescent. The range across venues is the point, not a single global grade.

## Ordering, and why it is not negotiable

Art direction, then assets, then renderer. A 3D table with placeholder geometry and no seated bodies reads as **less** finished than the 2D mode already shipped. The reference looks good because of lighting, materials, venue character and people at the table. It does not look good because it is 3D. Building the renderer first produces a grey room that makes the project look worse than it did before it started.

## Budget

Conservative by policy, per the Q9 retarget in `docs/spec.md`. Desktop can exceed all of this; we do not, because a PS5 browser has to stay reachable and Packet 5A is deferred rather than cancelled. **Headroom is deliberately left unused.** These numbers are revisited only by real console measurement, never because a development machine copes.

| Budget | Ceiling | Notes |
|---|---|---|
| Scene triangles, total | 250,000 | Everything visible at once |
| Table, rail, chips, cards | 60,000 | Chips instanced, never modelled per-chip |
| One source character | **23,000** (revised 2026-08-28 after the permitted orbit exposed the old leg cut) | Venue LOD and the 250,000 scene ceiling remain shipping gates |
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

The practical is the only caster. Measured working values are in the lighting study at the end of this document, not here — the first-pass intensities in this table were wrong by an order of magnitude and the study supersedes them.

**The two renderers must agree on the felt read, but 2D follows 3D rather than the reverse.** A warm key light cannot reproduce the blue-leaning `--river-felt-lit` token; see Finding 2.

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

## Camera language — SUPERSEDED

> The fixed-angle table below is **wrong** and is retained only to show what changed. River's camera is a seat-relative orbit under player control, specified in `06-interaction.md`, with measured per-venue orbit parameters in the orbit study at the end of this document. Do not implement from this table.

| State | Height above table | Distance from centre | Pitch | FOV | Transition |
|---|---|---|---|---|---|
| Default | 1.05m | 2.60m | -22 degrees | 38 | — |
| Showdown | 1.00m | 2.35m | -20 degrees | 36 | Slow push, 1400ms `--ease-in-out` |
| All-in | 0.90m | 1.90m | -16 degrees | 32 | 600ms `--ease-settle` |
| Between hands | 1.05m | 2.60m | -22 degrees | 38 | Return, 800ms `--ease-out` |

38 degrees is a longer lens than most games use. It flattens perspective, keeps opposite seats from distorting, and reads as photographed rather than rendered. The hero's cards anchor the bottom of frame at all times.

The camera never moves during a betting round. Motion is reserved for showdown and all-in, so when it moves the player knows something happened.

## Seated bodies

Confirmed for v1 by Zain. The reference's characters are a large part of why its tables feel occupied, and an empty 3D table reads worse than a 2D one.

| Property | Value |
|---|---|
| Style | Stylised-realistic, reference-adjacent. Not cartoon, not photoreal |
| Budget | 12,000 triangles, one shared 1024 atlas across the cast |
| Rig | Complete seated body; lower limbs stay on the shared rig for chair fit and the all-in stand-up |
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
- [ ] Felt centre and edge in 3D match the measured values in the lighting study below, and the 2D tokens have been re-tuned to agree with them
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


## Lighting study — measured findings

Built and rendered in Blender 5.2 on 2026-08-23 through the MCP bridge: felt, rail, table body and denominational chips under the four-light rig, camera at the contract position (1.05m above table, 2.60m back, -22 degrees, 38 degrees FOV). Renders in `D:/River-art/`.

Three findings, all of which change this document.

### Finding 1 — the original light levels were badly wrong

The practical at the first-pass intensity blew the felt to a pale sage and crushed everything outside the pool to pure black. The room read as a void with a table floating in it, not as a room. Corrected values, verified by render:

| Light | Corrected | Was |
|---|---|---|
| Table practical | 18W, cone 105 degrees, blend 0.85, soft size 0.25 | 220W, cone 78 degrees, blend 0.55 |
| Bar backlight | 40W area | 26W |
| String lights | 8W each | 3W |
| World ambient | `#101613` at strength 1.0 | `#10131F` at 0.35 |

A floor plane is required. Without one the falloff terminates in nothing and the venue cannot read.

### Finding 2 — a warm key light cannot produce the token felt colour

**This invalidates the original acceptance criterion.** The contract required the 3D felt to read within tolerance of `--river-felt-lit` (`#2A5B45`), a blue-leaning green. Measured across three view transforms:

| View transform | Felt centre | Felt edge |
|---|---|---|
| Standard | `#63735C` | `#5D6C53` |
| Filmic | `#63775C` | `#5D6E53` |
| AgX | `#58694F` | `#516045` |
| **Target** | **`#2A5B45`** | **`#122C21`** |

Every transform lands on olive, with red and green near-equal. Pre-correcting the felt base colour cooler (`#1C4232` to `#0B3A33`) moved it in the right direction but nowhere near.

This is not a render setting, it is physics. A warm practical (`#FFD9A0`) multiplied against a green base lifts red disproportionately and produces olive. The only ways to hit a blue-leaning green are to cool the key light toward neutral — which destroys the warm-room thesis this whole document rests on — or to abandon the target.

**Resolution: the 2D tokens follow the 3D render, not the reverse.** 3D is the primary presentation per `docs/spec.md`; the 2D DOM mode is the graphics-saver. Re-tune `--river-felt-lit`, `--river-felt` and `--river-felt-shadow` in `02-tokens.md` to the measured 3D values once the rig is final, so both renderers agree. Do not cool the lamp to chase a token.

### Finding 3 — chip denominations are not readable at the contract camera

At 39mm diameter, 2.60m distance and 38 degrees FOV, chips resolve to a few pixels. Colour is distinguishable; value is not, at any texture resolution.

This is not a defect. It confirms the decision in this document to keep the HUD in the DOM — every amount a player must read is typographic and lives in the HUD layer, never on the 3D chips. Physical chips are **decorative volume only**, and their denomination colours exist to sell the table, not to convey information. Any future proposal to read chip values off the 3D scene should be refused on this evidence.

### Still open

The study covers the table under its lamp. It does not yet cover the venue: no sky, skyline, bar, planters or string-light geometry exist, so the current renders read as a table in darkness rather than a rooftop. Environment is the next study.


## Card legibility study — cards do not work at physical scale

Rendered the four-colour deck as real geometry at 63.5 x 88.9mm — true poker card dimensions — on the felt, at all three contract camera states.

### Finding 4 — physically-scaled cards are illegible

At the default camera (1.05m above table, 2.60m back, 38 degrees FOV) a real-sized card resolves to a smudge. Suit colour is faintly detectable; rank and pip are not readable at 1280x720, and would be worse on a TV at distance.

This is the same class of problem as the chips, but with the opposite conclusion. Chips carry no information, so illegibility is fine. **Cards are the single most information-dense object in the game.** A player who cannot read the board cannot play.

Measured minimum scales, rendered and compared:

| Card scale | Physical width | Result |
|---|---|---|
| 1.0x | 63.5mm | Illegible. Suit colour barely detectable, rank unreadable |
| 1.8x | 114mm | **Minimum viable.** Suit instant, rank readable with rank-dominant typography |
| 2.4x | 152mm | Comfortable. Recommended for board cards |
| 3.0x | 190mm | Legible but the table starts reading as a toy |

**Cards render at a cheat scale of 1.8x to 2.4x physical.** River's cards are not physically accurate objects and should never be modelled as such. The reference does the same thing — its cards are visibly oversized relative to its chips and hands, for exactly this reason.

### Finding 5 — the traditional card face is wrong for 10-foot reading

A real playing card puts a small rank in the corner and a large pip in the centre. That is correct for a card held in the hand at 30cm and wrong for a card read across a room.

Invert it. Measured working layout:

| Element | Size | Position |
|---|---|---|
| Rank glyph | 46% of card width | Centred, upper third |
| Suit pip | 34% of card width | Centred, lower third |
| Corner repeats | none | Removed — they read as noise at distance and cost texture space |

With rank-dominant typography, 1.8x is as readable as 2.4x was with a traditional face. **Good face design buys roughly a 25% reduction in the cheat scale**, which is worth having because a smaller cheat keeps the table believable.

### Finding 6 — four-colour deck empirically validated

This is the strongest result in the study. At every scale tested, including 1.0x where ranks were completely unreadable, **suit was identified instantly from colour alone**. Spade black, heart red, diamond blue, club green separate cleanly under the warm practical without the rank being legible at all.

Decision 1 was taken on reasoning. It is now evidence. A two-colour deck at these scales would require reading pip shape, which fails well before rank does.

### Consequence for the renderer

Hero hole cards should live in the **DOM HUD layer**, not as felt geometry — rendered at whatever size the HUD needs, exactly as the reference draws them large at the bottom of frame. Board cards stay in the 3D scene at 2.4x. This keeps every readable surface in the layer that is already solved for typography, focus and reduced motion, and leaves the 3D scene carrying only what it is good at: material, light and volume.


---

# REVISION — reference-derived direction (2026-08-24)

Zain supplied the reference reference for all three venues (`docs/images/`). **This section supersedes the thesis-derived direction above where they conflict.** The measured findings — light levels, card scale, four-colour validation, budgets — all still hold. What changes is the target.

## What the references establish

Three decisions, taken by Zain after seeing the thesis rendered:

1. **Bright, like the reference.** The Rooftop is a lit place, not a dark room with a lamp in it. "The room is dark, the felt is lit" survives only in the Basement.
2. **A different table per venue.** Not one table in three rooms.
3. **Wide camera, venue clearly visible.** The environment is part of the shot, not peripheral atmosphere.

### Cards are never readable in 3D — confirmed by Zain

In the reference you cannot peek under a card. Your hole cards exist only as the 2D HUD hand; the felt carries backs and, at showdown, generic faces. **This retires Findings 4 and 5 as production requirements** — no cheat scale, no rank-dominant face design, no readable card geometry at all.

3D cards are backs plus low-detail showdown faces. Every readable surface stays in the DOM HUD, which is what the renderer contract already required for other reasons. Finding 6 still stands and moves to the HUD: the four-colour deck is validated and applies to the 2D card components.

**Parked, noted:** real readable 3D card generation is a later step if River ever wants a closer camera or a card-inspection interaction. Not v1.

## Venue one — Rooftop Bar

Night, not dusk. A high terrace above a city.

| Element | Specification |
|---|---|
| Sky | Deep magenta-to-violet gradient at the horizon falling to near-black at zenith. Night, with colour |
| City | Skyline **below and around** the parapet — you are looking down at lit windows, not across at a wall. Distant mountain range on the horizon behind the towers |
| Vegetation | Palm silhouettes, backlit, framing the top of frame. Dark against the sky, not lit |
| Fire | Fire bowl and a linear fire feature along the pool edge. **A primary warm light source**, not decoration |
| Water | Reflective pool, cool blue, frame left. Second light source by reflection |
| Floor | Light marble or tile in a geometric radial pattern. Pale, which is a large part of why the venue reads bright |
| Parapet | Curved wall with a lit top edge |
| Signage | Venue wordmark in warm neon, frame edge |
| Extras | Distant fireworks. Cheap to fake, sells the height and the occasion |

**Lighting balance:** ambient from sky and city, warm key from the fire features, cool fill from the pool, soft overhead from string lights. No single dominant practical. Characters take visible rim light.

### Rooftop table

| Property | Specification |
|---|---|
| Shape | **Oval / racetrack**, long axis across frame |
| Felt | Near-black navy with an **ornate gold filigree pattern** — scrollwork across the whole playing surface. Not plain felt |
| Rail | Thick padded leather, black-navy, generously rounded |
| Base | Modern dark pedestal |
| Chairs | Black modern swivel chairs, chrome bases, high backed |

## Venue two — Underground Basement

A laundromat back room. The one venue where the original dark thesis holds.

| Element | Specification |
|---|---|
| Grade | Cool green-cyan cast over everything. Industrial fluorescent, not warm |
| Room | Washing machines and dryers along the walls, stacked crates, a stepladder, pipework, posters |
| Floor | Blue and white checkerboard tile, worn |
| Light | Overhead fluorescent, flat and unflattering. Slight haze |
| Mood | Cheap, cramped, improvised. The opposite of the Rooftop in every respect |

### Basement table

| Property | Specification |
|---|---|
| Shape | Oval, smaller |
| Felt | Worn grey-green, stained, no pattern |
| Rail | Plain timber edge, scuffed |
| Base | Wooden barrels or crates. Improvised, not furniture |
| Chairs | Cheap folding metal chairs, mismatched |

## Venue three — High-end Suite

A private club room. Warm, red and gold, expensive without being a casino floor.

| Element | Specification |
|---|---|
| Grade | Deep reds and golds, warm throughout |
| Walls | Red panelling and patterned fabric |
| Feature | Gold rod chandelier over the table; back bar with lit bottle shelves |
| Foreground | **Ornate gold scrollwork balustrade** partially framing the bottom of shot. Strong depth cue and the venue's signature |
| Light | Layered warm practicals — chandelier, wall sconces, bar backlight |
| Extras | Bar staff and standing patrons in the background. The room is populated beyond the table |

### Suite table

| Property | Specification |
|---|---|
| Shape | Oval |
| Felt | Bright olive-gold green, clean, no pattern |
| Rail | Dark padded leather |
| Base | Solid dark pedestal |
| Chairs | Upholstered dining chairs in tan and mustard |

## Characters

Required, and the largest single reason those frames read as places rather than rooms. Confirmed by Zain.

| Property | Specification |
|---|---|
| Base meshes | **One male, one female.** Everything else is customisation on top |
| Customisable | Face, hair, plus the standard seated-character axes — skin, outfit, accessories |
| Headwear | Bowler hats, fedoras, caps, headbands. **The primary silhouette differentiator** — visible in every reference frame and doing most of the work of making seats distinguishable |
| Style | Stylised-realistic with slightly exaggerated proportions. Not cartoon, not photoreal |
| Framing | Seated, visible from roughly the waist up. Below-waist geometry is occluded in every camera |
| Faces | Simple. Textured features, no facial rig |

This changes `11-character-pipeline.md`: the pipeline produces **two rigged base meshes plus a customisation layer**, rather than a fixed cast. Parametric generation is still the right route — it is exactly how you get two consistent bases that share one rig and one animation set.

## Camera

Wide enough that the terrace, skyline and chairs are all in shot. In the reference the whole table, every seat and a substantial amount of venue are visible, with the hero seen from behind at the bottom of frame.

The camera-state table earlier in this document was authored for a tight table-first framing and needs re-deriving against this. Superseded pending a new study.

## What survives from the original direction

- Every budget ceiling.
- The corrected light *levels* as a technique, though not the single-practical rig.
- Instancing requirements for chips.
- HUD stays in the DOM — now reinforced rather than weakened, since cards are HUD-only.
- Four-colour deck, validated, applied to the HUD cards.
- No purchase surface, no real-money affordance, ever.


## Venue build study — Rooftop and Basement (2026-08-24)

Both venues built and rendered from the reference. Files: `D:/River-art/blend/rooftop_lookdev.blend`, `basement_lookdev.blend`.

### Finding 7 — the venue system works, and it is cheap

The same table assembly, characters and chips were reused across both venues. Only the room, the lighting and the material tints changed, and the two frames read as completely different places. That is the venue system in `01-thesis.md` proven rather than asserted.

| Venue | Triangles | Materials | Read |
|---|---|---|---|
| Rooftop | 63,984 | 19 | Night terrace, city below, warm fire pools against cool sky |
| Basement | 42,640 | 24 | Laundromat, cool green fluorescent, checkerboard tile |
| Budget | 250,000 | 24 | |

**Environment is not where the budget goes.** Both venues sit at a quarter of the ceiling with everything visible. Nine production characters at 12,000 each is 108,000 — nearly half the total budget on its own. Any future budget pressure will come from the cast, never the room, so venue detail can be spent freely and character count cannot.

### Finding 8 — measured seating geometry

Players were initially placed at 1.72x / 1.95x the felt radii and their arms had to reach absurdly far. Corrected and verified by render:

| Property | Value |
|---|---|
| Felt radii | 1.24m x 0.72m (2.48 x 1.44m oval) |
| Seat ring radii | **1.42x / 1.58x** the felt radii |
| Rail contact radii | 1.05x / 1.09x the felt radii |
| Seat height | 0.46m, table surface 0.76m |
| Shoulder height seated | 0.99m, head centre 1.22m |

### Finding 9 — primitive characters hit a hard ceiling

Nine seated figures were assembled from cylinders and spheres with varied headwear, hair, skin and outfits. They successfully prove composition, silhouette spacing and how much the table needs to be occupied — the frames are transformed by their presence, which confirms Zain's judgement that characters matter most.

They also look like robots, and no amount of further primitive work fixes that. Arms in particular read as plumbing. **This is the evidence for the parametric route in `11-character-pipeline.md`** — primitives are a blocking tool, not a fallback. At 1,076 triangles each they are also nowhere near the 12,000 budget, so the constraint on real characters is authoring effort, not polygons.

### Two pipeline notes for DeepSeek

**Do not build tiled surfaces as object grids.** The basement checkerboard was built as 304 separate plane objects. It should be one plane with a checker texture. Triangle count barely moved but object count exploded, and object count is what drives draw calls — the budget table caps those at 120.

**Textured materials cannot be retinted through the BSDF.** Once a material drives Base Color from a ColorRamp, setting `Principled BSDF.Base Color` silently does nothing. Venue tinting must edit the ramp stops. This will bite anyone writing a "swap the palette per venue" script.


---

# Revision — behaviour reference (2026-08-24)

`docs/behaviour-reference.md` supersedes three things in this document.

## Three venues at launch, the reference's set as general law

**Settled 2026-08-24: three launch venues, not five.** The reference's wider venue set stays authoritative as *reference law* — its staging, lighting language, dealer conventions and identity-per-room approach govern River's art direction. River ships three rooms. Biker Bar and Casino are parked as post-launch, not cancelled, and the venue system is deliberately built so adding one is a room and a light rig rather than a new product.

Shipping at launch:

| Venue | Identity | Dealer |
|---|---|---|
| **The Rooftop** | High-roller terrace, night city, fire and pool | rotating player |
| **Laundromat** | Cheap back room, cool fluorescent, checkerboard tile | rotating player |
| **Executive Suite** | Red and gold private club, chandelier, gold balustrade | rotating player |

Venues change art, lighting, background life, ambient SFX, music, dealer presentation and theme. They **never** change poker rules, hand ranking, betting or timers. Treat venue as presentation configuration, not a rules variant.

Rooftop and Laundromat lookdev builds exist (`D:/River-art/blend/`). Executive Suite is fully specced from reference and unbuilt.

**Parked, post-launch:** Biker Bar (rough, warm, cluttered, rotating player-dealer) and Casino (formal floor, other tables and patrons visible, **dedicated croupier NPC** — the only venue needing that presentation path). The croupier variant still belongs in the dealer-presentation contract so the system stays ready for it.

## Correction to Finding 3 — chips are not decorative

Finding 3 concluded that because chip denominations are unreadable at the play camera, physical chips are "decorative volume only". That was half right and the wrong half was load-bearing.

The reference is explicit: **physical chip stack height must represent the player's actual table stack at a glance.** A rich stack must visibly dwarf a short one.

| Property | Correct position |
|---|---|
| Denomination colour readable at camera | No, and not required |
| Stack height tracks magnitude | **Yes, required** |
| One mesh per literal chip | No — denomination stacks and pooled instances |
| Numeric value | HUD nameplate, never read off the chips |

Chips carry magnitude; the HUD carries value.

## The camera table is superseded

The fixed default / showdown / all-in camera table earlier in this document described a locked cinematic camera. River's camera is a **seat-relative orbit under player control** with temporary cinematic takeover — see `06-interaction.md`, which is now canonical for camera behaviour.

What survives from the camera study: the venue must be clearly visible in the default framing, and a tight crop of felt and hands is explicitly the wrong composition.

## Findings 4 and 5 remain retired

Card cheat scale and rank-dominant face design were retired when Zain confirmed cards are never readable in 3D. That still holds for **hole** cards. Community cards are readable in-world *and* mirrored in the HUD, so the felt board does need legible faces — but the HUD mirror carries the reading, so no cheat scale is required.

Finding 6 — four-colour deck validation — stands and applies to the HUD cards.


## Orbit camera study — Rooftop (2026-08-24)

Eight-angle turnaround at 45-degree intervals, orbit radius 6.1m, height 4.05m, pitch 62 degrees, FOV 64. Contact sheets in `D:/River-art/orbit/`. This was the first test of the venues against the orbit camera the behaviour reference requires, and it found two structural failures that a single fixed camera angle had completely hidden.

### Finding 10 — the venue was a one-sided stage set

Yaw 0 through 135 had the pool, fire, palms and string lights. Yaw 180 through 315 were a bare terrace against a flat magenta band. Every previous render in this document was shot from the dressed side.

**With an orbit camera, every angle is somebody's default angle.** A venue must be dressed through a full 360 degrees or it collapses the moment a player rotates.

Fixed by distributing features around the whole terrace: second bar and stools at 45 degrees, entrance stairhead and venue signage at 135, lounge cluster and second fire bowl at 180, planters with palms at 225/270/315, glass balustrade viewpoint at 250-290, and the string-light run rebuilt as a full ring of 48 bulbs rather than a single span.

**This applies to all five venues.** Any venue built and judged from one angle is unbuilt.

### Finding 11 — the orbit path must be kept physically clear

The back-quarter palms were placed at radius 6.0m. The camera orbits at 6.1m. At yaw 225 the camera was **inside a palm tree**, and the fronds filled the lower frame as large black shapes that read convincingly as shadow artifacts.

This is exactly the camera-bounds rule already written in `06-interaction.md` — do not let the orbit clip through venue geometry — but it had never been measured. Now it is:

| Property | Value |
|---|---|
| Orbit radius | 6.1m |
| Camera height | 4.05m |
| **Minimum prop clear radius** | **8.4m** for anything above 2m tall |
| Terrace radius | scaled to 1.62x to keep props on deck |

159 props were pushed outside the clear radius. Venue kit generation must respect this annulus.

### Finding 12 — only table-level geometry may cast shadows

Raising the overhead table light above the palm canopy made the canopy cast knife-edged shadows across the entire terrace. Shadow casting is now restricted to the table, chairs, characters, chips and cards; 493 decorative objects were excluded via `visible_shadow = False`.

The overhead light was also only 1.84m above the felt, producing long hard chair shadows. Corrected to 3.14m above the felt at size 5.5, which is the single realtime caster the budget allows.

### Diagnostic technique worth reusing

When an artifact appears, isolate the layer before guessing:

| Render | Isolates |
|---|---|
| Workbench, flat shading | geometry only - if the artifact persists it is a mesh, not lighting |
| EEVEE with all lights `hide_render` | world lighting only - separates lamp shadows from environment |
| Per-object bounding-box scan against the floor plane | geometry punching through surfaces |

The wedges survived both light-muting passes, which is what finally pointed at geometry occluding the camera rather than shadows being cast onto it.


## Material study and Basement orbit (2026-08-24)

### Finding 13 — the Basement had the same one-sided failure

Confirmed that Finding 10 generalises. The Basement's washing machines were on a single wall; the other three were bare. Dressed out with a second machine bank on the west wall, folding counter and laundry carts east, door / notice board / vending south, ceiling pipework running the full width, and clutter distributed so no quarter is empty.

Indoor venues need a tighter orbit than the terrace: **radius 3.6m, height 2.45m, pitch 72 degrees** against the Rooftop's 6.1m / 4.05m / 62 degrees. Orbit parameters are per-venue; the interaction model is not.

### Finding 14 — procedural wave textures are the wrong tool for stone and ornament

Three failed passes, recorded so nobody repeats them.

| Attempt | Result |
|---|---|
| Wave texture for marble veining | Corduroy, then zebra stripes. Stone does not ripple |
| Crossed wave textures thresholded for gold scrollwork | Dense confetti, then sparse blobs. Never read as line work |
| Lowering frequencies to fix both | Made the marble worse and the filigree no better |

What worked:

| Surface | Correct tool |
|---|---|
| Stone, concrete, plaster | **Noise** at low contrast with a tight colour ramp. Mottle, not pattern |
| Fabric nap | Noise at very high scale with a shallow bump |
| Ornament and line work | **Geometry or a real texture map.** Not procedural |

The Rooftop table now uses a plain navy nap with **two clean concentric gold border rings** — 2 objects replacing the 31-torus ring chain that read as a bicycle chain. A clean table beats a badly patterned one, and it dropped object count at the same time.

### Finding 15 — object count is the budget that is actually in trouble

Measured on the finished Rooftop:

| Metric | Value | Budget | Status |
|---|---|---|---|
| Triangles | 85,454 | 250,000 | comfortable |
| Materials | 55 | 24 | **over** |
| Objects | 879 | 120 draw calls | **far over** |

Triangles were never the risk. **Object and material count are.** Most of the 879 are individual chips and string-light bulbs which must become instanced meshes sharing one draw call, and the 55 materials are largely per-character palette variants that must become one atlas.

This is a production requirement for the venue kit and character pipeline, not a lookdev concern — but it needs recording now because the lookdev builds will otherwise be used as a reference for object structure.


## Executive Suite built — launch venue set complete (2026-08-24)

Third and final launch venue. `D:/River-art/blend/suite_lookdev.blend`, turnaround at `D:/River-art/orbit/suite_turnaround.png`.

Built from `docs/images/suite2.webp`: deep red walls and carpet, olive-gold felt, dark padded rail, tan and mustard upholstered dining chairs, gold rod chandelier over the table, back bar with lit bottle shelves, wall sconces ringed so every orbit angle catches one, standing patrons beyond the rail, and the ornate gold balustrade encircling the pit — the venue's signature element.

### Finding 16 — applying the earlier findings up front is worth roughly 3x

Every prior finding was applied before the first render rather than discovered again: dressed through 360 degrees from the start (10), props outside the orbit annulus (11), table-level shadow casting only (12), per-venue orbit parameters (13), noise textures rather than wave (14), and object count treated as the real budget (15).

**It landed correct on the first render** — no black wedges, no bare quarter, no corduroy stone, no camera inside geometry.

| Venue | Triangles | Objects | Materials | Notes |
|---|---|---|---|---|
| Rooftop | 85,454 | 879 | 55 | built before the findings existed |
| Basement | 44,444 | 822 | 48 | built before Finding 15 |
| **Suite** | **21,812** | **306** | **10** | built with all findings applied |

Object count is where it shows: 306 against 879 for a room of comparable visual density, and 10 materials against 55. Both are inside the draw-call and material budgets that the other two blow.

**The Rooftop and Basement should be rebuilt to the Suite's structure** before production. They are correct as lookdev and wrong as a template — and they are the two most likely to be copied by whoever writes the production venue kit.

### Launch set complete

Three venues, three legible identities, from one table assembly and one character set:

- **Rooftop** — night terrace, magenta sky, city below, fire and pool, pale stone
- **Laundromat** — cool green fluorescent, checkerboard tile, machine banks
- **Executive Suite** — warm red and gold, chandelier, balustrade, bar

The venue system claim in `01-thesis.md` is now demonstrated across the full shipping set rather than asserted from two examples.


## Chair variants built (2026-08-24)

Chairs appear in every frame of every venue and were box-on-a-stick placeholders until now. Three variants modelled, one per venue, at `D:/River-art/blend/chairs.blend`.

| Venue | Design | Triangles | Parts |
|---|---|---|---|
| **Rooftop** | Modern swivel: contoured leather seat and back, side wings, chrome column, five-star castor base | 1,432 | 16 |
| **Laundromat** | Cheap folding metal: thin tubular frame where the rear legs continue up to form the backrest, X-braces, cross rails | 396 | 13 |
| **Executive Suite** | Upholstered dining: padded seat and tall back, timber crest rail, turned legs with stretchers | 760 | 14 |

All three are trivial against budget — nine Rooftop chairs cost 12,888 triangles, roughly one character.

### Note for the venue kit

These belong in `art/pipeline/geo.py` as parameterised variants rather than living only in a lookdev file. They share a common structure — seat, back, legs, connectors — and differ in profile, material and leg system, which is exactly the shape a single parameterised generator wants.

### Two modelling notes

**A folding chair's back is not a separate object.** The first attempt floated a back panel above the seat with a visible gap. On a real folding chair the rear legs continue upward to become the backrest frame. Modelling it as one continuous element fixed it and removed a part.

**Bevel every hard edge.** A 12-25mm bevel at 2-3 segments on seats, backs and rails is what stops furniture reading as primitives. It costs almost nothing and it is most of the difference between these and the boxes they replace.


## Full table assembled — Executive Suite populated (2026-08-24)

First complete River scene: venue, real chairs, nine distinct characters, chip stacks and board. `D:/River-art/blend/suite_populated.blend`.

| Component | Contribution |
|---|---|
| Venue shell, balustrade, bar, chandelier | 21,812 |
| Nine dining chairs | 6,840 |
| Nine dressed characters | ~108,000 |
| Chip stacks and board | ~14,000 |
| **Total** | **150,902 / 250,000** |

**40% headroom with everything visible.** The revised 15,000-per-character budget holds under a real full table, which is the first time that number has been tested against nine of them rather than extrapolated from one.

### Character variation is per-instance material, not per-mesh

Nine seats share one mesh, one rig and one animation set. Variation comes from copying the material datablock per instance and retinting skin, garment and hat. Nine visibly different people from one asset.

That is also where the material count comes from — 91 materials in this scene, well past the budget of 24. **The production path is one shared atlas with per-instance colour driven by a vertex attribute or instance property, not 91 material datablocks.** Recorded here because the lookdev approach is the obvious thing to copy and it is the wrong thing to copy.

### Chip stack magnitude reads

Stacks were generated at deliberately different depths per seat — 4, 6, 9, 13 and 18 chips. At the play camera the difference in stack height is legible without any number being readable, which is exactly what the behaviour reference requires and what an earlier finding wrongly dismissed as decorative.

### Object count remains the real problem

684 objects against a 120 draw-call ceiling. Chips are again the bulk. Instancing is not an optimisation here, it is a requirement, and it applies before any production venue work.

### Known gaps in this frame

Garment collar and sleeve boundaries still jagged. Faces are untextured. Chairs slightly oversized relative to the characters. No dealer, no dealer button, no bet piles in front of seats.

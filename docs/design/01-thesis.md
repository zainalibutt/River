# 01 — Visual thesis

## The one idea

**The room is dark. The felt is lit. The interface is furniture.**

River is a poker room photographed, not a poker app designed. A single warm practical light hangs over the table; everything falls off into charcoal-green shadow at the edges of the screen. Chips, cards and the rail catch that light. Interface elements do not float above the scene as a HUD — they sit on the rail, in the light, made of the same materials as the table.

Every later decision in this contract resolves back to that sentence. When a choice is unclear, ask which option looks more like a photograph of a real table under one warm lamp, and take that one.

This also carries the 2D renderer forward into 3D without redesign. The 2D mode is the same room with the camera locked and the geometry flattened, not a different product. See `03-layout.md`.

## Inherited from the reference

- **Venue identity over casino identity.** The place has a character. Rooftop bar, underground basement and high-end suite are different rooms, not different colour themes over the same table.
- **Lived-in materials.** Worn leather rail, scuffed wood, felt with visible nap. Surfaces have history.
- **Warm practical lighting.** Light comes from fixtures that exist in the room, not from a uniform ambient wash.
- **Dramatic moments get real weight.** An all-in is an event that changes the frame, not a toast notification.

## Inherited from Blackjackist

- **Pace, and zero friction between hands.** The gap between one hand ending and the next beginning is a designed 3-second beat, not dead air.
- **Instant legibility of money.** Stack, pot and bet are always readable without hunting. Chips are denominated by colour and readable at a glance.
- **Generous, unambiguous action targets.** The thing you press is large, obvious and never adjacent to something destructive.
- **Immediate recovery.** Bust, rebuy, back in. No modal chain, no ceremony.

## Refused, deliberately

| Refused | Reason |
|---|---|
| the reference's grime-as-texture overload — heavy noise, grunge overlays, filth on every surface | Wrecks 10-foot legibility and dates instantly. River is dim and warm, not dirty |
| Any the reference branding, character likeness, logo, typeface or venue name | Mechanics are not protectable; identity is. River ships its own room |
| Blackjackist's social-casino surface — gold gradients, neon rims, glow bursts, slot-machine celebration | Reads as monetised. River has nothing to sell and should not look like it does |
| Any buy-chips affordance, price, currency symbol, timer-pressure upsell or "top up" merchandising | Spec pillar 5. Chips are unpurchasable. No surface may imply otherwise, even decoratively |
| Pure black `#000` and pure white `#FFF` | Both read as flat and harsh on OLED TVs at distance. River's darkest is a green-black, its lightest a warm cream |
| Colour as the only carrier of meaning | Controller-first, TV-first, and colour-blind-safe all demand a second channel. See `02-tokens.md` |

## What makes River distinct

1. **One lamp.** A single warm pool of light centred on the felt, falling off to the frame edge. No other product in this space lights the table this way; most light everything evenly.
2. **The rail is the UI.** Action controls sit on a leather rail at the bottom of the frame, in the same material language as the table. They are not a floating panel.
3. **Money is typographic, not decorative.** Amounts are set in tabular figures at a size that reads across a room. No embossed numerals, no coin icons stacked into the numbers.
4. **Trust is visible but quiet.** The fairness commit hash is on screen every hand as a small verify affordance, never a badge that shouts. Trust shown by being available, not by being advertised.

## Approved product decisions

Zain approved all four decisions on 2026-08-23. The alternatives remain documented so later usability testing can distinguish an intentional change from drift.

### Decision 1 — Deck colour system

- **A. Two-colour (traditional).** Red hearts and diamonds, black clubs and spades. Authentic, what a real table looks like.
- **B. Four-colour.** Red hearts, blue diamonds, green clubs, black spades. Suits are distinguishable at a glance and at distance.

At 10 feet on a 55-inch panel, distinguishing a heart from a diamond is genuinely hard, and misreading your own flush draw is the worst possible failure. Four-colour solves it outright. Two-colour is what poker looks like.

**Decision: B, four-colour, with A available as a setting.** Tokens for both are in `02-tokens.md`.

### Decision 2 — Chip amount formatting

Default buy-in is 100,000 and the big blind is 500, so six-digit numbers appear constantly.

- **A. Exact.** `100,000` / `2,500` / `87,250`. Precise, feels like real money, wide.
- **B. Abbreviated.** `100K` / `2.5K` / `87.3K`. Compact and instantly scannable, loses precision.
- **C. Hybrid.** Abbreviated on opponent seats, exact on your own stack, the pot and the action rail.

**Decision: C.** You always know your own number exactly; opponents are read at a glance.

### Decision 3 — Bot pacing

The engine resolves every bot turn instantly (see `08-handoff-2c.md`, gap 3), so the renderer owns the entire feel of pace. Q2 established that reaction delays are presentation configuration, not strategy.

- **A. Snappy.** 350-700ms per bot action. Blackjackist-fast, hands fly by.
- **B. Considered.** 600-1400ms, weighted by decision difficulty and skill tier.
- **C. Theatrical.** 900-2200ms, OG pauses longest before big decisions.

**Decision: B**, with per-tier ranges in `07-motion.md`. This remains the single largest tuning lever on how the game feels and should be refined by playing.

### Decision 4 — Display typeface direction

UI text is a neutral, tabular-figure grotesque either way. The question is the display face used for the River wordmark, venue names and hand results.

- **A. Warm editorial serif** (Fraunces, Instrument Serif). Cinematic, filmic titles, reads as a film about a poker room.
- **B. Condensed signage sans** (Oswald, Archivo Narrow). Dive-bar signage, painted-on-glass, closer to the reference.

**Decision: A.** It supports "cinematic rather than casino-neon" more directly and differentiates River from competitors that use condensed sans.

## Non-forks

These follow from the spec and are not open:

- Dark charcoal-green room, deep green felt, warm cream type, restrained amber and copper accents. Confirmed direction.
- No real-money surface of any kind.
- TV and controller are first-class; phone is secondary.
- 2D is permanent, not scaffolding, and must stand on its own as a finished mode.

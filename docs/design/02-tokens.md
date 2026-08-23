# 02 — Tokens

Every value here is final and implementable. In 2C these become CSS custom properties in one file. No component may carry a raw hex, a raw pixel font size, or a raw duration.

All contrast ratios below were computed against the actual token values, not estimated. Targets: **4.5:1 minimum for any text**, **7:1 for anything the player must read under pressure** (own stack, pot, action labels, timer). TV viewing at distance is treated as more demanding than WCAG desktop minimums, not less.

## Colour — room

| Token | Value | Use |
|---|---|---|
| `--river-void` | `#0A0D0C` | Page ground behind everything, vignette floor |
| `--river-room` | `#131916` | Room walls, default surface outside the felt |
| `--river-room-raised` | `#1B2320` | Panels, menus, seat plates, modal bodies |
| `--river-room-edge` | `#2A342F` | Hairline borders, dividers, inactive outlines |

## Colour — table

| Token | Value | Use |
|---|---|---|
| `--river-felt` | `#1C4232` | Felt base |
| `--river-felt-lit` | `#2A5B45` | Centre of the lamp pool, radial-gradient inner stop |
| `--river-felt-shadow` | `#122C21` | Felt at the rail edge, radial-gradient outer stop |
| `--river-rail` | `#3B2A1F` | Leather rail, action bar substrate |
| `--river-rail-hi` | `#55402F` | Rail top highlight, 1px, sells the material |

Felt is a radial gradient, not a flat fill: `radial-gradient(ellipse 62% 74% at 50% 46%, var(--river-felt-lit) 0%, var(--river-felt) 52%, var(--river-felt-shadow) 100%)`. That single gradient is the "one lamp" from `01-thesis.md`.

## Colour — type

| Token | Value | On room | On felt | Use |
|---|---|---|---|---|
| `--river-cream` | `#F2EADF` | 14.95:1 | 9.39:1 | Primary text, amounts, action labels |
| `--river-cream-dim` | `#C3B9AC` | 9.21:1 | 5.79:1 | Secondary text, seat names, meta |
| `--river-cream-faint` | `#8A8177` | 4.66:1 | — | Disabled labels, folded seats. Never on felt, never load-bearing |

## Colour — accent and semantic

| Token | Value | On room | On felt | On rail | Use |
|---|---|---|---|---|---|
| `--river-amber` | `#E8A93C` | 8.63:1 | 5.43:1 | 6.62:1 | Turn emphasis, dealer button, focus ring, all-in |
| `--river-amber-bright` | `#FFC96B` | — | — | — | Focus ring inner stroke, all-in vignette only. Not a text colour |
| `--river-copper` | `#B87333` | 4.70:1 | — | — | Chip rims, rail stitching, verify affordance |
| `--river-win` | `#6FBF8B` | 8.06:1 | 5.07:1 | — | Winning seat, pot award, positive delta |
| `--river-danger` | `#E67D63` | 6.35:1 | — | 4.87:1 | Fold, destructive confirm, invalid-action message |
| `--river-danger-deep` | `#C4553D` | — | — | — | Fills and borders only. Never text |

**Colour is never the only signal.** Every semantic colour is paired with a second channel: winning seats also get a ring and a raised elevation, folded seats also get 40% opacity and greyed cards, the active seat also gets a ring and a scale change, invalid actions also get a shake and an icon. See `05-states.md`.

## Colour — cards

| Token | Value | Contrast on face | Use |
|---|---|---|---|
| `--river-card-face` | `#F7F3EC` | — | Card face, warm white not pure white |
| `--river-card-back` | `#5A2733` | — | Card back base, deep oxblood |
| `--river-card-back-pattern` | `#7A3A46` | — | Card back guilloche pattern |
| `--river-card-edge` | `#D9D2C6` | — | 1px card border, stops faces merging on light backgrounds |
| `--river-card-muted` | `#9A9488` | — | Folded or mucked card face desaturation overlay |

### Suits, four-colour (approved, Decision 1B)

| Suit | Token | Value | Contrast on face |
|---|---|---|---|
| Spades | `--river-suit-spade` | `#1A1A1A` | 15.74:1 |
| Hearts | `--river-suit-heart` | `#C4362A` | 4.86:1 |
| Diamonds | `--river-suit-diamond` | `#2A64A0` | 5.54:1 |
| Clubs | `--river-suit-club` | `#1C6B3E` | 5.89:1 |

### Suits, two-colour (Decision 1A alternative, ship as a setting)

Spades and clubs `#1A1A1A`. Hearts and diamonds `#C4362A`. Same tokens, remapped. 2C implements this as a single token remap on a root class, not as a component branch.

## Colour — chips

Six denominations cover the 250/500 stake and the 50,000-200,000 buy-in range. Chip colour is a second channel to the printed value, never a replacement.

| Denomination | Token | Face | Rim |
|---|---|---|---|
| 100 | `--river-chip-100` | `#E8E2D6` | `#B9B2A4` |
| 500 | `--river-chip-500` | `#B03A32` | `#7C2822` |
| 1,000 | `--river-chip-1k` | `#2A5C8F` | `#1C3F63` |
| 5,000 | `--river-chip-5k` | `#2C7A50` | `#1C5236` |
| 25,000 | `--river-chip-25k` | `#22262B` | `#0E1114` |
| 100,000 | `--river-chip-100k` | `#8A5A2B` | `#5E3C1B` |

## Typography

### Faces

| Role | Face | Fallback stack |
|---|---|---|
| UI and all numerals | Inter | `Inter, "Segoe UI", system-ui, sans-serif` |
| Display (wordmark, venue name, hand result) | Fraunces (approved Decision 4A) | `Fraunces, Georgia, "Times New Roman", serif` |

**Tabular figures are mandatory** on every amount: `font-variant-numeric: tabular-nums`. Non-tabular figures make a counting-up stack jitter horizontally, which is the single most common way money animation looks cheap.

### Scale, authored at the 1920x1080 base canvas

| Token | Size | Line height | Weight | Use |
|---|---|---|---|---|
| `--fs-micro` | 20px | 28px | 500 | Meta only. Never load-bearing, never an amount |
| `--fs-body` | 26px | 36px | 400 | Seat names, status line, chat |
| `--fs-label` | 30px | 38px | 600 | Action button labels, menu items |
| `--fs-amount` | 38px | 44px | 600 | Seat stacks, bet amounts, call cost |
| `--fs-hero` | 52px | 60px | 700 | Pot total, your own stack |
| `--fs-display` | 72px | 80px | 700 | Hand result, all-in callout, countdown numeral |

**Nothing below 20px exists in this design.** At 10 feet on a 55-inch 1080p panel, 20px is roughly the practical floor and is reserved for text the player never needs to read.

### Letter spacing

| Context | Value |
|---|---|
| Display sizes (52px and up) | `-0.02em` |
| Body and labels | `0` |
| All-caps micro labels | `0.08em` |

## Spacing

8px base unit at the base canvas. Only these values exist.

| Token | Value |
|---|---|
| `--sp-1` | 4px |
| `--sp-2` | 8px |
| `--sp-3` | 12px |
| `--sp-4` | 16px |
| `--sp-5` | 24px |
| `--sp-6` | 32px |
| `--sp-7` | 48px |
| `--sp-8` | 64px |
| `--sp-9` | 96px |
| `--sp-10` | 128px |

## Radii

| Token | Value | Use |
|---|---|---|
| `--r-card` | 12px | Playing cards |
| `--r-chip` | 50% | Chips, dealer button |
| `--r-button` | 10px | Action buttons |
| `--r-panel` | 16px | Seat plates, menus, modals |
| `--r-pill` | 999px | Bet presets, status pill, verify affordance |
| `--r-rail` | 24px | Rail top edge |

## Borders

| Token | Value | Use |
|---|---|---|
| `--bd-hairline` | `1px solid var(--river-room-edge)` | Default separation |
| `--bd-card` | `1px solid var(--river-card-edge)` | Card outline |
| `--bd-active` | `4px solid var(--river-amber)` | Seat whose turn it is |
| `--bd-win` | `4px solid var(--river-win)` | Winning seat at showdown |
| `--bd-focus` | `3px solid var(--river-amber-bright)` | Focus ring inner stroke |

## Elevation

The room is dark, so elevation is carried by **light and hairlines**, not by shadow alone. A shadow on a near-black surface is invisible; a 1px lit top edge is not.

| Token | Definition | Use |
|---|---|---|
| `--e0` | none | Felt, flat surfaces |
| `--e1` | `inset 0 1px 0 rgba(255,255,255,0.06)`, background `--river-room-raised` | Seat plates, inline panels |
| `--e2` | `0 8px 24px rgba(0,0,0,0.50)`, plus `--e1` inset | Action rail, floating chips, dealer button |
| `--e3` | `0 24px 64px rgba(0,0,0,0.65)`, plus backdrop `rgba(10,13,12,0.72)` | Modals, menu overlay, confirmation |

## Materials

Materials are gradient and texture recipes, not images. No raster texture ships in 2D mode.

| Material | Recipe |
|---|---|
| Felt | Radial gradient above, plus a 2% opacity 3px-period noise via repeating `conic-gradient` or a CSS-generated SVG turbulence at 0.02 alpha. Optional, must degrade to flat gradient |
| Leather rail | `linear-gradient(180deg, var(--river-rail-hi) 0px, var(--river-rail) 3px, #2E2018 100%)` with a 1px `--river-copper` stitch line inset 6px |
| Chip | Radial gradient face, 6px rim ring in the rim token, 8 evenly-spaced 12%-opacity cream edge notches |
| Card face | Flat `--river-card-face` with `--bd-card`, plus `--e2` when in motion |
| Lamp glow | `radial-gradient(circle 40% at 50% 30%, rgba(232,169,60,0.10), transparent 70%)` above the felt, behind all content |

## Focus treatment

Focus must be visible on felt, on rail, on raised panels, and on card faces. One ring will not do that, so the ring is **two-stroke**:

```
outline: 3px solid var(--river-amber-bright);
outline-offset: 3px;
box-shadow: 0 0 0 7px rgba(10,13,12,0.85);
```

The dark halo guarantees separation from any bright substrate; the amber guarantees separation from any dark one. Focus is **never** communicated by colour change alone, and never removed. `:focus-visible` is not sufficient on its own here — controller navigation must always show focus, so 2C drives an explicit input-mode class rather than relying on the browser heuristic.

## Motion tokens

Durations and easings are declared here and used in `07-motion.md`. All belong in configuration.

| Token | Value |
|---|---|
| `--ease-out` | `cubic-bezier(0.22, 0.61, 0.36, 1)` |
| `--ease-in-out` | `cubic-bezier(0.65, 0.05, 0.36, 1)` |
| `--ease-settle` | `cubic-bezier(0.34, 1.26, 0.64, 1)` |
| `--d-instant` | 120ms |
| `--d-quick` | 180ms |
| `--d-base` | 220ms |
| `--d-move` | 320ms |
| `--d-award` | 480ms |
| `--d-drama` | 600ms |

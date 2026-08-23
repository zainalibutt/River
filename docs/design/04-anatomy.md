# 04 — Component anatomy

All dimensions are base-canvas pixels (`03-layout.md`). Every element listed here maps to a field on `SoloTableView`, `ViewSeat` or `LegalActions`; the mapping column names the exact source. Nothing renders from data the engine does not expose.

## Money formatting

One formatter, used everywhere. Decision 2C from `01-thesis.md` is approved.

| Context | Format | Example |
|---|---|---|
| Your own stack | Exact, grouped | `87,250` |
| Pot total | Exact, grouped | `12,500` |
| Call cost, raise-to, all-in amount on the rail | Exact, grouped | `4,000` |
| Opponent stack | Abbreviated | `87.3K` |
| Opponent bet chips | Abbreviated | `2.5K` |
| Side-pot breakdown | Exact, grouped | `6,250` |

Abbreviation rule: below 10,000 show exact; 10,000 and above show one decimal and `K`; 1,000,000 and above show one decimal and `M`. Trailing `.0` is dropped. Tabular figures always. Never a currency symbol — River has no currency.

## Card

Ratio 1:1.4 throughout, matching a real playing card.

| Variant | Size | Use | Source |
|---|---|---|---|
| Community | 96x134 | Board cards | `view.board` |
| Hero hole | 120x168 | Your two cards | `seat.hole` where `isBot === false` |
| Opponent hole | 64x90 | Opponent cards, back or revealed | `seat.hole`, `seat.hasHole` |
| Well | matching size, 40% opacity outline | Undealt board slots | absence in `view.board` |

Face anatomy at community size: rank glyph top-left at `--fs-amount` in the suit colour, pip below it at 28px, large centre pip at 56px. Corner rank repeated bottom-right, rotated 180 degrees. Radius `--r-card`, border `--bd-card`.

**Back versus unknown.** `seat.hole === null` means *this client is not permitted to know*. `seat.hasHole === true` means cards exist. The two combine:

| `hasHole` | `hole` | Render |
|---|---|---|
| `true` | `null` | Two card backs |
| `true` | `Card[]` | Two faces |
| `false` | `null` | Nothing. Not wells, not backs |

Rendering a back when `hasHole` is false invents a hand that does not exist. Rendering anything derived from `hole` when it is `null` is an information leak and a hard defect.

## Seat plate

Fixed 132px height in every state (`03-layout.md`, reserved dimensions).

| Variant | Width | Use |
|---|---|---|
| Standard | 344px | Positions 0, 1, 3, 4, 5, 6, 8 |
| Narrow | 300px | Positions 2 and 7, to hold title-safe margin |
| Wide | 400px | Heads-up opponent only |

Contents, left to right:

| Element | Size | Source |
|---|---|---|
| Avatar well | 84x84, `--r-panel` | none in Phase 2 — renders initial from `seat.name` |
| Name | `--fs-body`, `--river-cream-dim`, truncate at 16 chars | `seat.name` |
| Stack | `--fs-amount`, `--river-cream`, tabular | `seat.stack` |
| Skill tag | `--fs-micro`, all-caps, `0.08em`, `--river-cream-faint` | derived from `seat.isBot` and session config |
| Timer housing | 64x64, reserved and inert in Phase 2 | see `08-handoff-2c.md` gap 1 |

Plate surface is `--e1`. The active seat gets `--bd-active` plus a 1.04 scale; see `05-states.md` for the full state table.

### Seat bet chips

Chips wagered this street sit **between the seat plate and the felt centre**, offset 96px along the line from the seat toward the table centre. Stack renders as up to five chips with a 6px vertical offset each, plus the amount label at `--fs-body` beneath.

Source: `seat.betStreet`. When `betStreet` is 0 no chips render. `seat.betHand` is not rendered directly — it feeds the pot, and showing both double-counts visually.

## Community board

Five card slots at 96x134 with `--sp-4` gutters, centred in the board row, total 600px. Undealt slots render as wells.

Street label sits above at `--fs-micro`, all-caps, `--river-cream-faint`, sourced from `view.street`. It is meta, not load-bearing — the cards themselves communicate the street.

## Pot

| Element | Treatment | Source |
|---|---|---|
| Total | `--fs-hero`, `--river-cream`, tabular, centred | `view.pot` |
| Label | `POT` at `--fs-micro`, all-caps, above the total | static |
| Chips | Up to 5 denominational chips beneath, decorative | derived from `view.pot` |
| Side pots | Stacked rows beneath, `--fs-amount`, `--river-cream-dim`, labelled `MAIN` / `SIDE 1` / `SIDE 2` | derived at showdown from `SessionStep` of kind `showdown` |

The pot readout never collapses. At `view.pot === 0` it renders `0`.

## Dealer button

56px disc, `--r-chip`, `--river-cream` face, `--river-copper` rim, letter `D` at `--fs-label` in `--river-rail`. Positioned 72px from the seat plate along the line toward table centre, offset 40 degrees clockwise so it never collides with the bet chips.

Source: `seat.dealer`. Exactly one seat carries it. It animates to the next seat on `handStarted` (`07-motion.md`).

## Action rail

Full-bleed 1920x164 at y=916, leather material, contents inside title-safe (96..1824).

### Buttons

Three primary actions, each 260x88, `--r-button`, `--fs-label`, `--e2`, with `--sp-4` gutters, right-aligned ending at x=1824.

| Button | Label | Enabled by | Colour |
|---|---|---|---|
| Fold | `FOLD` | `legal.fold.enabled` | `--river-danger` text on rail, `--river-danger-deep` 2px border |
| Check / Call | `CHECK` or `CALL 4,000` | `legal.check.enabled` or `legal.call.enabled` | `--river-cream` text, `--river-room-edge` border |
| Raise | `RAISE TO 8,000` | `legal.raiseTo.enabled` | `--river-cream` text, `--river-amber` 2px border |

Check and Call share one slot and never both appear — `legal.check.enabled` and `legal.call.enabled` are mutually exclusive by construction in `legalFor`. The label carries the cost so the player never computes it.

All-in is a fourth control, 196x88, placed left of the group with `--sp-6` separation so it cannot be hit by accident. The full action group occupies x=784..1824 and does not overlap bet sizing. Label `ALL IN 87,250`, `--river-amber` text, `--river-amber` 2px border. Enabled by `legal.allIn.enabled`. **Hold to confirm** — see `06-interaction.md`.

Disabled buttons stay in place at 40% opacity with `--river-cream-faint` text. They are never removed, so the rail never reflows and muscle memory holds.

### Bet sizing

Occupies 96..720 on the rail, with 64px of clearance before the all-in control.

| Element | Spec | Source |
|---|---|---|
| Slider track | 624x12, `--r-pill`, `--river-room-edge` | range `legal.raiseTo.min` to `legal.allIn.amount` |
| Slider fill | `--river-amber` | current value |
| Slider handle | 44x44 disc, `--e2`, `--river-cream` | current value |
| Value readout | `--fs-hero`, tabular, above the track | current value |
| Presets | Four pills, 144x48, `--r-pill`, `--fs-body`, with 16px gutters | computed |

Preset values: `MIN` (`legal.raiseTo.min`), `1/2 POT`, `POT`, `MAX` (`legal.allIn.amount`). Pot-relative presets are computed from `view.pot` and clamped into the legal range; a preset that clamps to an existing value is disabled rather than duplicated.

**The slider expresses raise-to totals, not increments.** `legal.raiseTo.min` is a total, and `BettingHand.raiseTo` takes a total. Labelling this control as an increment would produce illegal actions at the boundary. The readout reads `RAISE TO 8,000`.

Sizing controls are hidden — not disabled — when `legal.raiseTo.enabled` is false, and the space is reserved so the rail does not reflow.

## Status line

800x56 centred at y=644, directly beneath the board. `--fs-body`, centred, `--r-pill` background at `--river-room-raised` with 70% alpha when populated, fully transparent when empty.

Source: `view.message` and the `message` returned by `ActResult`. Severity is derived, not read from a field — see `08-handoff-2c.md` gap 2:

| Origin | Treatment |
|---|---|
| `ActResult.ok === false` | `--river-danger` text, warning glyph, shake (`07-motion.md`) |
| `SessionStep` of kind `notice` | `--river-cream-dim` text, no glyph |
| Hand outcome (`uncontested`, `showdown`) | `--river-cream` text, `--river-win` when the hero wins |

## Verify affordance

320x64 pill at top-right of title-safe. Contents: `--fs-micro` all-caps label `VERIFY`, then the first 8 characters of `view.commit` in tabular figures at `--fs-body`, `--river-copper`.

Activating it opens a panel showing the full commit hash, and after `view.revealed` becomes true, the revealed seed and a recomputed-hash match indicator. Before reveal the panel explains that the deck was committed before the deal and can be checked after the hand.

When `view.commit` is null the pill renders at 40% opacity with the label only. This is quiet by design (`01-thesis.md`) — it is proof available on demand, not a trust advertisement.

## Menu cluster

320x64 at top-left of title-safe. Three icon buttons at 64x64 with `--sp-4` gutters: TV Mode, settings, leave table. Labels appear on focus at `--fs-micro` beneath. All three are in the focus ring (`06-interaction.md`).

## Hero block

600x120 at y=796, above the rail. This is the reserved bounding region for the hero cards and the position-0 seat plate together, not a second plate: the plate straddles the rail edge while the two 120x168 hole cards overlap the block upward by 48px. Cards are always face-up when `hole` is non-null. There is no peek interaction in 2D — the peek is a 3D body animation per `docs/spec.md`, and hiding your own cards behind an interaction on a couch-play product adds friction with no benefit.

## Between-hands countdown

Rendered in the status line region as a 64px ring with the remaining whole seconds at `--fs-display` in the centre, plus label `NEXT HAND`.

Source: `view.countdownMs`, which the session computes from its injected clock. The renderer displays it and **must not run its own timer** — the engine owns the clock, and a second clock will drift.

At `countdownMs === 0` with `phase === 'between'`, the ring completes and the deal begins. A `DEAL NOW` action is available on the rail during this window, occupying the Check/Call slot.

# 04 — Component anatomy

Rewritten 2026-08-24 against `docs/behaviour-reference.md`. The previous version specified a horizontal action rail with a linear slider — the reference calls that the defining mistake of the genre. The action surface is now radial, and several components split across world-space and HUD.

Dimensions are base-canvas pixels for HUD elements and metres for world-space elements. Every element names its data source; nothing renders from data the engine does not expose.

## The world / HUD split

The reference is explicit that the reference uses **both** world-space and 2D HUD information, and that neither replaces the other.

| Layer | Contents |
|---|---|
| **World** | Table, chips, community cards, card backs, dealer button, avatars, avatar gestures, opponent turn timers, bet piles, table items, venue |
| **HUD** | Local hole cards, community-card mirror, RAM, betting dial, local urgency ring, stacks, pot total, bet labels, nameplates on focus, REP, muck selector, menus, chat |

The rule: **anything the player must read under time pressure lives in the HUD; anything that makes the room feel real lives in the world.** Several things appear in both by design.

## Money formatting

One formatter everywhere.

| Context | Format | Example |
|---|---|---|
| Your own stack | Exact, grouped | `87,250` |
| Pot total | Exact, grouped | `12,500` |
| RAM action labels and betting dial | Exact, grouped | `4,000` |
| Opponent stack | Abbreviated | `87.3K` |
| Bet bubbles | Abbreviated above 10,000 | `2.5K` |
| Side-pot breakdown | Exact, grouped | `6,250` |

Below 10,000 exact; 10,000+ one decimal and `K`; 1,000,000+ one decimal and `M`. Trailing `.0` dropped. Tabular figures always. Never a currency symbol.

## Cards

### Local hole cards — HUD only

Confirmed by Zain: in the reference you cannot peek under a card in the world. The HUD hand is authoritative and the world cards are backs.

| Property | Value |
|---|---|
| Location | Local player area, lower frame — never centre table |
| Size | 168 x 235 base-canvas pixels |
| Faces | Four-colour deck, rank-dominant |
| Privacy | Never transmitted to other clients |
| Peek | Held input emphasises them and drives the avatar animation (`06-interaction.md`) |

**Deal synchronisation is required.** The HUD slot reveals its card on the world card's landing marker, per card. Never populate the whole hand in HUD before the world deal finishes.

### Community cards — world and HUD

Both, deliberately. The felt is visually authoritative; the HUD mirror provides readability from oblique orbit angles.

| Layer | Treatment |
|---|---|
| World | Five card positions on the felt, face-up as dealt. Readable geometry, no cheat scale needed since the HUD carries the reading |
| HUD mirror | Compact strip near the local player area, always readable regardless of camera |

Stale-board prevention is explicit in the reference: a new hand must force an empty hole-card and board state in both layers.

### Card backs

`hasHole` true with `hole` null renders two backs. `hasHole` false renders nothing — not wells, not backs. Rendering a back where no hand exists invents a hand; rendering anything derived from a null `hole` is an information leak and a hard defect.

## Physical chip stacks

**Correction to an earlier finding.** A previous study concluded chips were "decorative volume only" because denominations are unreadable at the play camera. That was half right. Denominations are indeed unreadable — but the reference is explicit that **stack height must track stack magnitude at a glance**.

```ts
renderedChipStack = quantizeChipVisuals(tableStack)
```

| Rule | Detail |
|---|---|
| A rich stack visibly larger than a short stack | Required |
| One mesh per literal chip | **Not** required — use denomination stacks and pooled instances |
| Denomination colours readable | Not required, and not achievable at the play camera |
| Numeric stack value | Carried by the HUD nameplate, never read off the chips |

So chips carry *magnitude*, the HUD carries *value*.

## Bets and pot

Three concepts that must stay visually distinct:

| Concept | Meaning | Representation |
|---|---|---|
| Table stack | Chips still owned | Chip stack at the seat + HUD number |
| Committed bet | Chips forward for this street | Forward bet pile + **bet bubble** label |
| Pot | Aggregated centre total | Centre chip clump + HUD pot readout |

A bet or raise must visibly: decrement the available stack, create or update a forward pile, update the numeric bet label, and later sweep into the pot between streets.

Zain's choreography notes: street bets **glide** into the centre rather than being swept; side pots form as separate but still-clumped groups sized contextually to their amount; on award the pot slides toward the winner with a gathering animation and the numeric stack updates **after** movement.

## Radial Action Menu

The primary action surface. Replaces the action rail entirely.

| Property | Value |
|---|---|
| Position | Anchored to the local player area, lower centre |
| Outer diameter | 420 base-canvas pixels |
| Wedge count | Only currently legal actions |
| Wedge label | Action name plus exact amount — `CALL 4,000`, `RAISE TO 8,000`, `ALL IN 87,250` |
| Centre | Betting dial value readout when raising |
| Urgency ring | Appears around the outer edge at 50% turn remaining |

Wedges render only for legal actions. Check and call never both appear.

### Betting dial

Circular, occupying the RAM interior when a raise is focused. Ranges halve and double for coarse control; fine adjustment steps by one big blind. Value expressed as a raise-to total.

### Preset icons

When an action is preset before your turn, its icon renders in the RAM **slightly transparent and without the enclosing wedge circle** — the reference is specific about this. This state is private to the local client. The public signal is the avatar gesture, not the icon.

## Turn indication

| Owner | Presentation |
|---|---|
| Active opponent | Timer **above their head**, world-space, attached to the seat |
| Local player | RAM actionable immediately, **no countdown**; urgency ring appears at 50% remaining |

There is no single global marker moving between seats. Each active seat owns its own indicator.

## Nameplates

Two levels, so the resting table stays clean.

| State | Contents |
|---|---|
| Resting | Username, stack, and active / blind / dealer status where relevant |
| Focused | Username, nickname, level or rank, affiliation, exact stack, profile affordance |

Detailed metadata appears on selection or focus rather than being permanently plastered over every avatar.

## Muck selection

Offered where the rules allow, at showdown and to river folders.

| Option | Result |
|---|---|
| Show neither | Cards muck unrevealed |
| Show one | Player picks which |
| Show both | Full reveal |

Auto-muck is a persisted setting. **Camera orbit stays enabled throughout muck selection** — the reference calls this out explicitly.

## Dealer presentation

| Venue type | Presentation |
|---|---|
| Casino-style | Dedicated croupier NPC deals |
| Laundromat, bar, rooftop | Players visually take turns dealing; the deck functions as the button |

```ts
type DealerPresentation =
  | { kind: "npc"; actorId: string }
  | { kind: "rotatingPlayer"; seatId: SeatId }
```

The poker engine uses the same button position either way. Only the presentation actor changes.

Deal choreography per Zain: shuffle, burn, one card each, then one more each, tossed in strict seat order with visible flight. The new player-dealer physically picks up the deck at hand start.

## REP presentation

Lightweight and non-blocking. Floating REP text above the meter at end of hand — **never a modal that blocks the next deal.**

REP is separate from bankroll and from ranked rating and must not share state. A displayed `120%` is an **earning-rate modifier**, not level progress; it derives from an inspectable breakdown of base, buy-in scale, table-item bonus, event bonus and challenge bonus.

## Table items

Three simultaneous roles: visual identity beside the avatar, ambient interaction animation, and a REP boost modifier. Purchasable with chips, which serves the chip sink the spec already wanted.

They never affect poker odds. The reference is explicit that drinking and smoking apply no gameplay effect.

## Verify affordance

Commit-hash pill, quiet, top-right of title-safe. Shows the first 8 characters of `view.commit`; opens a panel with the full hash and, after reveal, a recomputed-match indicator.

**Known gap:** `SoloTableView` exposes `commit` but no seed, so full verification is not yet possible from the view. Recorded in `08-handoff-2c.md`.

## Reserved dimensions

Every HUD region has a fixed size that does not change with content. This is the mechanism that makes loading and error states shift-free.

| Region | Reserved | Never |
|---|---|---|
| Pot readout | 88px | Collapses at pot 0 — shows `0` |
| Status line | 56px | Collapses when empty |
| Community HUD mirror | fixed | Collapses pre-flop — shows five wells |
| RAM | 420px | Resizes with legal action count |
| Local hole cards | 168 x 235 each | Collapses between hands |
| Nameplate | fixed | Grows on focus — the detail panel overlays instead |

# 03 — Layout, viewports and geometry

> **Revised 2026-08-24.** The uniform-scale rule, safe areas, seat geometry, minimum viewport and TV Mode below all still hold for the **2D graphics-saver renderer**. They do not describe the 3D presentation: River's 3D camera is a seat-relative orbit under player control, specified in `06-interaction.md`. The region map here describes a 2D composition; the 3D HUD is radial and world-anchored per `04-anatomy.md`.

## Base canvas

**All layout is authored once at 1920x1080 and scaled uniformly.** There are no per-breakpoint table layouts. A poker table is a fixed composition; reflowing it produces a different game, not a responsive one.

```
--canvas-w: 1920;
--canvas-h: 1080;
--scale: min(100vw / 1920, 100vh / 1080);
```

The table stage is a 1920x1080 element with `transform: scale(var(--scale))` and `transform-origin: center`, centred in the viewport. Letterboxing fills with `--river-void`. Every pixel value in this contract and in `04-anatomy.md` is a base-canvas pixel and needs no conversion.

This rule is what keeps 2D and 3D coherent: the 3D renderer later uses the same 16:9 composition and the same safe areas with a camera instead of a transform. The interface does not move when the renderer changes.

## Television safe areas

Consumer televisions overscan. Content at the frame edge can be physically cut off, and this is not detectable from the browser.

| Zone | Inset | Rect at base canvas | Rule |
|---|---|---|---|
| Action-safe | 3.5% | 1786x1004 at (67, 38) | No interactive element may extend outside this |
| Title-safe | 5% | 1728x972 at (96, 54) | No text, amount, or icon may extend outside this |

Decorative material — felt gradient, vignette, lamp glow, rail texture — is expected to bleed to the full 1920x1080 and beyond. Only meaning is constrained.

**Acceptance:** overlay the title-safe rect in development and confirm no glyph crosses it in any state from `05-states.md`.

## Region map

Base-canvas coordinates, origin top-left.

| Region | Rect | Contents |
|---|---|---|
| Table stage | 0,0 1920x1080 | Felt, vignette, lamp |
| Menu cluster | 96,54 320x64 | TV Mode toggle, settings, leave |
| Verify affordance | 1504,54 320x64 | Commit hash pill, verify action |
| Board row | 660,436 600x168 | Community cards and street label |
| Pot readout | 660,330 600x88 | Pot total, side-pot breakdown |
| Status line | 560,644 800x56 | Single-line message from `view.message` |
| Seat ring | see below | Nine seat plates on an ellipse |
| Hero block | 660,796 600x120 | Your hole cards, raised above the rail |
| Action rail | 0,916 1920x164 | Leather rail, action buttons, bet sizing |

The action rail is full-bleed horizontally but its **contents** sit inside title-safe: buttons occupy 96..1824.

## Seat geometry

Seats begin on an ellipse centred at 50%, 50% of the table stage with radii `rx = 42%`, `ry = 34%`. At 9-max, the two horizontal extreme anchors are clamped inward to the title-safe boundary; this is a deliberate optical correction, not a second responsive layout. The hero is always at 6 o'clock regardless of engine seat index — 2C rotates the `view.seats` array so the seat with `isBot === false` renders at position 0. **The engine's seat order is never the render order.**

Positions are percentages of the table stage, giving the seat plate centre.

### 9-max (`nineSeats`, `SEATS_PER_SHAPE.full`)

| Position | Angle | x | y |
|---|---|---|---|
| 0 (hero) | 90 | 57.0% | 78.0% |
| 1 | 130 | 23.0% | 76.0% |
| 2 | 170 | 13.0% | 55.9% |
| 3 | 210 | 13.6% | 33.0% |
| 4 | 250 | 35.6% | 18.1% |
| 5 | 290 | 64.4% | 18.1% |
| 6 | 330 | 86.4% | 33.0% |
| 7 | 10 | 87.0% | 55.9% |
| 8 | 50 | 77.0% | 76.0% |

Positions 2 and 7 use the 300px narrow variant (`04-anatomy.md`). Their outer edges land at x=100 and x=1820, inside the 96..1824 title-safe range. Positions 3 and 6 may let the decorative plate edge enter action-safe, but all glyphs and amounts remain inset inside title-safe.

### 6-max (`SEATS_PER_SHAPE.six`)

| Position | Angle | x | y |
|---|---|---|---|
| 0 (hero) | 90 | 57.0% | 78.0% |
| 1 | 150 | 13.6% | 67.0% |
| 2 | 210 | 13.6% | 33.0% |
| 3 | 270 | 50.0% | 16.0% |
| 4 | 330 | 86.4% | 33.0% |
| 5 | 30 | 86.4% | 67.0% |

### Heads-up (`huSeats`, `SEATS_PER_SHAPE['heads-up']`)

| Position | x | y |
|---|---|---|
| 0 (hero) | 57.0% | 78.0% |
| 1 (opponent) | 50.0% | 16.0% |

Heads-up is the Phase 2 exit shape per Q1, so it is the layout that must be finished first. It gets one refinement the others do not: because only two seats exist, the opponent plate may use the 400px wide variant and show a larger avatar area, since there is no crowding to manage.

## Empty seats

A 9-max table with fewer than nine occupied seats renders empty positions as a **seat well**: a 40%-opacity outline of the plate at `--river-room-edge`, no text, no interaction. Empty seats are never collapsed and never re-flowed — the table shape is constant so muscle memory holds across hands.

## Desktop and laptop fallback

The uniform-scale rule means desktop is the same layout, smaller. No separate composition is authored.

| Viewport | Behaviour |
|---|---|
| 1920x1080 and above | `--scale: 1`, or above 1 on larger panels, capped at 1.5 |
| 1280x720 to 1919x1079 | Uniform downscale, 0.667 to 0.999. All layout intact |
| Below 1280 wide, or aspect narrower than 15:9 | Compact rail variant, see below |
| Below 1024x640 | Unsupported. Render a single centred message: this is a TV and desktop game |

### Approved Q6 answer — minimum supported viewport

**Approved: 1280x720.**

Reasoning, from the type scale rather than from convention: at 1280x720 the scale factor is 0.667, so `--fs-body` renders at 17.3px and `--fs-micro` at 13.3px. 13px is the floor below which a 400-weight grotesque stops being comfortable on a laptop panel, and `--fs-micro` is non-load-bearing by definition, so nothing critical is harmed. One step lower — 1152x648 — puts body text at 15.6px and micro at 12px, which starts failing. 1280x720 is also the smallest 16:9 size that no longer requires a compact rail, which keeps one composition rather than two.

The absolute floor of 1024x640 is a refusal boundary, not a supported size. Phone support is explicitly not inferred from it.

### Compact rail variant

Below 1280 wide the action rail alone changes: bet presets collapse from a row of four pills into a single cycling control, and the bet slider moves above the buttons rather than beside them. The table, seats and board do not change. This is the only permitted layout branch in the entire 2D renderer.

## Layer order

Bottom to top:

1. `--river-void` page ground
2. Felt radial gradient
3. Lamp glow
4. Table edge and rail
5. Empty seat wells
6. Pot and side-pot chips
7. Community cards
8. Seat plates and their chips
9. Hole cards, hero raised
10. Chips in motion
11. Status line
12. Action rail
13. Focus ring (always topmost within its stacking context)
14. Modals and confirmations, with `--e3` backdrop

## TV Mode

TV Mode is a spec-level feature (`docs/spec.md`, Platform and console UX) and is layout-affecting, so it is specified here.

| Aspect | Behaviour |
|---|---|
| Entry | Menu cluster button, or `L3` on controller |
| Effect | Requests fullscreen where granted. Hides menu cluster and verify affordance. Felt, seats, board, hero block and action rail remain |
| Fallback | Where fullscreen is refused, apply the same chrome-hiding as an immersive layout without fullscreen. Never show an error |
| Exit | Hold the same control for 1000ms, with a radial fill indicator. A tap does nothing |
| Why hold | Prevents an accidental controller press dropping a player out of the game mid-hand |

## Reserved dimensions

Every region in the region map has a fixed height that does not change with content. This is not a preference; it is the mechanism that makes loading, empty and error states shift-free.

| Region | Reserved | Never |
|---|---|---|
| Pot readout | 88px | Collapses when pot is 0 — shows `0` |
| Status line | 56px | Collapses when `view.message` is null — renders empty |
| Board row | 168px | Collapses pre-flop — renders five card wells |
| Seat plate | 132px | Changes height between states |
| Action rail | 164px | Changes height when actions are disabled |
| Timer housing | 64x64 per seat | Omitted in Phase 2 — reserved and inert, see `08-handoff-2c.md` |

**Acceptance:** capture a screenshot at every state in `05-states.md` and diff the bounding boxes of all nine regions. Any region whose box changes between states is a defect.

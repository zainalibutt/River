# 06 — Interaction, focus and input

River is controller-first and TV-first. Mouse is supported because browsers have one, not because the design assumes it. Every action must be reachable and confirmable with a DualSense alone, without a pointer.

## Input modes

2C maintains an explicit input-mode class on the root: `input-pad`, `input-key`, `input-pointer`. It switches on first event of a kind.

Focus visibility is **always on** in `input-pad` and `input-key`. It is not delegated to `:focus-visible`, because that heuristic hides focus for programmatic and gamepad-driven movement, which is exactly when a couch player needs it most.

## Focus ring

One linear ring, wrapping at both ends. Order is fixed and does not change with enablement — disabled controls are **skipped for navigation but keep their position**, so the ring never renumbers between hands.

| Index | Target | Skipped when |
|---|---|---|
| 1 | All-in | `legal.allIn.enabled === false` |
| 2 | Fold | `legal.fold.enabled === false` |
| 3 | Check / Call | neither enabled |
| 4 | Raise | `legal.raiseTo.enabled === false` |
| 5 | Bet slider | raise disabled |
| 6 | Preset `MIN` | raise disabled or value clamps to another preset |
| 7 | Preset `1/2 POT` | as above |
| 8 | Preset `POT` | as above |
| 9 | Preset `MAX` | as above |
| 10 | Verify affordance | `view.commit === null` |
| 11 | TV Mode | never |
| 12 | Settings | never |
| 13 | Leave table | never |

**Default focus on entering a turn is index 3** — Check or Call. It is the safest action: check costs nothing, and call is the action a player most often wants. Never default to Fold, and never default to All-in.

When `currentActorId !== 'you'`, focus parks on index 11 and the rail is inert. When the turn arrives, focus moves to index 3 automatically and the ring animates in (`07-motion.md`).

## DualSense map

| Control | Action | Notes |
|---|---|---|
| D-pad left / right | Move focus backward / forward | Wraps |
| Left stick | Same as D-pad, with a 250ms repeat delay | Prevents runaway scrolling |
| Cross | Activate focused control | Primary confirm |
| Circle | Fold | Requires confirm — see below |
| Square | Jump focus to the bet slider | Shortcut, not an action |
| Triangle | All-in | **Hold 600ms** |
| L1 / R1 | Cycle bet presets down / up | Only when raise is legal |
| L2 / R2 | Nudge slider by one big blind | Fine control |
| Options | Open menu | |
| L3 | Toggle TV Mode | **Hold 1000ms to exit** |
| Touchpad | Toggle verify panel | |

Analogue stick input for the bet slider is deliberately absent. Sticks lack the precision for a raise amount and a mis-sized raise is unrecoverable; the slider is driven by D-pad, shoulder buttons and presets only.

## Keyboard map

| Key | Action |
|---|---|
| `Tab` / `Shift+Tab` | Move focus forward / backward |
| Arrow left / right | Adjust the bet slider when focused, otherwise move focus |
| `Enter` / `Space` | Activate focused control |
| `F` | Fold, with confirm |
| `C` | Check or call, whichever is legal |
| `R` | Jump to bet slider |
| `A` | All-in, **hold 600ms** |
| `1` `2` `3` `4` | Bet presets |
| `V` | Verify panel |
| `Esc` | Menu, or close the topmost panel |

Shortcut keys are inert while a text input has focus, which matters once chat lands in Phase 4.

## Hold-to-confirm

Destructive or irreversible actions require a hold, never a second modal. Modals break pace, and pace is a spec pillar.

| Action | Hold | Indicator |
|---|---|---|
| All-in | 600ms | Radial fill sweeping the button border in `--river-amber`, plus the label counting from `ALL IN` to `RELEASE` |
| Fold **when check is legal** | 400ms | Radial fill in `--river-danger` |
| Fold when facing a bet | none — immediate | Folding to a bet is a normal action |
| Exit TV Mode | 1000ms | Radial fill on the TV Mode control |
| Leave table | 600ms | Radial fill, `--river-danger` |

**Folding when you could check for free is always a mistake**, so it is the one ordinary action that gets friction. Folding to a bet is a real decision and gets none — adding friction there would be punishing normal play.

Releasing before the hold completes cancels with a 120ms fill unwind and no action. The hold indicator is also the only place a progress arc appears in the 2D renderer, so it always means "keep holding".

## Pointer

Click targets match the focus ring exactly. Hold-to-confirm applies to pointer press-and-hold identically. Hover raises elevation by one step and is never the only way to discover a control.

No right-click menu, no drag interactions, no double-click. Every pointer interaction has a keyboard and controller equivalent by construction.

## Bet slider behaviour

| Property | Value |
|---|---|
| Range | `legal.raiseTo.min` to `legal.allIn.amount` |
| Step | one big blind, from stake config |
| Fine step | `L2` / `R2`, one big blind |
| Coarse step | D-pad, one tenth of the range, rounded to a big blind |
| Initial value | `legal.raiseTo.min` |
| Readout | `RAISE TO 8,000`, exact, tabular |

The value is a **raise-to total**, matching `BettingHand.raiseTo`. Never labelled or computed as an increment (`04-anatomy.md`).

When the slider reaches `legal.allIn.amount` the Raise button relabels to `ALL IN` and adopts the 600ms hold. A player sliding to maximum is committing everything and gets the same protection as pressing the dedicated control.

## Accessibility floor

| Requirement | Rule |
|---|---|
| Colour independence | Every state has a non-colour channel (`05-states.md`) |
| Contrast | 4.5:1 minimum, 7:1 for pressure-critical text (`02-tokens.md`) |
| Focus visibility | Always visible in pad and key modes, two-stroke ring |
| Target size | No interactive target below 56x56 base-canvas pixels |
| Motion | Full reduced-motion path (`07-motion.md`) |
| Timing | Reduced motion never changes game pace |
| Screen reader | Live region on the status line, `polite`. Seat stacks and pot are labelled but not announced on every change |

Screen reader support is a floor, not a feature target, for a couch poker game. The live region on the status line plus labelled controls is the commitment for Phase 2.

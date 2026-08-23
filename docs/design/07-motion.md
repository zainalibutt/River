# 07 — Motion grammar

Motion in River exists to make money movement legible and to give big moments weight. It never exists to decorate a transition. If an animation does not answer "whose chips moved where" or "this hand just mattered", it should not ship.

All durations and easings reference tokens from `02-tokens.md` and belong in configuration, not in component bodies.

## Step-log playback — the central mechanism

`SoloSession.act()` and `startHand()` resolve **every** bot turn synchronously before returning. A single hero call can return:

```
action > board > action > board > action > board > action > showdown > bust > between
```

That is an entire hand in one array, delivered in under a millisecond. The renderer therefore owns all pacing: 2C maintains a **step queue** and plays `SessionStep[]` back on a timeline, holding a projection-safe presentation state at each intermediate step.

This is not an implementation detail — it is the reason the game will feel like anything at all. The rules:

1. Steps enter a FIFO queue. The rendered table state is derived from the queue position, never directly from the freshest `view()`.
2. A new `act()` result appends. It never flushes the queue.
3. Player input is accepted only when the queue is empty and `legal` is non-null. The rail is inert while the queue drains.
4. A `SKIP` affordance appears on the rail if the queue has held input for more than 4 seconds, draining the remainder at 4x. This is the pressure valve for a long multi-way all-in run-out.

### Presentation reducer contract

Before calling `start()` or `act()`, capture the current `SoloTableView`; after the call, capture the returned steps and fresh view. Initialise a presentation copy from the before-view and reduce the steps into it. This reducer is visual bookkeeping, not a second rules engine:

| Step | Presentation update |
|---|---|
| `handStarted` | Set hand number, dealer and commit from the step; introduce dealt-card backs and the hero faces from the fresh after-view |
| `blind` | Subtract `amount` from that seat's displayed stack, add it to `betStreet`/`betHand`, and increase the displayed pot total |
| `action: fold/check` | Mark folded, or leave amounts unchanged |
| `action: call` | Move `min(stack, currentBet - betStreet)` from displayed stack to the street bet and pot |
| `action: raiseTo` | Move `decision.to - betStreet`, then set displayed `currentBet` to `decision.to` |
| `action: allIn` | Move the displayed stack, set it to zero, and mark all-in |
| `board` | Sweep decorative street chips to the centre, reset displayed street bets/current bet, and append `cards` |
| `uncontested` / `showdown` | Award from the step payload, never from the already-zero fresh-view pot |
| `bust` / `between` / `notice` / `await` | Apply the named state or legal payload without inventing amounts |

The numeric pot readout includes current-street bets, matching `view.pot`; the decorative centre chip stack represents only swept bets while current street chips remain at their seat lines. When the queue drains, reconcile the presentation copy to the fresh after-view. Fixture tests must assert stack, pot, bet, board, folded/all-in and award equality at reconciliation. A mismatch is a reducer defect and snaps only in development; production must not silently animate invented money.

### Per-step dwell times

| Step | Dwell | Notes |
|---|---|---|
| `handStarted` | 400ms | Dealer button travel |
| `blind` | 180ms each | Chips slide in |
| `action` (bot) | Decision 3 range | See bot pacing below |
| `action` (hero) | 0ms | Already acknowledged by the press |
| `board` | 520ms flop, 340ms turn and river | Card deal plus a beat to read it |
| `await` | 0ms | Hands control back |
| `uncontested` | 900ms | Pot travels |
| `showdown` | 1400ms | Reveal, then award |
| `bust` | 700ms | Seat dims |
| `between` | 0ms | Countdown owns the timing from here |
| `notice` | 900ms | |

### Bot pacing — approved Decision 3

Working default is B, considered. Values are per bot action, sampled uniformly in range.

| Tier | Range | Rationale |
|---|---|---|
| Rookie | 400-800ms | Acts fast because it is not thinking hard |
| Novice | 600-1200ms | |
| OG | 800-1600ms, plus 600ms when the decision is a raise or all-in | The pause before aggression is the tell that makes OG feel like a person |

Fold decisions subtract 200ms across all tiers — folding is quick in life and quick here.

## Animation catalogue

| Moment | Duration | Easing | Description |
|---|---|---|---|
| Deal hole card | 220ms, 60ms stagger | `--ease-out` | Card travels from the deck position to the seat, scaling 0.85 to 1 |
| Deal flop | 220ms each, 70ms stagger | `--ease-out` | Three cards left to right |
| Deal turn / river | 240ms | `--ease-out` | Single card |
| Card flip (showdown) | 260ms, 90ms stagger | `--ease-in-out` | Y-axis rotation with a mid-point face swap |
| Bet chips to line | 320ms | `--ease-out` | Chips travel from the seat plate to the bet position |
| Chips to pot | 320ms, 40ms stagger | `--ease-in-out` | On street close, all bet stacks converge |
| Pot to winner | 480ms | `--ease-out` | Then 80ms `--ease-settle` overshoot on landing |
| Stack count-up | 600ms | `--ease-out` | Tabular figures, no horizontal jitter |
| Turn ring appear | 200ms | `--ease-out` | Then a 1600ms breathing loop at 0.85 to 1 opacity |
| Seat scale on turn | 200ms | `--ease-settle` | 1 to 1.04 |
| Fold | 180ms | `--ease-in-out` | Cards fade to 45% and slide 24px toward the table centre |
| Dealer button travel | 400ms | `--ease-in-out` | Arcs along the seat ellipse rather than moving in a straight line |
| All-in emphasis | 400ms | `--ease-settle` | Seat scales to 1.08, chips push forward |
| All-in vignette | 600ms | `--ease-in-out` | Screen-edge `--river-amber-bright` glow at 12% peak, pulses once |
| Invalid action shake | 200ms | linear | 3 cycles, 6px horizontal, plus a `--river-danger` border pulse |
| Status line change | 180ms | `--ease-out` | Cross-fade, no vertical movement |
| Focus ring move | 120ms | `--ease-out` | Ring travels between targets rather than cutting |
| Hold-to-confirm fill | matches hold duration | linear | Radial sweep. Unwinds in 120ms on release |
| Between countdown | 3000ms | linear | Ring depletes, matching `view.countdownMs` exactly |
| Modal enter | 220ms | `--ease-out` | Backdrop fades, panel scales 0.96 to 1 |

## The all-in moment

`docs/spec.md` names stand-up-on-all-in as River's signature moment. That is a 3D body animation, but 2D must carry an equivalent or the two renderers will feel like different games.

The 2D equivalent, in order:

1. Bet chips push fully to the pot line, 320ms.
2. Seat scales to 1.08 and takes a `--river-amber` border, 400ms `--ease-settle`.
3. Screen-edge amber vignette pulses once, 600ms.
4. `ALL IN` sets in `--fs-display` over the felt centre for 700ms, then clears.
5. Remaining streets deal at the normal board dwell, with no action prompts if no betting is possible.

Step 5 is supported by the automatic all-in run-out landed in `9717339`; see `08-handoff-2c.md`, gap 4.

## Reduced motion

`prefers-reduced-motion: reduce` switches every entry above to an opacity cross-fade at `--d-instant` (120ms). Specifically:

| Category | Reduced equivalent |
|---|---|
| Any positional travel (cards, chips, pot, dealer button) | Element appears at its destination with a 120ms fade. No travel |
| Any scale change | Removed. Emphasis carried by border and elevation only |
| Card flip | Direct cross-fade from back to face |
| Breathing loop on the active seat | Static ring at full opacity |
| Count-up | Value set instantly |
| All-in vignette | Static 8% amber tint held for the same duration, no pulse |
| Shake | Removed. Border pulse and colour retained |
| Hold-to-confirm fill | **Retained.** It is a progress indicator, not decoration, and removing it would make holds unreadable |
| Countdown ring | **Retained.** Same reason |

### Timing is never reduced

Reduced motion changes how things move, never how long the game takes. Step dwell times, bot pacing, the 3-second between-hands countdown and every hold duration are identical in both modes.

A player using reduced motion must be able to play at the same table as a player who is not, and see the same hand take the same time. When multiplayer lands in Phase 3 this stops being a courtesy and becomes a correctness requirement — so it is built in now.

## What River does not animate

- No idle ambient motion on the felt, chips or cards. The table is still until something happens.
- No parallax, no camera drift, no floating particles.
- No celebratory bursts, confetti, coin showers or screen shake on a win. The pot travelling and the stack counting up is the celebration.
- No animated advertisement of any kind, since there is nothing to sell.
- No spinner anywhere. Loading is a skeleton at final dimensions (`05-states.md`); progress arcs mean "keep holding" and nothing else.

# 08 — Handoff to Packet 2C

Binding constraints for Codex, plus the contract gaps found by running the engine against this design. Baseline `d8fa7f0` includes the approved all-in run-out repair and has 81 green tests. Each remaining gap has a decided handling so 2C is never blocked.

## Binding constraints

1. **Render only from `SoloTableView` and `SessionStep[]`.** No component reads `SoloSession` internals, private fields, or anything not on the exported view. The projection is the information-hiding boundary and Phase 3 swaps a socket in behind it without redesign.
2. **`hole === null` means not permitted to know.** It is never rendered as a known card, never cached from a previous reveal, and never inferred. `hasHole` alone decides whether backs appear (`04-anatomy.md`).
3. **Do not modify `packages/engine`.** Contract changes route back to Zain per the roadmap, not into 2C.
4. **Tokens live in one CSS custom property file.** No raw hex, raw font size, raw duration or raw easing appears in any component.
5. **One layout, uniformly scaled.** The only permitted branch is the compact rail below 1280 wide (`03-layout.md`).
6. **The engine owns every clock.** The renderer displays `countdownMs`; it does not run its own timers for game state. Presentation-only timelines (step dwell, animation) are the renderer's.
7. **No persistent bankroll.** No `localStorage`, no `sessionStorage`, no cookie carrying chips. Spec-level, and named in the roadmap standing bounds.
8. **No purchase surface.** No price, currency symbol, store affordance or top-up merchandising, decorative or otherwise.
9. **Hero renders at seat position 0.** Rotate `view.seats` so the seat with `isBot === false` sits at 6 o'clock. Engine seat order is never render order.
10. **Every state in `05-states.md` must render before 2C exits.** That table is the acceptance checklist.

## Contract gaps

### Gap 1 — No action timer in the view

`docs/spec.md` specifies a 15-second action timer with auto check-fold. `SoloTableView` has no deadline field, and timers are Packet 4A.

**Handling:** reserve the 64x64 timer housing on every seat plate and render it inert — no ring, no number. Do **not** invent a client-side action timer. A renderer-run timer would be a client making a game decision, which contradicts server authority and would have to be torn out in Phase 3.

### Gap 2 — `message` carries no severity

`view.message` is `string | null` and is used for both rejections and notices. Observed: after a rejected check, `view.message` is `cannot check when facing a bet`; at a completed showdown it is `null`.

**Handling:** derive severity at the view boundary rather than adding an engine field in Phase 2. `ActResult.ok === false` means error; `SessionStep` of kind `notice` means informational; hand outcomes are synthesised from `showdown` and `uncontested` steps. Mapping table in `05-states.md`.

### Gap 3 — Bot turns resolve synchronously

`drive()` loops every bot decision before returning, so one hero action can return an entire hand's worth of steps at once.

**Handling:** the step queue in `07-motion.md`. This is the single most important structural decision in 2C — build the queue before building any component, because every visual in the renderer reads from queue position rather than from the live view.

### Gap 4 — Automatic all-in run-out — resolved

Observed in `bustHand()`, where the opponent is all-in from the blind:

```
handStarted > blind > blind > await > action > board > await > action > board > await > action > board > await > action > showdown > bust
```

The hero receives an `await` on the flop, turn and river despite no betting being possible — the only opponent has no chips behind. Real poker runs the remaining board out automatically. As it stands, every all-in hand costs the player three meaningless checks, which directly contradicts the Blackjackist-pace pillar.

**Resolution:** Zain approved automatic run-outs. Commit `d8fa7f0` now advances through the remaining streets once no further betting is possible, while preserving a real call/fold decision whenever the final player with chips has not matched the outstanding wager. 2C must never auto-act on the player's behalf.

### Gap 5 — `sittingOut` is true for all-in players

`sittingOut` is computed as `handNumber > 0 && stack <= 0`, so a player all-in for their last chips reports `sittingOut: true` with a live hand. Observed directly in `bustHand()`.

**Handling:** the ordered seat-state evaluation in `05-states.md` checks `allIn` before `sittingOut`. The derived predicate is: genuinely sitting out only when `sittingOut === true` **and** (`phase !== 'hand'` **or** `hasHole === false`). Recommend the engine narrow this field in a later packet; not a 2C change.

### Gap 6 — `pot` is zeroed before the award animates

At settle, `view.pot` returns to 0 in the same tick the `showdown` or `uncontested` step is emitted.

**Handling:** award animations read their amount from the step payload, never from `view.pot`.

### Gap 7 — `potAwards` may hold several entries for one seat

Observed in `bustHand()`: `[{ you, 500 }, { you, 250 }]`, one entry per side pot.

**Handling:** group by `seatId` and sum before display. Side-pot breakdown may still be shown as separate rows in the pot readout, but a seat wins once per hand.

### Gap 8 — Engine strings are developer-voiced

`cannot check when facing a bet` versus `It is not your turn.` — inconsistent voice and capitalisation.

**Handling:** a single lookup at the view boundary maps engine strings to player copy, falling back to the raw string. Table in `05-states.md`. The engine is not changed in 2C.

### Gap 9 — Uncontested wins must not reveal

Observed: `revealed: false` and `hole: null` on an uncontested win. The winner's cards were never shown.

**Handling:** the uncontested outcome renders card backs. This is correct poker and also the information-hiding contract; it is listed because it is an easy thing to get wrong while building a satisfying win animation.

## Build order recommendation

1. Token file and the scaled 1920x1080 stage.
2. Step queue and presentation reducer (gap 3 and `07-motion.md`). Verify numeric reconciliation against the five fixtures before any visual polish.
3. Static table: felt, rail, seat ring, board wells, pot, empty states.
4. Seat plate with the full ordered state table.
5. Action rail, legal-action mapping, bet sizing.
6. Focus ring, controller and keyboard maps, hold-to-confirm.
7. Motion catalogue.
8. Reduced-motion pass.
9. Title-safe and layout-shift verification across every state.

Steps 1 and 2 are load-bearing for everything after them. Building components before the queue exists means rebuilding them.

## Decisions supplied by Zain

Four-colour cards, hybrid amount formatting, considered bot pacing, warm editorial serif, 1280x720 minimum viewport, and automatic all-in run-outs are approved. There is no open Packet 2B product decision.

# 05 — State tables

Every state below was captured by running the real fixtures from `packages/engine/src/scenarios.ts` against the engine at `9717339`, not inferred from the type definitions. Values in the "observed" columns are actual output.

**This document is the 2C acceptance checklist.** Packet 2C does not exit until every row has a rendered result verified in a browser.

## Session phases

`view.phase` has exactly three values.

| Phase | Observed shape | Render |
|---|---|---|
| `ready` | `pot: 0`, `legal: null`, `commit: null`, `board: []`, no hole cards | Table dressed, seats populated with stacks, board shows five wells, pot reads `0`, rail shows a single `DEAL` action occupying the Check/Call slot. Verify pill at 40% opacity, label only |
| `hand` | `commit` populated, `board` grows by street, `legal` non-null only when it is your turn | Live table. See the turn tables below |
| `between` | `pot: 0`, `countdownMs` counting down from 3000, `revealed` true after a showdown | Countdown ring in the status region, `DEAL NOW` on the rail, result copy held on screen |

**`pot` returns to 0 the instant a hand settles.** The award animation must therefore read its amount from the `showdown` or `uncontested` step, never from `view.pot`. Reading `view.pot` during the award renders `0` flying to the winner.

## Hero turn states

Observed from `awaitingHuman()` at preflop, heads-up, hero on the button posting the small blind.

```
pot: 750   currentBet: 500   currentActorId: "you"
legal: fold enabled | check disabled | call enabled 250
       raiseTo enabled min 1000 | allIn enabled 100000
```

| Condition | Rail state |
|---|---|
| `legal.check.enabled` | Slot 2 reads `CHECK` |
| `legal.call.enabled` | Slot 2 reads `CALL 250` with the exact cost |
| `legal.raiseTo.enabled` | Raise button and full sizing control active, slider floor at `legal.raiseTo.min` |
| `legal.raiseTo.enabled === false` | Raise button at 40% opacity, sizing control hidden with space reserved |
| `legal.allIn.enabled` | All-in button active, labelled with `legal.allIn.amount` |
| `currentActorId !== 'you'` | Every control at 40% opacity, no focus target inside the rail, focus parks on the menu cluster |

Check and call are mutually exclusive by construction in `legalFor`. Never render both.

## Seat states

Derived from `ViewSeat`. Rows are evaluated **in order** — the first match wins.

| Order | Condition | Plate | Cards | Chips | Second channel |
|---|---|---|---|---|---|
| 1 | `busted` | 40% opacity, `--river-cream-faint` text, stack reads `0` | none | none | `BUSTED` tag |
| 2 | `folded` | 55% opacity | two backs at 45% opacity, slid 24px toward the muck | none | `FOLDED` tag |
| 3 | `allIn` | `--e1`, `--river-amber` 2px border | normal | pushed fully to the pot line | `ALL IN` tag, amber |
| 4 | `id === currentActorId` | `--bd-active`, scale 1.04, `--e2` | normal | normal | breathing ring, `07-motion.md` |
| 5 | `sittingOut` | 55% opacity | none | none | `SITTING OUT` tag |
| 6 | default | `--e1` | per the card table in `04-anatomy.md` | per `betStreet` | none |

### `sittingOut` must not be trusted directly

Observed in `bustHand()` during play: a seat that is all-in for less than the big blind reports

```
stack: 0   allIn: true   folded: false   sittingOut: true
```

`sittingOut` is computed as `handNumber > 0 && stack <= 0`, so **any all-in player reports `sittingOut: true` while their hand is still live.** Rendering that literally shows an active all-in opponent as sitting out, which is wrong and would read as a bug to a player.

The evaluation order above fixes it: `allIn` is checked at row 3, before `sittingOut` at row 5. 2C must preserve that order. The derived rule, stated plainly:

> A seat is genuinely sitting out only when `sittingOut === true` **and** (`phase !== 'hand'` **or** `hasHole === false`).

This is recorded as gap 5 in `08-handoff-2c.md`.

## Board states

| `view.board.length` | Street | Render |
|---|---|---|
| 0 | `preflop` | Five wells |
| 3 | `flop` | Three faces, two wells |
| 4 | `turn` | Four faces, one well |
| 5 | `river` | Five faces |

Observed at an uncontested preflop win: `board: []` with `phase: 'between'`. The board row still renders five wells and holds its 168px. It never collapses.

## Hand outcomes

### Uncontested

Observed from `uncontestedWinHand()` with the hero folding:

```
steps: handStarted > blind > blind > action > await > action > uncontested > between
uncontested: { seatId: "p2", amount: 750 }
revealed: false        board: []        view.message: null
```

| Element | Render |
|---|---|
| Winner seat | `--bd-win`, `--e2`, chips fly from pot |
| Winner cards | **stay face down.** `revealed` is false and `hole` is null. Showing them is an information leak |
| Status line | `Rookie wins 750` in `--river-cream`, or `--river-win` when the hero wins |
| Board | five wells, unchanged |

### Showdown

Observed from `showdownHand()`:

```
steps: ... > action > showdown > between
potAwards: [{ seatId: "p2", amount: 3400 }]
revealed: true    board: 4c 5d 6c Ks Qd    view.message: null
```

| Element | Render |
|---|---|
| All live seats | hole cards flip face-up, `revealed === true` populates `hole` |
| Winner | `--bd-win`, ring, chips fly from pot, stack counts up |
| Losers | cards desaturate to `--river-card-muted` after the award resolves |
| Status line | winning hand description plus amount |

### Split pot

Observed from `splitPotHand()`:

```
potAwards: [{ seatId: "you", amount: 500 }, { seatId: "p2", amount: 500 }]
```

Both seats get `--bd-win`. The pot visually divides and travels to both simultaneously. Status line reads `Split pot`.

### Multiple awards to one seat

Observed from `bustHand()`:

```
potAwards: [{ seatId: "you", amount: 500 }, { seatId: "you", amount: 250 }]
```

Two side pots resolved to the same player. **The renderer must group `potAwards` by `seatId` and sum before display.** Rendering the array directly produces two separate win events for one player in one hand, which reads as a double-count.

### Bust

Observed from `bustHand()`:

```
steps: ... > showdown > bust > between
bust: p2      final: stack 0, busted true, sittingOut true
```

| Element | Render |
|---|---|
| Busted seat | row 1 of the seat state table, `BUSTED` tag |
| Rail | when the hero busts, the Check/Call slot becomes `REBUY 100,000` during `between` |
| Recovery | `rebuy(seatId)` returns true only during `between`, and only when the result stays within `maxBuyIn`. Observed: default rebuy succeeds and clears both `busted` and `sittingOut`; a 500,000 rebuy is refused |

A refused rebuy renders as the invalid-action state below. It is never a modal.

### Automatic all-in run-out

When every live opponent is all-in and the last player with chips has matched the outstanding wager, the engine at `9717339` advances directly to the river and settles. The renderer receives board and showdown steps with no dead `await` steps between streets. If the remaining player still owes chips, the engine correctly emits one `await` so they can call or fold before the automatic run-out begins.

## Invalid action states

Observed rejections, verbatim from the engine:

| Attempt | `ActResult.ok` | Message |
|---|---|---|
| Check facing a bet | `false` | `cannot check when facing a bet` |
| Raise below minimum | `false` | `raise below minimum of 1000` |
| Act out of turn | `false` | `It is not your turn.` |

Rendering: status line takes `--river-danger` text, a warning glyph, and the shake in `07-motion.md`. The offending control gets a 200ms `--river-danger` border pulse. **No modal, no toast, no focus change.** Focus stays where it was so the player can immediately correct.

`view.message` persists the rejection until the next successful action, so the status line is driven by state and does not need its own dismissal timer.

### Engine copy is developer-voiced

`cannot check when facing a bet` and `raise below minimum of 1000` are engine diagnostics, not player copy, and they are inconsistently capitalised against `It is not your turn.`

2C maps engine messages to player-facing copy in a single lookup at the view boundary, keyed on the engine string, with the raw string as fallback for anything unmapped. The engine is not changed in 2C.

| Engine | Player-facing |
|---|---|
| `cannot check when facing a bet` | `You have 250 to call.` |
| `raise below minimum of 1000` | `Minimum raise is 1,000.` |
| `It is not your turn.` | `Wait for your turn.` |

## Loading, empty, disconnected, recovery

Phase 2 is a local solo session, so there is no network. These states are specified now because Phase 3 introduces them and the reserved dimensions must already exist.

| State | Trigger | Render | Reserved |
|---|---|---|---|
| Loading | Engine module or fonts not ready | Felt, rail and empty seat wells at full opacity; seat plates, board and pot as 8% cream skeleton blocks at final dimensions; no spinner | All regions at final size |
| Empty | Session constructed, fewer than two funded seats | `notice` step: `Not enough seated players to deal a hand.` in the status line, rail shows only the menu | Full layout |
| Disconnected | Phase 3 | Rail disables, status line takes `--river-danger`, a 4px `--river-danger` bar appears at the top of the action rail. Table stays fully rendered and readable | Full layout |
| Reconnecting | Phase 3 | Same as disconnected with an indeterminate progress bar in the rail top edge | Full layout |
| Recovery | Connection restored | Bar transitions to `--river-win` for 600ms then removes. Rail re-enables. No modal, no reload prompt | Full layout |

**No state anywhere in River blanks the table.** The felt, the rail and the seat ring are always drawn. A player looking at the screen always sees a poker table.

## Full acceptance checklist for 2C

- [ ] `ready`, `hand` and `between` phases each render
- [ ] Hero turn with call available; hero turn with check available
- [ ] Raise disabled state with sizing hidden and space reserved
- [ ] Not-your-turn rail state
- [ ] All six seat states in the documented evaluation order
- [ ] All-in seat does **not** render as sitting out
- [ ] Matched all-in run-out reaches the river with no dead action prompts
- [ ] Board at 0, 3, 4 and 5 cards
- [ ] Uncontested win with opponent cards still face down
- [ ] Showdown with reveal
- [ ] Split pot with two winners
- [ ] Two side-pot awards to one seat, grouped and summed
- [ ] Bust, then successful rebuy, then refused rebuy
- [ ] All three invalid-action messages, mapped to player copy
- [ ] Loading skeleton with zero layout shift against the live table
- [ ] Empty-table notice
- [ ] Nine-seat, six-seat and heads-up shapes
- [ ] Title-safe overlay clean in every state above


---

# Revision — behavioural states (2026-08-24)

Added from `docs/behaviour-reference.md`. The engine at `9717339` does not yet expose these; they are Phase 3/4 states specified now so the HUD reserves space and 5B-R does not have to be redesigned around them.

## Turn indication

| Condition | Remote seat | Local |
|---|---|---|
| Not their turn | no indicator | RAM inert, wedges at 40% |
| Turn active, >50% remaining | overhead timer above the avatar, world-space | RAM actionable, **no countdown shown** |
| Turn active, <=50% remaining | overhead timer continues | urgency ring appears around the RAM outer edge |
| Timeout | timer completes, action auto-resolves | auto check if legal, otherwise fold |

There is no single global marker that moves between seats. Each active seat owns its own.

## Preset action states

| State | Private HUD | Public world |
|---|---|---|
| No preset | RAM resting | avatar neutral |
| Preset selected | icon shown **transparent, without the enclosing wedge circle** | avatar reaches toward chips or cards |
| Preset cancelled | icon cleared | avatar returns to neutral |
| Turn arrives, preset still legal | commits immediately | action animation plays |
| Turn arrives, preset now illegal | preset invalidated, normal RAM opens | avatar returns to neutral |

Other players never see the preset icon. They always see the gesture.

## Hole-card peek

| Input | Local | Remote |
|---|---|---|
| Held | HUD hole cards emphasised and fully readable | avatar plays card-peek animation |
| Released | HUD returns to resting | avatar exits peek |

Remote clients receive the animation only. Card values are never transmitted.

## Muck selection

Offered at showdown where rules allow, and to players who folded on the river.

| Option | Result |
|---|---|
| Show neither | cards muck unrevealed |
| Show one | player chooses which card |
| Show both | full reveal |
| Auto-muck on | selection skipped, cards muck automatically |

**Camera orbit remains enabled during muck selection.** This is called out explicitly in the reference and is easy to get wrong by treating the selector as a modal.

## Cinematic states

| State | Camera | Restores? |
|---|---|---|
| Ordinary action | player orbit, untouched | n/a |
| Qualifying all-in | temporary authored shot | yes, to previous orbit |
| Qualifying winner | temporary authored shot | yes, to previous orbit |
| Venue intro | authored shot, never while a hand is pending | yes |
| New hand start | **no recentre** | n/a |

## REP feedback

Floating text above the REP meter at end of hand. Never a modal, never blocks the next deal, never delays the between-hands countdown.

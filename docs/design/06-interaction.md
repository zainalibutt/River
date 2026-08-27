# 06 — Interaction, camera and input

Rewritten 2026-08-24 against `docs/behaviour-reference.md`. The previous version specified a linear focus ring across a horizontal button rail. That model is wrong: River's primary action surface is a **radial action menu**, and the camera belongs to the player. Both are described below.

River is controller-first and TV-first. Mouse and keyboard are fully supported and must preserve the same spatial model, not substitute a different one.

## Camera

### Model

Third-person, **seat-relative orbit** around a table-centred pivot. Not first-person, not free-fly, not top-down. Zain's decision is to clone the reference exactly: **no zoom, no first-person toggle, no top-down accessibility view.**

```ts
type OrbitCameraState = {
  yaw: number
  pitch: number
  radius: number      // fixed, or very tightly constrained
  fov: number
  target: Vec3        // table-centre biased, venue-offset
  localSeat: SeatId
}
```

On sitting or joining, the default transform resolves from the local seat:

```ts
defaultYaw = seatFacingTableYaw(localSeat) + cameraRearOffset
target     = table.center + venueCameraTargetOffset
```

Seat identity in the world is stable. Only the camera default is seat-relative — seat IDs are never remapped. This produces "I am sitting here looking across the table" for every seat without the engine knowing anything about it.

Zain confirmed from play: the local avatar sits in approximately the same foreground composition from every seat, and you can spin the camera fully around the table from your seat. Rotating to sit behind another player is permitted and does nothing mechanically — it is a feature, not a leak.

### Bounds

The orbit must never:

- clip beneath the table
- clip through avatars or chairs
- expose the underside or backside of venue geometry
- drop low enough that community cards become unreadable
- rise far enough that HUD and world-space bet labels overlap badly

Bounds may be venue-specific. The interaction model stays identical across venues.

### Recentring

| Event | Recentres? |
|---|---|
| After an all-in or winner cinematic | **Yes** — restore the player's previous orbit |
| Start of a new hand | **No** |
| Joining or sitting | Yes, to the seat default |
| Muck selection | No — orbit stays enabled throughout |

A cinematic borrows the camera and gives it back. It never permanently resets the player's chosen angle.

### Cinematic takeover

```ts
type CameraMode = "orbit" | "allInCinematic" | "winnerCinematic" | "venueIntro"
```

| Rule | Behaviour |
|---|---|
| Ordinary check, call, bet, raise, fold | **Never** moves the camera |
| Qualifying all-in | May preempt orbit |
| Qualifying winner | May follow showdown |
| Venue intro | Never while live hand action is pending |
| Muck selection | Orbit remains under player control |

Qualification is policy, not hardcoded — see the cinematic policy in `01-thesis.md`.

## Radial Action Menu

The RAM is the primary action surface and replaces the button rail entirely.

```ts
type RamState = {
  legalActions: ActionType[]
  focusedAction?: ActionType
  betAmount?: number
  minRaise?: number
  maxRaise?: number
  isPreset: boolean
  turnRemainingMs?: number
}
```

Only currently legal actions appear as wedges. Check and call are mutually exclusive by construction and never both render.

| Control | Behaviour |
|---|---|
| Stick or directional input | Select wedge |
| Confirm | Commit the focused action |
| Cancel | Back out, or cancel a preset |
| Mouse | Direct wedge selection; the spatial model is preserved, not replaced by a list |

### Betting dial

Bet sizing is a **circular dial divided into ranges**, not a linear slider. Ranges double and halve to give coarse and fine control within one control.

| Property | Value |
|---|---|
| Range | `legal.raiseTo.min` to `legal.allIn.amount` |
| Coarse step | Range halves and doubles |
| Fine step | One big blind |
| Initial value | `legal.raiseTo.min` |
| Readout | Exact, tabular, raise-to total |

The value is a **raise-to total**, matching `BettingHand.raiseTo`. Never labelled or computed as an increment.

## Turn indication and timers

Opponents and the local player are treated differently, and this is deliberate.

```ts
type TurnIndicator =
  | { kind: "remote"; seatId: SeatId; remainingMs: number }
  | { kind: "local"; remainingMs: number; showUrgencyRing: boolean }
```

**Remote:** the active opponent's timer appears **above their head**, attached to their seat. There is no single global pointer teleporting from seat to seat.

**Local:** the RAM becomes actionable immediately with no countdown. The urgency ring appears around the RAM only at **50% remaining**. The reference deliberately delays the local urgency treatment and it reads much better than a timer screaming from second one.

### Action windows

| Street | Budget |
|---|---|
| Pre-flop | 15s |
| Flop | 20s |
| Turn | 20s |
| River | 25s |

On timeout: automatic check if legal, otherwise fold. **The turn timer is independent of animation completion** — no non-critical animation may extend or delay it.

## Preset actions

Players select an action before their turn. This is the single most distinctive mechanic in the reference and Zain has chosen to reproduce it exactly.

```text
presetSelection(local)
  -> private HUD preset state
  -> networked avatar intent animation

cancelPreset(local)
  -> private HUD cleared
  -> avatar returns to neutral

turnBegins
  -> if preset still legal: commit immediately
  -> otherwise invalidate and open the normal RAM
```

| Layer | Visibility |
|---|---|
| Preset icons in your HUD | **Private.** Slightly transparent, not enclosed by the normal wedge circle |
| Avatar gesture | **Public.** Everyone sees you reach toward your chips |

This is not a leak to be fixed. It is poker body language, and the reference is explicit that it is deliberate. If River ever wants a competitive mode without tells, it becomes a ruleset option — never a silent removal.

## Hole-card peek

Looking at your own cards is an action in the world, not a passive state.

```text
input held
  -> local private card UI becomes readable and emphasised
  -> local avatar enters card-peek animation
  -> remote clients receive the animation only, never the card faces
input released
  -> private card UI returns to resting
  -> avatar exits peek
```

Others see **that** you checked. They never see what you saw.

## Input maps

### Controller

| Control | Action |
|---|---|
| Right stick | Orbit camera — yaw and limited pitch |
| Left stick / D-pad | RAM wedge selection, betting dial adjust |
| Cross | Confirm focused action |
| Circle | Cancel, or cancel preset |
| L2 held | Hole-card peek |
| L1 / R1 | Betting dial coarse range down / up |
| Triangle | All-in wedge shortcut — **hold 600ms** |
| Options | Menu |
| L3 | TV Mode — **hold 1000ms to exit** |
| Touchpad | Emote wheel |

### Keyboard and mouse

| Input | Action |
|---|---|
| Mouse drag | Orbit camera |
| Mouse hover and click | Direct RAM wedge selection |
| Scroll / drag | Betting dial |
| `Space` held | Hole-card peek |
| `F` | Fold — with confirm when checking is free |
| `C` | Check or call, whichever is legal |
| `R` | Focus the betting dial |
| `A` | All-in — **hold 600ms** |
| `1`–`4` | Bet presets |
| `E` | Emote wheel |
| `V` | Verify panel |
| `Esc` | Menu, or close the topmost panel |

Shortcut keys are inert while a text input has focus — text chat is a River addition and must not eat action keys.

## Hold-to-confirm

Destructive or irreversible actions require a hold, never a second modal. Modals break pace.

| Action | Hold | Indicator |
|---|---|---|
| All-in | 600ms | Radial fill on the wedge, label counts to `RELEASE` |
| Fold **when checking is free** | 400ms | Radial fill in danger colour |
| Fold when facing a bet | none | A normal poker decision, no friction |
| Exit TV Mode | 1000ms | Radial fill on the control |
| Leave table | 600ms | Radial fill |

Folding when you could check for free is always a mistake, so it is the one ordinary action that gets friction. Releasing early cancels with a 120ms unwind. Progress arcs mean "keep holding" and nothing else.

## Focus and accessibility

Focus visibility is always on in pad and keyboard modes — never delegated to `:focus-visible`, which hides focus exactly when a couch player needs it. 2C maintains an explicit input-mode class on the root.

| Requirement | Rule |
|---|---|
| Colour independence | Every state has a non-colour channel |
| Contrast | 4.5:1 minimum, 7:1 for pressure-critical text |
| Focus ring | Always visible, two-stroke, works on felt and on panels |
| Target size | No interactive target below 56x56 base-canvas pixels |
| Motion | Full reduced-motion path — see `07-motion.md` |
| Timing | Reduced motion never changes game pace |
| Screen reader | Live region on the status line, `polite` |

Reduced motion must never alter the 15/20/20/25 action budgets. A player using it plays at the same table at the same speed.

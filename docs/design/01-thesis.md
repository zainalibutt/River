# 01 — Visual and behavioural thesis

Rewritten 2026-08-24 against the behaviour reference and the reference frames in `docs/images/`. The previous thesis — "the room is dark, the felt is lit, the interface is furniture" — was authored before either existed and was wrong in its core claim. It is superseded entirely. Where any other design document still reflects it, this file wins.

## The one idea

**A social 3D poker room, not a poker UI with 3D decoration.**

River is a place you sit in. The poker state is authoritative and invisible; everything the player experiences is a room with people in it, where every action has a physical representation and the interface supplements the scene rather than covering it.

The behaviour reference states the failure mode precisely, and it is the one River is most at risk of:

> The biggest mistake would be to build a standard browser-poker HUD and merely put a 3D table behind it.

That is what River's 2D renderer currently is, and it was the correct thing to build for Phase 2. It is not the target.

## What that means concretely

1. **The poker engine is authoritative and deterministic.** Presentation consumes events. A failed animation can never corrupt hand state.
2. **Every action has an avatar and table-world representation.** Bets move chips. Peeking at cards is an animation other players can see. Folding is a gesture.
3. **The camera belongs to the player** — a third-person, seat-relative orbit — and is only borrowed for short authored moments.
4. **The HUD is readable and radial**, anchored to the player and the world, not a rail of web buttons across the bottom of the screen.
5. **Information leaks on purpose.** Preset actions broadcast through avatar gesture. Card peeks are visible. This is poker body language and it is a feature.
6. **The room is part of the product.** Venue, background life and ambience are not decoration; the reference is explicit that a tight crop of felt and hands is the wrong composition.
7. **Theatre without blocking.** The reference spent years patching out cinematic delay. Keep the drama, never let presentation stall the state machine.

## Inherited from the reference game

The benchmark, and the intent is a close reading with justified reinterpretation rather than a loose homage.

- **Venue identity.** Five rooms with distinct art, lighting, music, background life and dealer presentation.
- **Seat-relative orbit camera** with selective cinematic takeover.
- **Radial action menu and betting dial** as the primary interaction surface.
- **Preset actions with public gestures** — the most distinctive mechanic in the game.
- **Muck and show as personality**, not just a rules step.
- **Physical chip stacks that read as magnitude** at a glance.
- **Emotes as avatar animations** in the scene, not chat bubbles.
- **REP progression** layered over the table without hijacking it.

## Inherited from Blackjackist

- Pace between hands, and instant recovery from a bust.
- Money legibility — you always know your stack and the pot without hunting.
- Generous, unambiguous action targets.

## Where River deliberately diverges

Recorded as decisions rather than gaps, so nobody "fixes" them back toward the reference.

| River | Reference | Why |
|---|---|---|
| **Full text chat** | Emotes plus voice chat only, no typed chat | Zain's decision. Friend-group product; typed chat is how friends actually talk |
| **Winner cinematic always** | Conditional on the hand being "interesting enough" | Zain's decision |
| **Cinematic and fast pacing modes** | One authored cadence | Zain's decision. Keeps the theatre optional |
| **Desktop browser v1** | Console and PC native | No PS5 available to test against. PS5 remains a standing commitment, see `docs/spec.md` |
| **No real money, ever** | Free-to-play with purchasable chips | Spec pillar 5. Chips are unbuyable and uncashoutable |

## Refused, deliberately

| Refused | Reason |
|---|---|
| Any reference-game branding, character likeness, logo, typeface or venue name | Mechanics are not protectable; identity is. River ships its own rooms |
| A bottom-of-screen button rail as the primary action surface | The reference is explicit that this is the defining mistake |
| Blocking animation — presentation that can stall the hand | The reference's own patch history is a decade of undoing this |
| Any buy-chips affordance, price, currency symbol or top-up merchandising | Spec pillar 5, decoratively included |
| Typed-chat bubbles over avatars as a substitute for emotes | Emotes are 3D animations. Text chat is a separate panel |
| Pure black `#000` and pure white `#FFF` | Both read harsh at distance on OLED |
| Colour as the only carrier of meaning | Controller-first, TV-first, colour-blind-safe |

## Approved product decisions

Taken by Zain, recorded so they are not re-litigated.

| Decision | Value |
|---|---|
| Deck colour | Four-colour, two-colour available as a setting. Validated by render — suit reads from colour alone well before rank is legible |
| Amount formatting | Hybrid: exact for your own stack, pot and action controls; abbreviated on opponent seats |
| Bot pacing | Considered — Rookie 400-800ms, Novice 600-1200ms, OG 800-1600ms with an extra beat before aggression |
| Display typeface | Warm editorial serif |
| Minimum viewport | 1280x720 |
| All-in run-out | Automatic once no further betting is possible |
| Venue count | **Five**, see `10-art-direction.md` |
| Camera | Match the reference exactly — orbit only, no zoom, no first-person, no top-down |
| Preset tells | Exact reference behaviour |
| Pacing | Offer both cinematic and fast modes |

## Cinematic policy

Delegated to Claude's judgement by Zain, expressed as configuration rather than embedded in animation code:

```ts
type CinematicPolicy = {
  allIn: "firstPerHand";   // first all-in of a hand only - repeats are boring
  winner: "closeBeats";    // flush over straight, full house over flush, river suck-outs
  knockout: "never";
};
```

Heads-up behaves identically to a full table. Both policies are overridable per table by the pacing mode setting.

## Where the visual direction now sits

Reference staging with a River grade, per Zain: take the composition — round or oval table, seated bodies, floating per-seat HUD, venue backdrop, mid-height camera — and let each venue carry its own light. The Rooftop is bright and open. The Basement is dim and fluorescent. They are not variations on one grade; the range across venues is the point.

Full venue and table specifications are in `10-art-direction.md`.

# The shot — composition targets read off the reference

Measured from `docs/images/menus/`, fifteen stills plus a 75-second 1920x1080
capture of one hand. This is the contract for what the table view has to look
like. It is not a mood board: every number here was read off a frame and can be
checked against one.

The capture is kept locally and gitignored - 169MB does not belong in the
repository - but the frames it was measured from are reproducible with
`ffmpeg -ss <t> -i <capture> -frames:v 1`.

---

## Camera

| | River today | Reference | Change |
|---|---|---|---|
| Height above floor | 4.05 m | **~1.5 m** | down 2.5x |
| Radius from table centre | 6.10 m | **~3.2 m** | in 1.9x |
| Pitch below horizontal | 29.9 deg | **~16 deg** | halve |
| Horizontal FOV | 64 deg | ~65-70 deg | roughly right |

Derived rather than guessed. In the reference frame the horizon sits 5.8 degrees
above frame centre, the near players' heads sit just below it, and the whole
felt is visible but heavily foreshortened.

**The foreshortening is the tell.** The table reads as a flattened ellipse
18.5 percent of frame height. A tall, round ellipse means the camera is high;
River's is round. Match the ellipse and the camera height is right.

### Why this is the first change

At 4.05m you look **into the open tops of the seat cylinders**. That single fact
is why nine dressed characters read as people standing in tubs, and no amount of
work on the characters themselves will fix it while the camera stays there.

## Frame budget

| Band | Reference | River today |
|---|---|---|
| Sky and backdrop | ~30% | ~10% |
| Table, players, chairs | ~42% | ~45% |
| Floor | **~28%** | **~45%** |

The floor is not too bright in the reference - it is pale lavender-grey stone
with a large circular inlay. It is simply **not in shot**. River shows nearly
half a frame of floor because the camera is looking down at it.

## Scale of a person

A near player's shoulders span **14.6 percent of frame width**; a head is about
7 percent of frame height. Faces are legible. That is the distance at which the
face atlas and the garment loadouts finally pay for themselves.

## Empty chairs are set dressing, not absence

Three empty chairs sit in the near foreground of the reference frame and they
**frame the shot**. Black leather, high curved back with a crown emblem, chrome
pedestal, foot ring. The player sits in front of the back, never inside it.

Not every seat is occupied and several read `SITTING OUT` with a red pin. River
seats nine bodies every time, so the table never has the negative space the
reference uses to breathe.

## The dealer

There is an NPC dealer in a waistcoat and bow tie at the far side of the table,
handling the cards. River has no dealer at all, and the far side of the table is
consequently dead.

## HUD, as rules rather than taste

The reference is not uniformly small. It is disciplined about *when* it is big.

- **Persistent and small.** A row of six 44px icons top-left. A bottom-left
  block roughly 300x450 carrying hole cards, a REP ring, chip stack, community
  cards and bankroll.
- **World-space and tiny.** Bet amounts as floating amber numerals beside each
  player. Action pins above heads at ~55px. Revealed hole cards float above a
  player's head at showdown.
- **One large persistent element.** The amber turn-timer pin, ~130px. It earns
  its size by answering the only question that matters between actions.
- **Transient and large is allowed.** The betting dial is ~330px and sits at the
  bottom edge over the player's own back - never over the felt.
- **On demand.** Full nameplates appear only while a key is held, and may occlude
  freely because they are momentary.

**The invariant: nothing persistent ever crosses the felt, and no HUD element
competes with a face.**

River currently breaks this with a ~350px dead control centred over the near
table edge, a pot readout larger than any head, and permanent seat plaques where
the reference has none.

## Showdown is a cinematic, not a state

Two stages, both camera cuts away from the table: a live close-up on the winner
mid-celebration against the venue, then a graphic card - desaturated collage
backdrop, hand laid out as large card faces, `NAME WINS 9,225` in amber.

This is where character fidelity is actually seen. Budget for faces should be
justified by this shot, not by the seated view.

## The venue is a place

The reference rooftop carries a bar with a working bartender and idle NPCs,
three statues, framed portraits, a staircase, foil curtains, fire runs along a
pool, pendant ring lights, and a second poker table with its own game running.

River's rooftop is a disc, a parapet, palms and braziers. **This is the largest
remaining asset gap** and it is why the room reads empty regardless of how it is
lit.

## Order of work

1. Camera to the numbers above.
2. Chairs with backs, and stop seating a body in every seat.
3. HUD to the rules above.
4. Set dressing: dealer first, then bar and background life.
5. Garments and hair as real geometry.
6. Showdown cinematic.

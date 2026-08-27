# Packet 6A — the table HUD, in the club language

**Owner: Fable. Read `docs/handoff/fable-laws.md` first — it is short and it is
binding, especially law 1 on cost.**

---

## The one sentence

River's menus were rebuilt in a settled design language and the table was not,
so the game's own play surface still looks like a prototype bolted together
over eighteen months while the front door looks like a product.

## What is already decided, so you do not decide it again

The direction is settled and documented at `docs/images/menus_1/README.md`:
**a private club after dark.** Near-black green and charcoal foundation, warm
ivory type, brushed brass for focus and progress *only*, one oxblood accent
reserved for destructive actions, smoked glass and hairline rules.

It is already implemented as tokens and components in
**`apps/web/src/app/club.css`** — read that file, it is your palette and your
component vocabulary. Do not invent a second one.

Measured rules from the same board:

- Focus changes 180–250ms, screen transitions 500–700ms, a clean glide and
  never a bounce. `--club-focus`, `--club-screen`, `--club-glide` already exist.
- One dominant decision per screen. Secondary information quieter and
  physically separated.
- Brass marks focus and progress. If it is decorating something it is wrong.

## What the reference actually does in a hand

Two frames from the gameplay capture are at
`art/out/reference/in-hand-betting.jpg` and
`art/out/reference/in-hand-showdown.jpg`. **Read those two and no others.**

Measured off them:

- The in-hand layer is four things: a row of small circular icons top-left, a
  bottom-left block, small world-space pins, and a transient betting dial.
- **No pot text.** The pot is a pile of chips on the felt.
- **No name plaques and no stack plaques.** Chips on the felt say who has what.
- Bet amounts are small amber numerals in world space, and only where there is
  actually a bet.
- Pins are the size of a fingertip: a red dot for sitting out, an amber clock
  for whose turn it is.
- The bottom-left block carries hole cards, a REP ring, chip count and bankroll,
  in one place, and it does not move.

## What River has now, measured

Taken in a live hand at 1280x720 on 2026-08-27, by DOM measurement:

| element | share of frame | reference equivalent |
|---|---|---|
| `hud-corner` — HANDS / TABLE CODE / COPY INVITE / CHAT | 2.7% | a small icon row |
| `challenge-strip` | 1.2% | nothing during a hand |
| `pot-readout` | 0.9% | nothing — the pot is chips |
| `verify-pill` x2, `menu-cluster`, `lobby-toggle-button`, `shop-toggle` | ~2% | the icon row |

The owner's words, and they are the acceptance bar: *"all the artefacts like
showdown streak or save / 3d / table code look like vibecoded slop, not a james
bond level poker game."*

Already fixed, so do not redo them: floating card backs are gone (18 to 0), the
hero's hand is a fixed bottom-left block, the challenge strip steps out during a
hand, seat markers sit behind fixed panels, and the top-right corner is one flex
cluster rather than three elements pinned to the same anchor.

## Your lane

**Write only these:**

- `apps/web/src/app/globals.css`
- `apps/web/src/components/river-room-table.tsx`

**Read, do not write:**

- `apps/web/src/app/club.css` — the design system
- `docs/images/menus_1/README.md` — the direction
- `art/out/reference/in-hand-*.jpg` — the two frames

Everything else in the repository is another lane and is being edited
concurrently. `art/`, `apps/server/`, `packages/engine/` are all off limits.

## The job

Bring the persistent table HUD into the club language. Specifically:

1. **The top row.** `3D`, `SAVE`, `LIVE`, `VERIFY`, `TABLES`, `ITEMS`, `HANDS`,
   `TABLE CODE`, `COPY INVITE`, `CHAT` are ten controls across the top of the
   screen in four different visual treatments. The reference has six small
   circular icons. Reduce it to one coherent, quiet row. The table code does not
   need to be permanently legible — it is needed when inviting somebody.
2. **The typography.** The table uses a different type scale, weight and colour
   from the menus. Bring it onto the club tokens: ivory text, brass for focus
   and progress only, tracking rather than size for emphasis.
3. **The surfaces.** Panels are opaque boxes with assorted radii. The club
   language is smoked glass and hairline rules, one material hierarchy.

Do not remove functionality. A control that is hard to find is not an
improvement on a control that is ugly. If something genuinely does not belong
during a hand, it moves rather than disappears, and you say where it went.

## What "done" looks like

Report these numbers, measured in a live hand, before and after:

- Persistent HUD coverage as a share of frame.
- Count of positioned elements, and pairwise overlaps (must stay at zero).
- Count of elements with clipped text — `scrollWidth > clientWidth` (must stay
  at zero).
- Distinct type sizes and distinct panel background colours in use, before and
  after. This is the number that says whether it is one language or four.

## Getting a live hand

The dev server is already running on `http://localhost:3000`. There is a
seeded browser session with chips. Navigate to `/table`, click a `SIT` button,
wait, then click `DEAL` — bots fill the other seats. If the sit is refused for
insufficient balance, say so and stop; topping up a bankroll is not your lane.

## Gates before you commit

```
npm run typecheck > /tmp/tc.log 2>&1; echo $?
npx biome check apps/web/src > /tmp/l.log 2>&1; echo $?
npx vitest run apps/web/src/lib > /tmp/t.log 2>&1; echo $?
```

All three must be zero. `apps/web/src/app/globals.css` carries one long-standing
`noDescendingSpecificity` warning — a warning, not an error, and it does not
fail the exit code. Do not run `npm test`.

Finish with the routing statement: **READY FOR CLAUDE.**

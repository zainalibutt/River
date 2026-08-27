# Packet 5AC — Nobody is dealing

**Owner:** Codex. **Reviewer:** Claude.

Read `docs/handoff/codex-laws.md`, then `docs/design/22-shot-composition.md`.

---

## 5AB is accepted, and it worked

The garment ratio came down from 2.32 to 0.69 against the body's 0.67, and the
vertex count fell from 2,210 to 646 - which is what welding does and is the tell
that it actually happened rather than being reported. Download sizes dropped
across all three venues as a side effect.

## The gap

`docs/design/22-shot-composition.md` records that the reference seats **an NPC
dealer** in a waistcoat and bow tie at the far side of the table, handling the
cards. River has none, so the far side of the table is empty - and now that the
camera sits at 1.5m looking across the felt rather than down at it, that empty
far side is directly in the middle of the frame.

## What to build

A dealer at the far seat position:

- **Seated or standing at the table's far edge**, facing the camera's default
  position, so they occupy the middle distance of the default shot.
- **Dressed distinctly from the players** - the reference uses a waistcoat and
  bow tie, and the point is that a glance tells you who is staff and who is
  playing.
- Reuse the existing character pipeline. This is a variant, not a new rig, and
  it should carry the same skeleton so it can be posed by the same clips.
- **Not a player.** It takes no seat index, holds no chips, and must never
  appear in `seatIndex` userData - the client hides characters for unoccupied
  seats by reading that, and a dealer that answers to a seat would vanish
  whenever nobody sat there.

## Budget

The three venues currently sit at 75,249 / 64,165 / 77,859 triangles against a
gate of 250,000, and downloads at 3,733KB / 3,523KB / 3,862KB against a 6MB
gate. There is room. **Do not spend it all** - a dealer is middle distance, not
a hero, and the same budget will be wanted later for the bar and the background
life the spec calls for.

## Verification

Render the proofs at radius 3.2m, height 1.5m, **target 0.76m**. The dealer
should read as staff at a glance in `rooftop-chairs-empty.png`, without a single
player in frame to compare against.

## What not to do

- Do not touch `apps/web/`.
- Do not stamp `seatIndex` on the dealer.
- Rooftop only for now. If the dealer is built as a variant it will drop into
  the other two venues later without a second packet.

## Gates and report

Pipeline checks plus `npm run lint && npm run typecheck && npm test`.
`hygiene.test.ts` fails the suite if any tracked file names the reference game.

Law 1: stage only your own paths, `git diff --cached --name-only` before
committing. Law 7: Zain alone, no trailer, no emoji. Republish and check the
byte counts changed.

Finish with exactly: `READY FOR CLAUDE`

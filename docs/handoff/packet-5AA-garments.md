# Packet 5AA — The garments have shattered

**Owner:** Codex. **Reviewer:** Claude.

Read `docs/handoff/codex-laws.md`.

Supersedes sections 2 to 4 of `packet-5Z-R-chair-scale.md`. **Section 1 of that
packet is retracted and section 1b was also wrong** - you were right on both and
`TABLE_SURFACE_HEIGHT` is now 0.76 on the client to match the asset. Nothing
about the chair or the table needs to move.

---

## Why you were right, so the record is straight

I told you the chairs were three times too big, then that the table was 17cm too
low. You checked the asset, found 0.30m of clearance already there, declined to
move anything, and named the number that was actually wrong. Both of my claims
came from reading a proof render instead of the bytes.

**Declining a packet and saying why is the behaviour the laws are for.** Keep
doing it.

## The remaining defect, and it is the visible one

**In both occupied proofs the clothing has shattered into loose triangles** -
pink and grey shards scattered around every torso. It is the most obvious fault
in the frame now that the camera is at table height and the empty seats are no
longer occupied by phantom bodies.

Two things to establish, in order:

1. **Does it predate 5Z?** Render the same proof from the commit before yours.
   If the shards are already there, say so - it is mine and I will take it.
2. **If 5Z introduced it**, the likely cause is the seated rest pose moving the
   body without the garment following. Check that the garment mesh is still
   bound to the same armature, weighted to the same bones, and that its vertex
   groups survived whatever the pose change did.

Do not guess between those two. The whole point of the check is that four
"defects" on this project turned out to be faulty instruments.

## Then, if the garments come back

- **The chair back is detached from the seat pad** - a visible gap in
  `rooftop-chair-isolated.png`, with the back floating behind.
- **Characters are seated through the pads.** Legs run straight down and torsos
  pass through the seat. They are standing at chair height.

## Verification

Re-render all three proofs at the shipped camera - radius 3.2m, height 1.5m,
**target 0.76m** (this changed; it was 0.55 and aimed under the felt).

Judge `rooftop-chairs-occupied.png` first: if the clothing is intact and the
bodies are sitting, the packet is done.

## What not to do

- Do not touch `apps/web/`.
- Do not change the chair or table geometry. Both are correct and confirmed.

## Gates and report

Pipeline checks plus `npm run lint && npm run typecheck && npm test`.
`hygiene.test.ts` fails the suite if any tracked file names the reference game.

Law 1: stage only your own paths, `git diff --cached --name-only` before
committing. Law 7: Zain alone, no trailer, no emoji. Republish and check the
byte counts changed.

Finish with exactly: `READY FOR CLAUDE`

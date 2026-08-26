# Packet 5Y — WITHDRAWN

**Do not action this packet.** It was wrong, and it was my error, not Codex's.

Withdrawn 2026-08-26, before any work was done against it.

## What it claimed

That the Rooftop terrace `#30383a` and parapet `#2a2f3a` sat at a contrast
ratio of 1.119 against a 1.4 threshold, and that the parapet should move.

## Why it was wrong

Two faults in the gate that produced the number, both mine.

**The colour space.** glTF stores `baseColorFactor` in linear space.
`venue-palette.ts` works in sRGB. The gate handed linear values straight to
`relativeLuminance`, which runs `linearise` over them - a second transfer
function on top of the first. Every luminance it reported was wrong: the floor
came out at 0.0376 where the shipped value is 0.2135.

Confirmed against the running scene rather than reasoned about: three.js holds
that material as `0.1882, 0.2196, 0.2275`, byte-identical to the file, and
prints it as `#788183` because printing converts to sRGB. The renderer was
correct the whole time.

**Textured materials.** A material whose colour comes from a map carries a
white factor by convention. The gate judged that white as if it were the
surface colour, so the Laundromat's checkerboard floor - one textured plane -
read as the brightest thing in the room and paired with anything pale beside
it. That produced a second defect report against a surface the gate cannot see
at all.

## What is true now

Both faults are fixed and the gate is live in the suite rather than excluded.
**All three venues pass.** The Rooftop passes partly because Codex had already
moved the parapet to `#171b21` during 5X, which was one of the values this
packet was going to ask for.

## The lesson worth keeping

The gate was built to catch art defects and its first two reports were both
artefacts of its own measurement. A gate that fires is not the same as a gate
that is right, and this one sent a packet to another lane before anyone checked
what it was actually reading.

This is the fifth instrument fault on this project, after the hot-reloading
tree, the incomplete scene reset, the `--factory-startup` launch and the hidden
browser tab. **Prove the instrument can see the thing before believing what it
reports** - including, and especially, an instrument you wrote yourself.

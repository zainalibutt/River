# Packet 7F face source proof

Date: 2026-08-28

## Outcome

One source face is ready for visual approval. It has not been integrated into the venue GLBs.

- The authored face allocation doubled from 128 by 256 to 256 by 256 texels without increasing the 1024 atlas or adding a material.
- The face projection now uses the measured source bounds: x from -0.115m to 0.115m and z from 1.475m to 1.645m. Venue assembly had sampled only a narrow upper strip of the source face.
- Brow strokes, sockets, eye mass, nose shadow and mouth retain broad value shapes that survive the gameplay-distance proof. The hard forehead band was reduced and moved to the hairline.
- Hands moved to their own atlas cell so the wider face allocation cannot consume or recolour them.

## Rejected intermediate

The first widened-atlas proof rendered the face as a dark mask. `paint_face_cell` multiplied the face's starting column by its new two-cell width, so it painted columns six and seven while the UVs sampled columns three and four. The source proof failed, the origin was corrected to the base 128-pixel cell width, and no venue rebuild was allowed from the failed result.

## Evidence

- Close proof: `art/out/proofs/char-hero.png`.
- Gameplay-distance proof: `art/out/proofs/char-hero-distance.png`.
- Male and female source GLBs: 19,802 total triangles, two materials, three draw calls, 137 bones and PASS.
- Character negative fixtures: PASS.

## Decision gate

Zain must accept or reject this source face before 7G rebuilds Rooftop, Laundromat and Executive Suite. A rejection returns to 7F source paint or geometry; it does not trigger a nine-seat iteration.

Status: `AWAITING ZAIN`.

# Packet 7G face integration and lighting

Date: 2026-08-29

## Outcome

The face direction accepted by Zain now survives source export and venue
assembly in Rooftop, Laundromat and Executive Suite. Packet 7G is complete and
7H cast variation is ready.

## Corrections

- Removed the second body UV projection performed during venue assembly. The
  source character already owns authored regions for face, hands, legs and
  shoes; projecting those vertices again stretched the face masses into
  horizontal bands and produced jagged skin boundaries on the forearms.
- Replaced the continuous brow band and painted eye dots with separate soft
  socket and brow masses. The rigged eye geometry remains the eye read.
- Added restrained cheek and nose warmth that survives the gameplay-distance
  proof without changing the face boundary colour.
- Moved the painted hairline transition to the top edge of the face island and
  inset the front of the hair shell. The former hard brim shadow is gone.
- Kept the seated rest pose unchanged. Chrome inspection shows seat contact and
  posed thighs; the wide lower garment hides that break from some angles and is
  assigned to the divided-trouser work in 7H.

## Evidence

- Source build: exit 0. Male and female each contain 19,802 total triangles,
  two materials, three draw calls, one 1024 atlas and 137 bones.
- Source asset checker: PASS for both characters.
- Character negative fixtures: `ALL_CHAR_NEGATIVE_OK`.
- Close proof: `art/out/proofs/char-hero.png`.
- Gameplay-distance proof: `art/out/proofs/char-hero-distance.png`.
- Venue build: exit 0.
- Published asset checker: PASS for Rooftop, Laundromat and Executive Suite.
- Rooftop: 116,924 triangles, 25 materials, 63 draw calls, 4,989 KB.
- Laundromat: 94,434 triangles, 21 materials, 50 draw calls, 4,328 KB.
- Executive Suite: 108,128 triangles, 22 materials, 55 draw calls, 4,668 KB.
- Chrome: all three venues inspected at full occupancy. A closer Rooftop orbit
  confirmed that the doubled face bands and forearm atlas seams are absent.

## Deferred to 7H

- Seven distinct hair silhouettes replace the one remaining source hairstyle.
- Divided trousers replace the accidental skirt read.
- Fingertips remain visually thin at some angles; garment and hand silhouette
  review travels with the 7H source proofs rather than reopening face paint.
- Body, age, presentation and wardrobe breadth follow
  `docs/handoff/packet-7h-cast-wardrobe-direction.md`.

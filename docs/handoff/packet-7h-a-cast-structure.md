# Packet 7H-A — Cast structure checkpoint

**Owner:** Codex  
**Status:** `DONE`  
**Contract:** `docs/handoff/packet-7h-cast-wardrobe-direction.md`

## Outcome

The shipping table cast no longer repeats one body, face recipe, bowl-cut shell,
or joined lower-body silhouette. Eight fixed player recipes now combine three
measured body presets, six face recipes, and seven hair choices. The dealer has
a fixed recipe outside the player sequence. A plain divided trouser shell is
part of the rigged garment and replaces the accidental skirt-like default.

This is the structural half of 7H. It deliberately does not claim the wardrobe
contract: the generic shirt remains until 7H-B replaces it with the approved
outfit masters.

## Shipped structure

- Fixed eight-seat cast; no runtime randomisation and no reroll on reload.
- Body presets: slight, standard, broad.
- Face recipes: young, established, and older, each in everyday and glamorous
  presentation.
- Hair reservoir: slick-back, side-part, crop, quiff, bob, bun, and bald. Venue
  assembly exports only the selected mesh for each character.
- Divided straight trouser tubes are weighted to the existing upper- and
  lower-leg bones and remain inside the one garment object.
- Source face UVs remain authored; venue assembly translates the face island to
  the selected recipe cell without reprojecting it.

## Evidence

- Source character builds: exit 0 for both bases.
- Source asset checks: PASS for male and female.
- Character negative fixtures: `ALL_CHAR_NEGATIVE_OK`.
- Venue build: exit 0.
- Published asset checker: PASS for Rooftop, Laundromat, and Executive Suite.
- Chrome extension review: full occupancy inspected in all three venues. Hair
  silhouette, body-width, face-value, and divided-leg variation were visible at
  the table camera. The persistent review tab was left open on Rooftop.

## Measured shipping budgets after 7H-A

| Venue | Triangles | Materials | Draw calls | GLB |
|---|---:|---:|---:|---:|
| Rooftop | 114,462 | 25 | 62 | 4,935 KB |
| Laundromat | 92,172 | 21 | 49 | 4,278 KB |
| Executive Suite | 105,866 | 22 | 54 | 4,617 KB |

## Next checkpoint

7H-B begins with the four binding wave-one masters: dealer ivory statement
jacket, M1 dinner jacket, F1 cocktail sheath, and M5 leather jacket. Outfit
variation must remain atlas-driven: no per-outfit material, second atlas, or
additional shipping draw call.

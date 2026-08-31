# Packet 7H-B1 — Wave-one wardrobe integration

**Owner:** Codex  
**Status:** `CHECKPOINT`  
**Contract:** `docs/handoff/packet-7h-cast-wardrobe-direction.md`

## Outcome

The wardrobe is now a selected character feature rather than one universal
shirt. Venue assembly chooses one source outfit mesh and one atlas recipe for
each character while retaining the existing one-atlas and one-garment-material
shipping structure.

The four wave-one identities are wired and visible: the dealer's ivory jacket,
M1's dark dinner jacket with a bounded ivory inset, F1's green cocktail read,
and M5's boxier dark leather read. F1 everyday and glamorous recipes use
separate atlas cells; the glamour cell alone receives the brighter emerald.

## Evidence

- Python compile: exit 0.
- Diff whitespace check: exit 0.
- Source character builds: exit 0 for both bases.
- Source male and female asset checks: PASS.
- Character negative fixtures: `ALL_CHAR_NEGATIVE_OK`.
- Source hero proof rendered and inspected after rejecting a broken sleeve
  experiment.
- Venue build: exit 0.
- Published asset checker: PASS for all three venues.
- Chrome extension: Rooftop, Laundromat, and Executive Suite inspected at full
  occupancy. The persistent tab is left on the Rooftop frame and marked as the
  deliverable.

## Measured shipping budgets

| Venue | Triangles | Materials | Draw calls | GLB |
|---|---:|---:|---:|---:|
| Rooftop | 113,700 | 25 | 62 | 4,924 KB |
| Laundromat | 91,410 | 21 | 49 | 4,267 KB |
| Executive Suite | 105,104 | 22 | 54 | 4,606 KB |

## Not yet accepted as final wardrobe

- M1 and M5 still inherit the stable short sleeve from the source shell. A
  first procedural full-sleeve attempt failed the seated source proof and was
  removed before venue export.
- F1 removes the trouser shell and most outer sleeve geometry, but the shoulder
  termination still reads closer to a cap sleeve than the contract's clean
  sleeveless line.
- The dealer is immediately identifiable as the brightest clothed mass, but
  the dark shawl/roll-neck paint needs a closer-shaped inset instead of the
  current broad upper-chest band.
- Wave two remains blocked on these three silhouette corrections. This packet
  is a truthful integration checkpoint, not a 7H completion claim.

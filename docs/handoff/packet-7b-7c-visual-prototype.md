# Packet 7B-7C visual prototype handoff

Date: 2026-08-28

## Outcome

- 7B complete: `/dev/visual-review` renders any venue with empty, sparse, or full occupancy without authentication, WebSocket state, or storage.
- 7B complete: clean-frame mode hides the controls and the `REVIEW` button restores them.
- 7B complete: the route calls `notFound()` in production and is forced dynamic so the review component is not prerendered. Next's streamed not-found response reports HTTP 200, but the review component and its text are absent.
- 7C prototype complete: the source male and female characters now use one dark eye mass instead of white/iris layers, a 606-triangle asymmetric hair silhouette, a shorter ivory garment wedge, broad face-value paint, and a relaxed finger curl.
- 7C was accepted by Zain on 2026-08-28 and integrated into all three venue GLBs in 7D. See `docs/handoff/packet-7d-character-integration.md`.

## Evidence

- Chrome snapshots: `7b-rooftop.png`, `7b-rooftop-clean.png`, `7b-laundromat.png`, and `7b-executive-suite.png` in the task visualization directory.
- Character proofs: `art/out/proofs/char-hero.png` and `art/out/proofs/char-hero-distance.png`.
- Source character manifest: `art/out/char_manifest.json` records 9,342 body-plus-hair triangles, 606 hair triangles, 196 eye-mass faces, 137 bones, 265 vertex groups, nine actions, and no build checks for both bases.
- The exported GLBs are 12,727 triangles each including the garment; the asset checker reports PASS for both.

## Quality gates

- `npm test`: PASS, 77 files and 895 tests.
- `npm run typecheck`: PASS.
- `npm run lint`: exit 0 with the two pre-existing descending-specificity warnings in `globals.css`.
- `npm run build --workspace @river/web`: PASS.
- `python art/pipeline/check_assets.py art/out/char_male.glb art/out/char_female.glb`: PASS.
- `python art/pipeline/test_checker_chars.py`: PASS, including all negative fixtures.
- Blender source build: exit 0, both character checks empty.
- Blender proof render: exit 0 and both proof images written.

## 7D resolution

- Zain accepted the hero face, general model, hair read and hands before the venue rebuild.
- Model actual lapel and collar geometry if the shortened painted wedge still reads like a shirt graphic.
- The dealer's oversized procedural tray/bow-tie blocks remain a separate visual defect; 7D does not hide it inside the character repair.
- Venue character LODs were rebuilt only after source approval, with explicit body, hair and garment ratios.

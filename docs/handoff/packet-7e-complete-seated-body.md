# Packet 7E complete seated body handoff

Date: 2026-08-28

## Outcome

- Every integrated character now keeps the full rigged body instead of ending above the thighs.
- The correct `upperleg01` and `lowerleg01` bones form the seated pose in every venue. Thighs, shins and feet remain part of the same 137-bone rig used by the animation clips.
- Dedicated atlas cells clothe the lower body and shoes. Hand UVs retain priority so the lower-body mapping cannot paint hands as trousers again.
- Venue assembly now always maps the face onto the authored face cell. The `face` cosmetic identifier previously redirected the whole face onto a flat palette swatch.
- The block-built dealer waistcoat and bow tie were deleted. They were the floating red obstruction in front of the dealer.
- Runtime chip stacks now sit inside the felt ellipse. The near-seat stack previously projected across the black table apron.

## Measured cost

| Artefact | Triangles | Materials | Draw calls | Download |
|---|---:|---:|---:|---:|
| Male source | 19,802 total | 2 | 3 | within source gate |
| Female source | 19,802 total | 2 | 3 | within source gate |
| Rooftop | 116,924 | 25 | 63 | 4,989 KB |
| Laundromat | 94,434 | 21 | 50 | 4,328 KB |
| Executive Suite | 108,128 | 22 | 55 | 4,667 KB |

The source ceiling is 23,000 triangles. The three shipping scenes remain below 250,000 triangles, 26 materials, 120 draw calls and 6 MB.

## Chrome evidence

- `7e-rooftop-full-body.png`
- `7e-laundromat-full-body.png`
- `7e-suite-full-body.png`

Chrome was switched through all three full tables after a cache-busting reload. The dealer obstruction is absent, near and side seats show continuous lower bodies, and the misplaced chips are back on the felt.

## Quality gates

- `npm test`: PASS, 77 files and 895 tests.
- `npm run typecheck`: PASS.
- `npm run lint`: exit 0 with the two pre-existing descending-specificity warnings in `globals.css`.
- `npm run build --workspace @river/web`: PASS.
- Male and female source asset checks: PASS.
- Rooftop, Laundromat and Executive Suite public asset checks: PASS.
- Character checker negative fixtures: PASS.
- Browser application errors: none. Existing Three.js deprecation warnings remain.

## Next boundary

7E proves structural completeness; it does not claim final face quality. Packet 7F is one source face only, proved close and at gameplay distance before another venue rollout.

Status: `READY FOR 7F`.

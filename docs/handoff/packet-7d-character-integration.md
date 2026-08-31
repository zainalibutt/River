# Packet 7D character integration handoff

Date: 2026-08-28

## Outcome

- The face, general model, hair and hands accepted by Zain in 7C are integrated into Rooftop, Laundromat and Executive Suite.
- Collar, shoulder, armpit, sleeve and hem clearance was checked in the close proof and in all three full tables.
- The binding 7A to 7D remediation sequence in `docs/roadmap.md` is complete.

## Root causes and repair

The old venue build applied `shape_seated_arms` directly to the body mesh after posing. The garment was a separate skinned mesh, so its sleeves did not receive the same deformation. Applying the same mesh-space edit to the garment produced unstable spikes. The duplicate deformation was deleted; body and garment now remain aligned through the one shared 137-bone rig.

The seated LOD selector also identified a body only when its data name started with `base`. The authored meshes are named `char_male_body` and `char_female_body`, so body and hair both received the garment ratio of 0.24. The selector is now role-aware: body 0.60, garment 0.42 and hair 1.0. Each integrated seat contains 5,256 body, 606 hair and 1,397 garment triangles.

## Artefact evidence

| Venue | Triangles | Materials | Draw calls | Download |
|---|---:|---:|---:|---:|
| Rooftop | 79,673 | 26 | 65 | 3,591 KB |
| Laundromat | 61,258 | 21 | 50 | 3,075 KB |
| Executive Suite | 74,952 | 22 | 55 | 3,414 KB |

All are below the 250,000 triangle, 26 material, 120 draw-call and 6 MB gates. Published files are byte-identical to the checked build outputs.

Chrome evidence in the task visualization directory:

- `7d-rooftop-integrated.png`
- `7d-rooftop-close.png`
- `7d-laundromat-integrated.png`
- `7d-suite-integrated.png`

## Quality gates

- `npm test`: PASS, 77 files and 895 tests.
- `npm run typecheck`: PASS.
- `npm run lint`: exit 0 with the two pre-existing descending-specificity warnings in `globals.css`.
- `npm run build --workspace @river/web`: PASS.
- Public Rooftop, Laundromat and Executive Suite asset checks: PASS.
- Male and female source character asset checks: PASS at 12,727 triangles, 2 materials and 3 draw calls each.
- Character checker negative fixtures: PASS.
- Chrome inspection: PASS in all three venues at full occupancy; no application error was logged.

## Carried visual work

- The dealer's oversized red procedural tray/bow-tie blocks remain visible and are outside the garment integration repair.
- Character variation remains deliberately limited until a later packet; 7D proves one accepted source cleanly before multiplying styles.
- Chrome still reports the existing Three.js `Clock` and `PCFSoftShadowMap` deprecation warnings.

Status: `READY FOR ZAIN`.

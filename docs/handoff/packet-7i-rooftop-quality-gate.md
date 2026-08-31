# Packet 7I — Rooftop quality gate

**Owner:** Codex  
**Status:** `DONE` — accepted by Zain 2026-08-29  
**Decision owner:** Zain

**Finish tracker:** `docs/roadmap.md`, F1. This remains the sole active finish
track until Rooftop passes its three-shot Chrome review and Zain accepts it as
the reference for the deferred venues.

## Scope decision

Rooftop is the only active venue for visual development. Laundromat and
Executive Suite remain valid future venues, but their art, lighting, character
inspection and rebuilds are deferred until Zain accepts Rooftop as the quality
bar. Targeted builds and publishing use `RIVER_VENUES=rooftop`; the default
pipeline continues to support all venues for later resumption.

This is a quality gate, not one broad polish packet. Each stage is inspected in
Chrome at the gameplay camera before the next stage spends the remaining scene
budget.

## Stage 1 — Face readability and profile integrity

- Remove the six layered MPFB eye shells and six four-vertex eye spikes that
  separate into dots in profile. The atlas provides the gameplay-scale socket
  and iris read without a second eye material or intersecting replacement mesh.
- Strengthen the eye-line value without adding a third character material.
- Inspect front, three-quarter and profile source proofs, then the Rooftop table
  camera. A recognisable eye line must survive at the near-seat head size.

**Checkpoint:** complete. Male and female source builds exited 0 with no
character checks; front and profile proofs are clean; the published Rooftop
asset passed at 111,829 triangles, 25 materials and 62 draw calls. Chrome review
confirmed the side dots are absent in the full-table default and profile orbit.

## Stage 2 — Finish the wave-one wardrobe silhouettes

- Replace the shared helmet generator with style-specific hair contours. The
  construction set covers close crop, swept side-part, bob, slick-back, quiff
  and bun.
- Rig-safe full sleeves for M1 and M5.
- Clean sleeveless shoulder termination and deliberate lower sheath for F1.
- Replace the dealer's broad dark chest band with a shaped shawl-lapel and
  roll-neck inset.

**Hair checkpoint:** deferred after the bounded Fable correction pass. The six
styles are distinct and the worst floating-shell defects are removed, but their
close contours still read choppy and are not accepted as final hair quality.
Zain explicitly parked further hair work on 2026-08-29 so higher-impact Rooftop
quality can proceed. No further Fable spend belongs here until wardrobe, table,
chairs and place quality produce a materially stronger review frame.

**Wardrobe checkpoint:** complete for this gate. M1/M5 and the dealer now use
rigged full sleeves, F1 keeps the sleeveless source so its lower arms remain
visible, and the dealer atlas uses a narrow roll-neck, two shawl-lapel strokes
and a bow tie instead of the broad dark bib. Chrome confirmed the silhouettes
at the full-table camera. Small hem and shoulder artefacts remain visible, but
they are below the table, seating and place-quality problems and do not justify
another character rebuild before Stage 3.

## Stage 3 — Hero table and seating

- Spend existing headroom on rail profile, felt edge, wood base, chip bevels,
  card thickness and the chair crown/back/seat/pedestal hierarchy.
- Materials must read as felt, worn leather, dark timber, clay and chrome at the
  gameplay camera rather than as flat coloured primitives.
- Keep one table system and the existing instancing and draw-call rules.

**Stage checkpoint:** complete. The old rail emitted only one triangle for each
inner and outer wall segment, leaving a repeated ring of open wedges. The rail
now uses a closed padded loft around the full oval. The felt disc's centre
vertex was corrected so the surface no longer fractures into long wedges; a
fine brass inlay now frames play without competing with cards. The former dark
wall base is a shaped apron, stem and foot, and each swivel chair now has a
fuller cushion, piped crown and deeper back shell. Chrome confirmed the table
and seating hierarchy in full and empty views.

## Stage 4 — Rooftop place quality

- Replace the empty disc-and-parapet read with the already specified terrace:
  bar glow, planters and foliage, restrained string lights, pool/fire edge,
  skyline depth and selected background life.
- Floor treatment receives a deliberate large-scale inlay and surface response;
  backdrop geometry must frame the table rather than compete with faces.

**Checkpoint:** complete for shot acceptance. Two restrained brass terrace
rings reuse the table inlay material, foliage and tower values separate from
the night ground, and every tower and facade now faces inward. Window rows are
split into a varied grid with dark rooms instead of one floating bar per floor.
Chrome confirmed the city read in full and empty views without a camera-path
intrusion.

## Stage 5 — Shot acceptance

- Review default, near-side orbit and opposite-side profile frames in Chrome.
- Verify face legibility, dealer hierarchy, chair occupancy, table material
  reads, floor/frame balance and the absence of camera-path intrusions.
- Record budgets from the exported Rooftop GLB and do not resume the deferred
  venues until Zain explicitly accepts this frame as their quality reference.

**Acceptance:** complete. Default, near-side
orbit and opposite-side orbit frames were reviewed in the preserved Chrome
session. The published Rooftop GLB passes at 117,897 triangles, 26 materials,
64 draw calls and 4,938 KB. Zain accepted the improved table, felt/inlay,
shaped base, chairs, terrace and skyline as the main quality line. Hair contour
quality, small garment terminations and bespoke prop density remain explicitly
deferred and are not hidden acceptance claims.

## Current observation

The Rooftop now has a coherent first gold-reference frame: readable table and
seating silhouettes, a deliberate felt/floor inlay language, a shaped base and
a city backdrop that reads at gameplay scale. It remains below final launch art
in hair, small garment terminations and bespoke prop density, but those are
separate later passes. The next gate is F2's joined-up 3D table acceptance;
Laundromat and Executive Suite remain deferred.

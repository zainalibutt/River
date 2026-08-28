# River character design

Packet 7A deliverable. Sources: `art/out/proofs/char-solo.png`,
`docs/images/menus_1/README.md`, `art/out/reference/in-hand-betting.jpg`, and
the measured constraints in the packet. Written to be built from without a
follow-up question.

---

## 1. The wrongness, named

Six passes fixed real defects and the character still looks wrong because every
pass moved toward "a more correct human" without anyone deciding what kind of
image a character is. At 3.2 metres a whole character occupies roughly 110 x
150 pixels of a 1080p frame and a face is 40 pixels tall. At that size there
are only two kinds of image: a poster — a small number of value blocks with a
designed silhouette — or noise. Nobody chose, so River has noise with clean
edges: a mannequin.

The mannequin read has three specific causes, all visible in `char-solo.png`:

1. **No value structure.** Skin, shirt and cap are all midtones. At distance
   the character collapses into one grey-pink blob. The reference frame proves
   the alternative: the figures that read instantly there are the ones built
   from a dark garment mass, an ivory triangle at the chest, and a distinct
   hair value. The ones that vanish are midtone on midtone.
2. **No silhouette information.** Symmetric cap-shaped head, tube arms, paddle
   hands. At gameplay camera (61 to 85 degrees from vertical) the outline you
   see is crown, shoulder line, sleeves, hands on the table — and none of
   those currently carries any design.
3. **One substance.** A single roughness of 0.62 and flat albedo fields make
   skin, cloth and hair read as the same material: plastic. We cannot add
   materials, so substance has to be faked in the albedo — darker hair with
   painted sweeps, baked soft occlusion at every boundary, warmth zones in the
   skin.

**The decision this document makes: River characters are tailored poster
figures.** Near-real proportions (stylisation capped at +10 percent on any
dimension), graphic value-blocked surfaces, silhouette-first geometry, in the
club language the menu board has already settled: private club, after dark,
under quiet pressure. Not the reference game's caricature — its big-hands
cartoon register would clash with the editorial tone. Realistic bodies,
poster surfaces.

## 2. The numbers that govern everything

Face height 40 px for a 190 mm face gives **4.75 mm per screen pixel**. Every
choice below follows from that scale.

| feature | real size | on screen | verdict |
|---|---|---|---|
| whole seated bust (table to crown) | ~700 mm | ~150 px | the design canvas |
| shoulder width | ~480-520 mm | ~100-110 px | main silhouette read |
| head incl. hair | ~240-280 mm | ~50-58 px | biggest identity carrier |
| hand length | ~190 mm | ~40 px | as large on screen as the face |
| collar/lapel V width | ~120 mm | ~25 px | second identity carrier |
| brow band | 50 x 8 mm | 10 x 2 px | reads if dark enough |
| mouth | 50 x 6 mm | 10 x 1.5 px | reads as a line only |
| eye aperture | ~10 mm | 2 px | does not read; do not paint whites |
| iris/pupil | 12/4 mm | 2.5/<1 px | sub-pixel; drop |
| nostrils, buttons, lashes, pores | <10 mm | <2 px | drop entirely |

Two build rules fall out of the table:

- **Triangles buy silhouette; pixels buy interior.** Geometry exists to shape
  the outline and to catch venue light on the big planes. Everything interior
  is paint.
- **Paint bolder than looks right at 1:1.** Features must be 5+ texels thick
  with 2-3 texels of soft feather so mipmaps degrade gracefully — the current
  face smudges are thin, low-contrast strokes that vanish two mip levels down.

## 3. Silhouette and triangle budget (question 1)

The outline of a River character is **a tailored wedge**: designed hair crown,
jaw, a collar V, a shoulder line widened slightly by lapels, sleeves
converging to hands resting at the table edge. From the high-oblique gameplay
camera the crown and shoulders dominate, so the hair mass and the lapel line
matter more than the profile.

Proportions: shoulders +8 to +10 percent over anatomical, head +5 to +8
percent, neck slightly shorter and thicker. This is couch-distance
compensation, not cartooning; past +10 percent the club tone breaks.

**Structural rule that retires two defects at once: body mesh exists only
where skin is visible** — head, neck, and hands with wrist stubs. Delete every
body face under the garment. Poke-through (the 22-24 interior garment
vertices) becomes impossible by construction rather than fixed by offsets, and
the deleted torso refunds roughly a third of the current 6,314 body vertices
to spend where it shows.

Budget, against the existing envelope of 15,178 triangles:

| region | triangles | notes |
|---|---|---|
| head, neck, ears | 3,200 | brow ridge, nose, chin, cheek planes modelled so venue light shades them; ears simple, silhouette only |
| hair (worst-case style) | 1,500 | see section 5 |
| torso garment incl. collar band and lapels | 4,300 | outer shell only, nothing beneath |
| sleeves and cuffs | 1,800 | sleeve ends in a cuff ring, not a raw seam |
| hands, both | 2,400 | 1,200 each: four fingers of 3 segments, thumb of 2, relaxed 15-25 degree curl baked in |
| accent piece (glasses, bow tie, scarf; worst case) | 400 | one per character maximum |
| **total worst case** | **13,600** | ~1,500 headroom kept deliberately for garment variants and safety |

Hands are non-negotiable at this budget: they sit on the table in every frame
at the same screen size as the face, and paddles cost more credibility than
any face defect. The relaxed baked curl also kills the spread-fingers
mannequin pose at the wrist.

The sleeve seam dies structurally: with a long-sleeved garment the only
skin-to-cloth boundary is cuff to wrist, a natural clothing edge, with a
painted shadow just inside the cuff opening.

## 4. The face (question 2)

The face is a painted pattern of five values that must survive at 40 px:
hair, skin, brow band, mouth, socket shadow. In priority order, with paint
values as multipliers of the local skin albedo:

1. **Skin tone** — one of 6 fixed ramp steps (approximate albedo luminance
   0.62, 0.52, 0.44, 0.34, 0.24, 0.16), hue warm throughout, saturation
   rising toward the dark end so deep tones never go grey.
2. **Hairline and hair value** — painted continuation of the geometric hair,
   soft 6-texel transition band at 0.85x skin under the hairline. No hard
   shell edge anywhere.
3. **Brow band** — two strokes at hair colour, 0.40-0.45x skin luminance,
   ~58 x 9 texels each, soft-edged. This is the strongest facial feature at
   distance and the anchor of "a specific person".
4. **Eye sockets** — soft shadow ovals at 0.82-0.85x skin, roughly 35 x 20 mm
   each, plus one dark dot per eye at brow colour. **No whites, no iris
   colour**: a 2-px white flickers and gives a doll stare. Shadowed recesses
   read as composed eyes at this distance; the reference frame's characters
   have no visible eye whites at gameplay distance.
5. **Mouth** — a single line at 0.55x skin, ~58 x 7 texels, flat curvature
   (flat reads composed; upturn reads smirk at 2 px, downturn reads sulk),
   with the lower lip at 0.9x skin and slightly warm.
6. **Facial hair** — painted mass, the second-strongest male identity carrier:
   stubble = 0.75x skin with a cool shift; beard/moustache = hair value with
   a designed, soft edge. Never texture-noise it: one clean shape.
7. **Nose** — no outline. Paint only a soft under-nose shadow at 0.85x; the
   modelled bridge catches venue light.
8. **Warmth zones** — cheeks, nose, forehead, ears +5 to 8 percent warmth.
   Cheapest possible de-plasticiser.

**Drop entirely:** eye whites, iris colour, nostril holes, philtrum, teeth,
lashes, pores, blush detail. Rendering these badly at sub-pixel size is what
makes the current face read as smudges.

Geometry versus pixels: geometry supplies skull, brow ridge, nose, chin,
jawline, cheek planes, ears — the light-catching structure. Pixels supply
everything listed above. No modelled eyeballs, no mouth cavity.

Baked soft occlusion belongs in the atlas wherever two forms meet, because it
is lighting the character owns in every venue: under the jaw onto the neck
(0.7x, 8-10 texel feather), under the collar (0.6x), inside cuffs (0.5x),
under the hair at the forehead (0.85x band), lapel underside, between
fingers. This one painting habit does more against the plastic read than any
geometry change.

Atlas allocation: give the face at least 220 x 220 texels of the 1024 atlas
and each hand at least 96 x 96. Garment blocks are near-flat colour and need
almost no resolution; spend the atlas on skin. (Assumption flagged in
section 9: I could not read the pipeline's current UV layout.)

## 5. Hair (question 3)

The current 110-vertex shell reads as a cap for three reasons: it overhangs
like a peak, its value is uniform and unrelated to any painted hairline, and
its boundary is a hard edge. The fix is not more shells and not cards.

**Approach: a sculpted helmet mass** — 2 to 4 overlapping rounded lumps that
follow the skull tightly, then break the silhouette in one style-specific
place, because at 40 px the silhouette break *is* the hairstyle. Interior is
paint: near-flat dark base with 2-3 broad lighter sweeps (+0.06 to +0.10
luminance) along the flow direction, soft edges, plus the painted hairline
transition from section 4 so mesh and scalp read as one form.

Cost: **250-450 vertices, 500-900 triangles per style** (budgeted at 1,500
worst case). A buzz/crop style is nearly free at ~100 triangles of scalp
shell plus paint.

Worth building, six geometric styles plus bald:

| style | silhouette break | notes |
|---|---|---|
| slick back | tapered crown, no break | the club default |
| side part | ridge line off-centre | part painted as a 0.8x shadow line |
| crop/buzz | none — painted on scalp | ~100 tris |
| quiff | forward-top bulge | the one permitted flourish |
| bob | mass to jawline | primary female style |
| bun/updo | rear knob | second female style |
| bald | none | free, and reads perfectly |

Four painted hair values: black 0.04, dark brown 0.10, auburn 0.18 (warm),
silver 0.55 (cool). Six styles x four values plus bald covers a nine-seat
table without repetition.

**No hats in this pass.** The cap-read must die, and the fastest way is zero
hats until hair demonstrably works; revisit hats later as deliberate rare
accessories, never as the default head covering.

## 6. The garment (question 4)

People at this table wear **tailored evening wear**: a dark jacket or
waistcoat over an ivory shirt for men; a dark dress, blouse, or an ivory
blouse under a dark layer for women; one seat may invert the scheme (ivory
jacket over a dark roll-neck) as the table's single high-value anchor. The
character is a three-step value poster: dark garment mass, ivory triangle,
skin-and-hair head.

Why the white Y fails now, and the construction that replaces it:

1. The Y is painted at near-white on a midtone shirt with no geometry, so it
   reads as a decal; and its stem runs to the navel, drawing the Y. **The
   ivory area must be bounded by geometry: modelled jacket lapels enclosing a
   triangle that ends at the top button, around the sternum.** No painted
   stem below the button stance — the placket within the triangle is a
   single 1-texel-feathered seam line at 0.9x ivory, barely present.
2. **The collar is a geometric band**, roughly 2 cm of ridge, 200-300
   triangles, painted ivory with a 0.6x shadow under the jaw. Double-sided
   material already covers its interior faces.
3. **Ivory is not white**: 0.85-0.90 luminance, warm (R over G over B).
   Nothing on a character is pure white, matching the menu direction's warm
   ivory type. The venue's lighting then has room to push it around.
4. Optional accent inside the V: a painted tie stripe or ~60-triangle bow
   tie, one accent per character at most, in brass, oxblood, or a muted club
   colour.

Garment value spec: jacket/dress blocks at 0.08-0.16 luminance in the club
palette (charcoal, black, midnight green, deep navy, oxblood, dark taupe,
camel, forest). Slight painted AO at seams and under lapels; no patterned
cloth — pattern at this distance is sub-pixel noise and will shimmer.

## 7. Variation across nine seats (question 5)

One material, one 1024 atlas per character, atlases generated per character —
so paint is free variation and mesh variants cost build effort, not draw
calls. Ranked by read-per-cost at 3.2 metres:

| rank | axis | cost | read strength |
|---|---|---|---|
| 1 | garment colour block (8 swatches above) | paint, free | dominant at any distance |
| 2 | skin tone (6-step ramp) | paint, free | strong |
| 3 | hair style (6 geometric + bald) | mesh variant, 100-900 tris | strong, silhouette-level |
| 4 | hair value (4) | paint, free | strong |
| 5 | facial hair (none/stubble/moustache/beard) | paint, free | strong, male seats |
| 6 | garment type (jacket, waistcoat, dress/blouse, roll-neck) | mesh variant, 1-2k tris delta | medium |
| 7 | glasses (thin dark frames, ~150 tris) | small mesh | medium — reads as a dark band across the eyes, instantly identifying; cap at 2 per table |
| 8 | accent piece (bow tie, scarf, pocket square) | 60-400 tris | small but cheap |
| 9 | build (shoulder width +/-6 percent, seated height +/-4 percent) | scale/lattice, free | subliminal but real |

**Not worth building:** cloth patterns, jewellery under 2 cm, tattoos,
painted expression variants, pose variation (rig is undriven; out of scope).

The rule that matters more than any asset: **seat assignment must guarantee
distinctness, not hope for it.** Nine independent random rolls will seat two
navy-jacketed brunets side by side. Constraints:

- no repeated garment swatch at a table until all 8 are used; the ninth seat
  may repeat a swatch only with a different garment type and hair style;
- hair style+value pair unique per table;
- no skin tone more than twice per table;
- at most one ivory-jacket seat, at most two glasses seats.

This costs nothing and converts nine rolls into nine people.

## 8. Expression (question 6)

**Not on the face.** A 2-px mouth cannot carry emotion, and painted
per-emotion faces would burn atlas work invisibly. Every character wears one
resting face: composed, flat mouth line, shadowed eyes — which is "under
quiet pressure" exactly, and it is the correct read for poker.

If expression budget ever exists, spend it on **head aim**: the existing
rig's neck bone, a few degrees of yaw toward the action. Posture motion at
150 px reads at any distance; face pixels do not. Blinks and mouth shapes:
never at this camera. Painted iris-offset gaze is 1-texel territory and
unreliable; skip.

## 9. Unverified, and what would settle it

- **The in-game seated pose and venue lighting.** The proof render is a
  rest-pose studio shot; I could not see a character in the venue at gameplay
  camera. The seated pose should put forearms at the table edge, hands
  loosely together — if it already does, nothing changes. One in-venue proof
  render at the gameplay camera would settle it.
- **Atlas UV layout.** The face/hand texel allocations in section 4 assume
  the pipeline can re-layout UVs; I did not read the pipeline (per packet).
  If the face currently gets fewer than ~220 texels, scale feature
  thicknesses proportionally or re-layout first.
- **Roughness stays scalar at 0.62** per the constraint. If the engine
  accepts a roughness texture on the same material without a second draw
  call, a 1024 roughness map (hair glossier, cloth rougher) is the single
  cheapest material upgrade available — optional, and the design above does
  not depend on it.

## 10. Acceptance test for the next pass

No harness needed. Take the new solo proof render and downscale it until the
face is 40 px tall. At that size, all of the following must be identifiable:
hair mass and style, skin tone, brow band, mouth line, collar V, garment
colour, and (if present) facial hair or glasses. If any fails, raise paint
contrast — not resolution, not geometry. Then place nine generated characters
under the seat-assignment rule and check no two adjacent seats share a
garment swatch or hair read at the same downscale.

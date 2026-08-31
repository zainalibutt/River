# Packet 7H — Cast and wardrobe direction

**Sequencing note, 2026-08-30:** `packet-f3a-character-gold-standard.md`
supersedes this document where the character-first direction conflicts with
7H. This document remains the palette, garment-family and assignment inventory;
it is no longer permission to continue the old dealer-first wave order.

Date: 2026-08-28. Direction: Fable, consolidating Zain's answered design
questions. Implementer: Codex. Status: `BINDING`.

Every aesthetic decision in this document is closed by Zain. Codex implements
without reopening them; an implementation constraint that would change a
decision here routes back to Zain, not into local judgement. This contract
sits inside the existing character laws: the poster-figure construction of
`docs/handoff/character-design.md`, the accepted 7F face bar, the existing
per-character budget (two materials, three draw calls, one 1024 atlas,
15,178-triangle envelope), and the low-poly atlas-driven renderer. Nothing
here adds a material, a draw call, or a runtime system.

Visual sources consulted for this contract: `docs/images/menus_1/README.md`,
`01-main-menu.png` and `03-wardrobe.png` only.

---

## 1. Binding visual thesis

River characters dress for a timeless international casino-club: tailored
evening wear, after dark, under quiet pressure. Modern enough in fit to feel
desirable now, classic enough in construction not to date. The genre is
spy-casino glamour evoked through tailoring, value and restraint — never
through a copied film costume, character likeness or protected design.

The poster construction stands and governs every outfit: a character is a
dark garment mass, one light triangle (ivory shirt or bare skin), and a
designed hair value, readable as a specific person at 110 by 150 pixels.
Glamour is classy but not required to be modest: normal cocktail and
eveningwear cleavage, bare shoulders, open backs, fitted silhouettes and
tasteful leg openings are all permitted. Pornographic styling, novelty
fetishwear and swimwear are excluded at launch. Quality and recognisable
silhouettes outrank customisation count everywhere.

## 2. Preset matrix

Two bases, three body presets, three age presets, two presentation recipes.
No continuous face or body sliders exist anywhere in the system.

| Axis | Values | Implementation | Mesh cost |
|---|---|---|---|
| Base | Masculine, Feminine | The two accepted source meshes on the shared 137-bone rig | 2 |
| Body | Slight, Standard, Broad | Baked proportion lattice at export; garments pass through the same lattice | 3 per base, 6 total baked bodies |
| Age | Young Adult, Established, Older | Atlas paint recipe only | 0 |
| Presentation | Everyday, Glamorous | Atlas paint recipe plus wardrobe-tier and hairstyle weighting | 0 |

Body deltas (applied to body and fitted garment shells in one export pass):

- Slight: shoulders -6 %, torso depth -5 %, limb thickness -8 %.
- Standard: the accepted source, untouched.
- Broad: shoulders +8 % (M) / +4 % (F), torso depth +10 %, upper arms +12 %,
  head and neck +3 % so the jaw keeps pace.

Age recipes (paint only):

- Young Adult: full hair-value pool, default brow weight and warmth.
- Established: mid hair-value pool, slightly heavier brow.
- Older: silver and grey hair values weighted in, thinner cooler brows, two
  broad feathered value bands at under-eye and nasolabial, hairstyle pool
  weighted to side part and bun, quiff excluded.

Presentation recipes:

- Everyday: contract-default face paint, standard grooming, core wardrobe.
- Glamorous: sharper-edged brow strokes, deepened sockets (a smoky read on
  the feminine base), slightly darker warm lip value on F, clean-shaven or
  one designed facial-hair shape on M, hairstyle pool weighted to slick
  back, bun and quiff, wardrobe drawn from the glamour tier and statement
  colours.

Why this is not eighteen bespoke characters: six baked body meshes and five
paint programmes (three age, two presentation) assemble every combination.
Garments are modelled once, on Standard, and inherit the body lattice. A
seat is a roll across closed lists — base, body, age, presentation, skin
step, hair style, hair value, outfit, swatch — and nothing is sculpted or
edited per seat.

## 3. Hairstyle launch set

Seven styles. All are sculpted helmet masses that hug the skull and break
the silhouette in one style-specific place; interiors are paint.

| Style | Silhouette break | Notes |
|---|---|---|
| Slick back | Tapered crown, no break | The club default |
| Side part | Off-centre ridge over a painted 0.8x shadow part line | |
| Crop/buzz | None; painted on a ~100-triangle scalp shell | |
| Quiff | One forward-top bulge | The single permitted flourish |
| Bob | Mass dropping to the jawline, widening below the ears | |
| Bun/updo | Tight crown with a rear knob | Breaks the back profile for cross-table seats |
| Bald/shaved | None | Free, reads perfectly |

Quality requirements, binding per style:

- 250 to 450 vertices, 500 to 900 triangles (crop ~100, bald 0), within the
  existing 1,500-triangle worst-case hair budget.
- Interior paint: near-flat dark base with two or three broad lighter sweeps
  (+0.06 to +0.10 luminance) along the flow direction, soft edges.
- The painted hairline transition band is mandatory: 6 texels, 0.85x skin,
  no hard shell edge anywhere. The hat-brim read is a rejection.
- Four hair values: black 0.04, dark brown 0.10, warm auburn 0.18, cool
  silver 0.55.
- The style must be identifiable at a 40-pixel face height in the downscale
  test of section 13.
- No hats at launch. No strand or card hair, ever.

## 4. Launch capsule overview

Sixteen outfits: six masculine, six feminine, four neutral. The collections
are separate; neutral basics fit either base. The basic divided trouser
shell replaces the current skirt-like default lower garment on every outfit
that does not specify its own lower body. Designed dress silhouettes are
deliberate outfit choices, not defaults — the skirt read is banned as an
accident, permitted as a decision.

The trouser shell: one straight-cut divided cylinder-pair per body family,
plain swatch colour, hem at the ankle, no belt, pocket or crease detail. It
exists to remove the universal skirt silhouette and must not be
over-designed.

## 5. Outfit specifications

Fields per outfit: silhouette; neckline/collar; sleeves; lower body;
materials; colours (swatch names from section 7); geometry; collection;
distance read.

### Masculine

**M1 — Dinner jacket.** The club default: a dark tailored jacket whose
modelled lapels enclose the ivory shirt triangle, ending at the top button.
Neckline: geometric collar band plus lapel V; optional painted tie stripe or
60-triangle bow tie. Sleeves: full length with cuff rings. Lower: trousers
in the jacket swatch. Materials: tailored wool. Colours: black, charcoal,
midnight green, deep navy. Geometry: the new master jacket shell. Collection:
masculine. Distance read: ivory triangle inside a dark mass.

**M2 — Waistcoat.** A dark vest torso over a light shirt with sleeves rolled
to the forearm; bare forearms below. Neckline: open shirt collar. Sleeves:
rolled, ending in a painted fold band. Lower: trousers. Materials: wool vest,
cotton shirt. Colours: vest in charcoal, oxblood, forest; shirt in champagne
(capped, section 6). Geometry: shirt shell plus vest overlay shell.
Collection: masculine. Distance read: light sleeves against a dark torso —
unique in the masculine set.

**M3 — Roll-neck under blazer.** A solid dark column: jacket over a high
knit collar, no light triangle at all. Neckline: roll collar ring insert.
Sleeves: full, cuffed. Lower: trousers. Materials: knit under wool. Colours:
black, midnight green, deep navy; knit may take oxblood. Geometry: reuses
the M1 jacket shell with the shirt insert swapped for the collar ring.
Collection: masculine. Distance read: the only unbroken dark column with a
high collar.

**M4 — Open-collar shirt.** No jacket; a soft shirt with wide collar points
open to a deep V of skin. Neckline: open spread collar, skin V. Sleeves:
full with soft cuffs. Lower: trousers. Materials: silk read. Colours: black,
midnight green, dark taupe, oxblood. Geometry: the masculine shirt shell.
Collection: masculine. Distance read: a skin V where every other masculine
seat shows ivory or nothing.

**M5 — Leather jacket.** A boxier squared shoulder line with ribbed cuff
rings and a raised collar band, worn over a dark painted tee. Neckline:
raised band collar, painted asymmetric zip line. Sleeves: full, ribbed cuff
rings. Lower: trousers. Materials: leather. Colours: black, oxblood, dark
taupe. Geometry: unique mesh. Collection: masculine. Distance read: the
squared shoulder mass and zip line — tailoring's opposite.

**M6 — Topcoat.** A longline overcoat kept on at the table, worn open over
a roll-neck; the widest shoulders and longest lapel line in the room.
Neckline: deep long lapels over a dark inner layer. Sleeves: full, wide
cuffs. Lower: trousers. Materials: heavy wool. Colours: camel, charcoal,
midnight green. Geometry: unique mesh. Collection: masculine. Distance
read: sheer mass plus the only mid-value (camel) masculine garment.

### Feminine

**F1 — Cocktail sheath.** Sleeveless fitted sheath; bare shoulders and arms.
Neckline: bateau or scoop with normal cocktail cleavage. Sleeves: none.
Lower: the sheath body continues over the hips; no trouser shell. Materials:
crepe with a satin read permitted. Colours: black, oxblood, midnight green,
forest; emerald on the glamour tier. Geometry: builds the new sleeveless
skin-arm upper body — the foundation mesh of the feminine glamour line.
Collection: feminine. Distance read: bare shoulders and arms against a table
of sleeves.

**F2 — Evening gown.** Structured neckline over a gown mass; the bare
decolletage triangle is the skin-value inversion of the men's ivory one. An
open-back variant is approved and encouraged: cross-table seats face the
camera with their backs, so an open back is a genuine distance feature.
Neckline: sweetheart or deep V with structured straps, normal eveningwear
cleavage. Sleeves: none. Lower: gown mass; no trouser shell. Materials:
satin. Colours: black, oxblood; emerald on the glamour tier. Geometry: F1's
sleeveless body plus a neckline/gown insert. Collection: feminine. Distance
read: the skin triangle, front or back.

**F3 — Blazer dress.** Sharp-shouldered feminine tailoring with a deep lapel
V closing at a single button. Neckline: deep tailored V, skin or dark inner
layer. Sleeves: full, cuffed. Lower: the dress hem; trouser variant
permitted. Materials: tailored wool. Colours: black, midnight green,
oxblood, dark taupe. Geometry: the feminine tailored shell (the feminine
collection's own jacket master; collections do not share meshes).
Collection: feminine. Distance read: sharp shoulder line plus deep V on the
feminine base.

**F4 — Bow blouse.** A soft light blouse with a tied neck bow; the knot is a
readable shape at table distance. Neckline: high, with the bow knot insert.
Sleeves: full, soft cuffs. Lower: trousers. Materials: silk read. Colours:
champagne, dove, blush grey (all capped, section 6), or a dark swatch with
a light bow. Geometry: the feminine blouse shell plus a small knot insert.
Collection: feminine. Distance read: the only capped-light torso among
players, plus the knot.

**F5 — Slip dress and wrap.** A thin-strapped satin slip with one draped
wrap mass over a single shoulder — the set's only asymmetric silhouette.
Neckline: straight or cowl, normal cleavage; open back permitted. Sleeves:
none; one wrapped shoulder. Lower: slip mass; no trouser shell. Materials:
satin slip, matte wrap. Colours: slip in black, oxblood or emerald
(glamour tier); wrap always a contrasting dark. Geometry: unique mesh.
Collection: feminine. Distance read: asymmetry — one covered shoulder, one
bare.

**F6 — Moto jacket.** A feminine-cut cropped leather jacket over a scoop
top. Neckline: raised band collar over a scoop of skin. Sleeves: full,
ribbed cuff rings. Lower: trousers. Materials: leather. Colours: black,
oxblood. Geometry: unique mesh (not shared with M5; collections are
separate). Collection: feminine. Distance read: squared shoulders plus a
waist crop line on the feminine base.

### Neutral

**N1 — Crew knit.** A plain fitted sweater; one clean torso mass, the
baseline everyman. Neckline: round neck band. Sleeves: full, cuffed. Lower:
trousers. Materials: knit. Colours: full club palette. Geometry: the neutral
torso shell. Collection: neutral. Distance read: the deliberately quiet
seat that makes the others read louder.

**N2 — Hoodie, worn down.** Soft casual volume with a kangaroo-pocket mass
and hood bulk behind the neck. Neckline: hood ring, always down. Sleeves:
full, cuffed. Lower: trousers. Materials: knit. Colours: charcoal, deep
navy, forest, dark taupe. Geometry: unique mesh (the hood bulk cannot be
faked). Collection: neutral. Distance read: the neck bulk — the one
deliberately untailored silhouette.

**N3 — Tee.** The only short-sleeve basic. Neckline: crew band. Sleeves:
short, ending mid-upper-arm. Lower: trousers. Materials: cotton. Colours:
full club palette. Geometry: the neutral torso shell with truncated
sleeves. Collection: neutral. Distance read: bare forearms on an otherwise
sleeved table.

**N4 — Bomber.** Elastic hem and cuff rings with a raised collar ring;
round-shouldered casual. Neckline: raised ribbed collar ring. Sleeves:
full, ribbed cuffs. Lower: trousers. Materials: leather or wool read.
Colours: black, forest, camel, oxblood. Geometry: the neutral torso shell
plus hem, cuff and collar rings. Collection: neutral. Distance read: the
rounded shoulder line and hem band.

## 6. Dealer specification — the ivory statement dinner jacket

The dealer is the table's visual anchor and the only figure in ivory.

- Construction: a unique mesh. Ivory dinner jacket at warm 0.85 to 0.90
  albedo luminance, painted black shawl-lapel trim, black roll-neck
  beneath, painted black bow tie. The 03-wardrobe reference's ivory
  shawl-collar jacket is the register to hit — as a type, not a copy.
- Value logic: the exact inversion of every player. Players are a dark mass
  with a small light triangle; the dealer is a light mass with a small dark
  triangle.
- Exclusivity rule, binding on all wardrobe work: no player garment mass may
  exceed 0.45 albedo luminance. Light shirt and blouse areas (M2, F4, and
  every ivory shirt triangle) are capped at 0.60 and must be bounded —
  enclosed by lapels, a vest, a wrap or rolled-sleeve masses — so no player
  ever presents a full light torso. Only the dealer wears a garment above
  0.60.
- Staging: the dealer sits centre frame under each venue's key light in the
  fixed camera set.
- The ivory jacket never enters player cosmetic pools. Releasing any
  near-ivory player garment is a Zain decision that must name a replacement
  anchor first.
- Acceptance: in the section 13 distance test, a viewer must pick the dealer
  out within one second in all three venues.

## 7. Palette

Sampled from the permitted `menus_1` images with a 5x5 patch average
(labelled sampled, coordinates held in the packet record); the remainder are
visually estimated and labelled so. Sampled values are scene-lit screen
colours: they are hue anchors, not albedo values. Authored albedo must sit
in the stated luminance bands; hue follows the anchor.

Interface-world anchors:

| Anchor | Hex | Status |
|---|---|---|
| Foundation charcoal (menu panel) | `#141413` | Sampled |
| Midnight green-black ground | `#080E0D` | Sampled |
| Night-sky blue-black | `#070D12` | Sampled |
| Brass, dim (selection bar) | `#4D3F2B` | Sampled |
| Brass, lit type | `#796548` | Sampled |
| Brass-champagne fill | `#C1A685` | Sampled |
| Candle amber | `#895D34` | Sampled |
| Ivory garment in scene light | `#C7BDB6` | Sampled |
| Ivory shirt highlight | `#D6CDC6` | Sampled |
| Oxblood velvet highlight | `#442121` | Sampled |
| Midnight navy highlight | `#32313C` | Sampled |
| Suit black in scene light | `#090B0C` | Sampled |

Garment swatches (albedo hue anchors; luminance bands are the authority):

| Swatch | Hex anchor | Albedo luminance | Status |
|---|---|---|---|
| Black | `#0E0E10` | 0.08-0.10 | Estimated |
| Charcoal | `#26262A` | 0.10-0.14 | Estimated |
| Midnight green | `#10201A` | 0.08-0.12 | Estimated from ground anchor |
| Deep navy | `#1A2230` | 0.10-0.14 | Estimated from navy anchor |
| Forest | `#1B3226` | 0.12-0.16 | Estimated |
| Oxblood (statement) | `#4A2024` | 0.12-0.16 | Estimated from sampled highlight |
| Dark taupe | `#3A322B` | 0.14-0.16 | Estimated |
| Camel | `#8A6D50` | 0.32-0.40 | Estimated from brass family |
| Champagne (capped light) | `#CBB9A0` | 0.55-0.60 | Estimated from brass-champagne fill |
| Dove / blush grey (capped light) | `#B8AEA8` / `#C4ABA4` | 0.55-0.60 | Estimated |
| Ivory (dealer, shirt triangles) | `#E8DCC8` | 0.85-0.90 | Estimated from sampled scene ivory |
| Emerald (statement, glamour tier) | `#1E5C46` | 0.18-0.24 | Estimated; green-velvet sample failed |

Statement colours (oxblood, emerald) appear only on glamour-tier outfits.
Brass is an interface and accessory-paint colour, never a garment mass.
Nothing on any character is pure white or pure black.

## 8. Material treatment rules

One material, one 1024 atlas per character, scalar roughness 0.62. Material
identity is faked entirely in albedo paint. Every stroke at least 5 texels
with 2 to 3 texels of feather; nothing sub-pixel at gameplay distance.

- Tailored wool: near-flat albedo; painted ambient occlusion at seams,
  under lapels and inside cuffs; no pattern of any kind (the reference
  pinstripe is explicitly excluded — pattern shimmers at this distance).
- Leather: two or three broad sheen sweeps (+0.08 to +0.12 luminance) along
  the shoulder and sleeve axes, darkened seam lines, soft edges.
- Satin: one soft vertical gradient (plus or minus 0.06) per large panel
  and a single diagonal highlight band; saturation rises in the shadows so
  colour never greys.
- Velvet: darker base value with an edge-darkening band (about 0.85x) at
  panel borders — the inverse of satin's rim — and slight warmth in the
  highlight.
- Knit: a faint broad fleck at 4-texel grain or coarser; cuff, hem and
  collar bands as flat value bands with an occlusion edge, never fine
  alternating lines.

## 9. Build wave one — the four template meshes

1. **Dealer ivory jacket.** Centre of every frame of every hand; nothing
   else is worth polishing first.
2. **M1 dinner jacket.** The default masculine seat and the lapel-triangle
   template the whole tailored family derives from.
3. **F1 cocktail sheath.** Proves the sleeveless skin-arm body that F2 and
   F5 build on.
4. **M5 leather jacket.** The hardest silhouette to fake in paint and the
   strongest nightlife signal in the set.

Each wave-one mesh passes the section 13 acceptance tests before wave two
begins.

## 10. Build wave two — remaining twelve, in dependency order

Shells before derivatives; each derivative lands only after its master
passes acceptance.

1. M3 roll-neck (M1 shell plus collar ring — cheapest strong differentiator).
2. Masculine shirt shell as M4 open-collar; then M2 waistcoat (shirt plus
   vest overlay).
3. M6 topcoat (unique).
4. Feminine tailored shell as F3 blazer dress.
5. F2 evening gown (F1 body plus neckline/gown insert, including the
   open-back variant).
6. Feminine blouse shell as F4 bow blouse.
7. F5 slip and wrap (unique).
8. F6 moto (unique).
9. Neutral torso shell as N1 crew knit; then N3 tee (truncated sleeves) and
   N4 bomber (rings).
10. N2 hoodie (unique).

## 11. Geometry-sharing rules

- One master shell per garment family per collection. Derivatives may only
  add inserts (collars, necklines, bows, vests, rings) or truncate; they
  may never fork the shell.
- A new mesh is justified only when the silhouette change is unachievable
  by insert or truncation. The earned uniques are exactly: dealer jacket,
  M5, M6, F5, F6, N2, and the F1 sleeveless skin-arm body. Seven new meshes
  plus inserts cover all sixteen outfits and the dealer.
- Masculine and feminine collections do not share garment meshes. Neutral
  basics are fitted to both bases through the export lattice, not
  duplicated by hand.
- The trouser shell is one mesh per body family, shared by every
  trouser-paired outfit.
- Budgets unchanged and binding: garment shell within the existing 4,300
  torso plus 1,800 sleeve envelope; accent pieces 400 triangles or fewer;
  hair 1,500 worst case; two materials and three draw calls per character;
  all variation inside the character's single 1024 atlas. Colour, material
  read and age are paint; no per-outfit material datablocks, ever.

## 12. Table-assignment rules

Deterministic per room seed, testable, applied at seat assembly:

1. Walk seats in order from a seeded shuffle of the variant pool. Reject a
   draw that shares its hair-silhouette family or its garment-silhouette
   family with an already-seated adjacent neighbour, including the seat
   nine to seat one wraparound. With seven hair silhouettes and sixteen
   outfits across four families a valid assignment always exists, so
   rejection sampling terminates.
2. No repeated garment swatch until all eight core swatches are used; the
   ninth seat may repeat a swatch only with a different garment family and
   hair style.
3. The hair style-and-value pair is unique per table.
4. No skin-ramp step appears more than twice per table.
5. At most two glasses seats.
6. At most two statement-colour garments (oxblood or emerald) per table,
   never adjacent.
7. No player in ivory; the dealer sits outside every pool with a fixed
   outfit.

## 13. Acceptance criteria

Close range (source proof render):

- Silhouette clean against the outline spec; no body-through-garment
  clipping at collar, shoulders, armpits, cuffs or hem.
- Painted features at 5 or more texels with feathered edges; baked
  occlusion present at every form boundary (jaw, collar, cuffs, lapel,
  between fingers).
- Garment values inside their swatch luminance bands; no pure white or
  black; the accepted 7F face bar intact and the face UV never overwritten
  by cosmetics.

Gameplay distance (downscale the proof until the face is 40 pixels tall):

- Identifiable per character: hair style and value, skin tone, garment
  family and swatch, collar treatment, presentation tier.
- The dealer is picked out within one second as the brightest clothed mass.
- No two adjacent seats share a hair or garment read; no shimmer, banding
  or stripe artefacts.

In venue (all three venues, fixed camera set, after 7G lighting):

- The distance criteria above hold under each venue's measured light rig.
- All venue artefacts pass the existing triangle, material, draw-call,
  texture and download gates; repository tests, typecheck, lint and
  production build pass.
- Chrome inspection of every venue at full occupancy; build logs alone do
  not close the packet.

## 14. Parked expansion

First expansion, already approved, build after the capsule passes
acceptance:

- **Emerald satin evening gown (F).** F2 construction, emerald swatch,
  satin rules, glamour tier, open-back variant.
- **Midnight-green velvet smoking jacket (M).** M1 shell with shawl-collar
  insert, midnight-green velvet rules, glamour tier.

Categories Zain can open later, each through focused design questions:
accessories that read at distance (scarves, pocket squares, gloves —
nothing under roughly 20 mm); eyewear beyond the two-per-table thin frames;
hats, parked until hair has demonstrably killed the cap read; outerwear
breadth; gown length and slit variants within the approved modesty bounds;
cultural and regional evening wear; venue-specific capsules; REP or
status-tied cosmetics.

## 15. Do not build

- Continuous sliders of any kind, face or body.
- Strand or card hair; cloth simulation; runtime body or face morphing.
- Jewellery or detail below roughly 20 mm — it is sub-pixel at the table.
- Patterned cloth, including the reference pinstripe; logos or branding;
  franchise or film-costume copies.
- Swimwear, fetishwear, novelty costumes, pornographic styling.
- Per-emotion face variants; painted eye whites or irises.
- New materials, roughness maps, extra draw calls or a second atlas per
  character.
- Hats at launch.

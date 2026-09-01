# F3A — character gold standard

Date: 2026-08-30. Owner: Codex. Status: `REVIEW` — native gold proof
published; visual acceptance remains with Claude and Zain.

## Current checkpoint — 2026-09-01

The source and Rooftop integration are now a working vertical slice, not a
finished gold character. The source carries the authored female identity,
geometric eyes, six facial shape keys, seated/action scaffolding, the controlled
ponytail and the first red evening-gown treatment. Rooftop preserves the hero
source meshes and textures through an explicit browser PBR translation and
passes at 58,110 triangles, 30 materials, 46 draw calls and 6,096 KB.

Chrome confirms better face readability and actual hairstyle variation, but
also keeps the remaining gate honest: the crop/receding hairlines still expose
large graphic scalp shapes, the garment remains body-derived rather than a
tailored capsule, and the full-table review does not give the seat-zero gold
character a front close read. These are the next acceptance defects; broad cast
multiplication remains blocked.

This packet is the binding character-first replacement for the unfinished visual
parts of F2 and the earlier 7H sequence. Zain explicitly prioritised proper
people before recovery polish, controller acceptance, deferred venues or broad
cosmetic multiplication.

The first deliverable is one complete glamorous female player. It is not a
generic base body and it is not one ninth of a batch. It must prove the final
face, body, seated posture, hair, outfit, material, rig, animation and Rooftop
rendering method before the cast multiplies.

## 1. Source authority

Use sources in this order:

1. Zain's decisions recorded in this packet.
2. The hand-captured stills in the local capture kit under `docs/images/`
   (gitignored - reference material, studied but not redistributed).
3. The curated 121-frame library and its `REFERENCE_MANIFEST.md`.
4. `spec/RIVER_REFERENCE_ANSWER.md` and the reusable portions of the previous
   7H wardrobe contract.
5. Existing proof renders and pipeline code as evidence of current state, not
   as a visual ceiling.

Do not inspect, sample or transcribe the 20-minute recording during F3A. The
curated stills already answer the packet. Reference imagery is private style
evidence and must never be shipped as River assets.

One extraction claim is explicitly rejected after visual inspection: the file
named `camera_winner_closeup_grey_backdrop.png` still shows the dark venue. A
neutral presentation backdrop is evidenced by the head and wardrobe editors,
not by that winner frame. A River winner cut may later adopt a neutral backdrop
as an original direction, but the reference is not evidence that it does so.

## 2. Visual thesis

River's characters are slightly more anatomically grounded and materially
refined than the reference, while retaining clear casino-game silhouettes and
expressive body language. They are not photoreal and not caricatures.

The world, lighting, music and tailoring carry the timeless Bond-club tone.
Players may be more expressive than the reference without turning ordinary hands
into novelty emotes. Attractive characters target polished Bond-film glamour:
credible skulls and bodies, strong grooming and styling, no giant eyes,
superhero jaws or doll anatomy.

The construction law is authored identities with variable, coherent outfit
capsules. A person remains recognisable across clothing changes. Runtime random
faces are excluded.

## 3. Gold character

The first accepted character is a glamorous female player.

Recommended initial identity, subject to Zain's proof approval:

- late twenties to mid-thirties;
- medium-deep warm skin, testing the shader beyond the current pale proof;
- structurally attractive rather than exaggerated;
- dark sculpted shoulder-length wave or polished bob;
- restrained evening makeup with readable brows, lids, lashes and lips;
- red asymmetric cocktail/evening dress with coordinated heels;
- confident, expressive and socially present at the table.

The initial choice deliberately exercises skin response, dark hair, face
contrast, a sleeveless garment, fitted seated deformation and a statement
material in one asset. No alternate character starts until this one passes all
proof views and Chrome.

## 4. Cast direction after the gold character

The first authored cast is directional rather than a rigid demographic grid:

- normal man;
- normal woman;
- affluent older man;
- scruffy older man;
- wealthy business woman;
- exceptionally attractive woman;
- cowboy;
- cowgirl.

Offset or merge an archetype when silhouette, age or gender balance benefits,
but do not fill a table with eight variations of one young face. The cast must
span light, medium and deep skin values; varied apparent ancestry; young adult,
established and older ages; and both quiet and statement styling. No ethnicity
is permanently tied to wealth, glamour or scruffiness. Review the assembled
line-up for balance rather than assigning one token identity per category.

Masculine and feminine base heights remain relatively uniform for animation and
table contact. Masculine and feminine averages may differ, with only restrained
per-character variation. Initial body presets remain slight, standard and
broad/full. Age must affect geometry and materials; it is not an under-eye
paint stripe.

## 5. Preserve and replace

Preserve:

- the MPFB-derived human topology as the starting source;
- the shared 137-bone rig and measured River scale;
- full legs and articulated hands;
- deterministic Blender generation, named GLB export and negative gates;
- seat-relative placement and the existing runtime animation transport;
- the 250,000-triangle scene ceiling, 120 draw-call ceiling, 128 MB texture
  budget and 2048 maximum texture dimension.

Replace or materially revise:

- paint-only face differentiation;
- the hard helmet/bowl hair shells;
- body-derived garment boundaries and jagged hems;
- single-axis sine animation as final motion;
- the one-shape-fits-all torso and accidental skirt reads;
- the assumption that a 1024 colour atlas is a sacred quality limit.

The source-character ceiling remains 23,000 triangles until measurement proves
it insufficient. Headroom should be spent on visible facial, hand, hair and
garment silhouette quality. Do not weaken the scene gate to fund it.

## 6. Face standard

Start from the isolated MPFB source with hair and clothing removed. Use the
existing morph system to author and bake a recognisable head before reduction.
The gold face requires front, three-quarter and true profile proof renders under
flat neutral lighting, followed by the Rooftop camera proof.

Required close-read anatomy:

- separate upper and lower eyelids with a stable eye opening;
- sclera, iris and pupil carried by geometry/material, never painted dots;
- brows separated from the eye socket;
- readable nasal bridge, nostrils and alar shape;
- philtrum, two-lip volume and mouth corners;
- cheekbone-to-jaw transition and a credible ear-to-jaw hinge;
- no forehead seam, mask band, atlas boundary or hair-shell shadow.

Build six minimum facial expression shapes or an equivalent bone solution:
blink left, blink right, soft smile, frown/frustration, brow raise and mouth
open. They survive export and are exercised in one expression sheet. Retaining
animation-ready face shapes takes priority over baking every source morph away.

Skin must gain restrained roughness and normal variation. A 2048 colour atlas
and shared normal/roughness textures are permitted if measured texture memory,
materials and draw calls remain inside the existing gates. One material may
reference multiple textures; do not add material slots merely to separate face
features.

## 7. Body and hands

The base should be slightly more realistic than the reference: believable shoulder
width, ribcage, pelvis, limbs, knees, ankles, wrists and hands without fashion-
illustration elongation. Preserve relatively uniform height and adjust mass
through controlled torso, hip and limb changes.

Hands remain load-bearing. They need tapered fingers, a credible thumb root,
stable knuckles and enough spread for cards and chips. Exact finger-to-chip
simulation is unnecessary. A convincing general card protect, check, muck and
push gesture is sufficient.

## 8. Neutral pose and motion

Author the neutral seated pose first from
`seated_neutral_hands_clasped_front.png`,
`seated_profile_forearms_on_rail.png` and the manual neutral captures.

The pelvis sits in the chair. The spine inclines from the hips rather than
folding at the waist. Shoulders stay lowered, forearms meet the rail, knees sit
below the table and feet contact the floor. Hands may clasp or rest
asymmetrically; they are never left in an A-pose beside the body.

Every other seated pose is a delta from that neutral. The first accepted motion
set is:

1. seated breathing and small gaze shifts;
2. card protect/peek;
3. check/tap;
4. call and chip placement;
5. bet/raise push;
6. fold/muck;
7. restrained win;
8. restrained frustration;
9. all-in rise and hold;
10. standing dealer idle, physical deal and pot sweep.

Use multi-bone, multi-axis curves with anticipation and recovery. The current
single-axis sine clips remain scaffolding only. One character may select from
several restrained reactions, with `win_smug_point_forward.png` as the tone
ceiling for ordinary play. Large celebrations remain cosmetic emotes.

## 9. Hair and headwear

Hair uses solid sculpted masses with baked strand direction and no alpha-card
sorting. Model the front, profile and three-quarter silhouette before surface
detail. A painted transition alone cannot rescue a shell that reads as a cap.

Gold hair is one accepted shoulder-length wave or polished bob. The next set is
side part, textured crop, slick-back, bob, loose wave, controlled ponytail,
updo, mature/receding and bald. Facial hair follows as complete groomed meshes.

Cowboy and cowgirl capsules make hats a launch requirement, superseding 7H's
hat deferral. Every hat outfit specifies a compatible hair variant or hides the
occluded hair region. Hats may not simply intersect a full hairstyle.

## 10. Outfit capsules and cosmetics readiness

The player chooses complete coordinated outfits. Technical slots exist beneath
the capsule only to support fitting, future expansion and equipment transport.
The initial slot contract is:

- body and head identity;
- hair or hat-compatible hair;
- headwear;
- face accessory;
- complete outfit shell;
- footwear;
- small identity accents such as makeup, facial hair, jewellery or glasses.

A capsule owns its silhouette, coordinated pieces and compatibility rules. Red
dress means the dress plus appropriate heels. Cowgirl means hat-compatible
hair, hat, western top and bottom or dress, belt and boots. Cowboy receives the
same complete treatment. Players do not assemble visibly incompatible halves.

Approved early capsules include dinner and velvet jackets, business tailoring,
open-collar and waistcoat looks, leather jacket, red cocktail dress, long
evening gown, tailored business outfit, smart casual, cowboy and cowgirl. Short
cocktail and full-length dresses are both approved. Bare shoulders, open backs,
thigh slits and standard eveningwear cleavage are inside the classy club bound.

Accessories, tattoos, scars, glasses, makeup, facial hair and jewellery are
cosmetics rather than requirements of every base. Watches, earrings, necklaces,
rings and glasses follow the gold outfit; gloves are outfit-specific.

Build garments as authored clean topology around the body, not irregular
dominant-weight extractions left as final hems. Clothing must pass standing,
neutral seated, lean, reach, all-in and winner poses without body breakthrough.
Delete hidden body faces only after the garment passes those poses.

## 11. Gold proof sequence

No nine-seat rebuild occurs during steps 1–7.

1. Isolate and render the current female source without hair or clothing.
2. Author and approve the gold head and body in front, three-quarter and profile.
3. Author and approve the neutral seated pose and hand placement.
4. Author and approve the gold hair in the same three proof views.
5. Author and approve the red dress capsule standing and seated.
6. Replace the scaffold curves for the minimum player action set and render a
   bounded frame strip for each critical motion.
7. Export one GLB, parse it, run the character gates and inspect the proof.
8. Integrate only that character into one Rooftop seat and inspect in Chrome at
   default, side and close cameras.
9. Downscale the face to gameplay size and confirm eyes, mouth, hairstyle and
   identity remain legible.
10. Only after Zain accepts the integrated gold character may the recipe expand
    to other authored identities and capsules.

Every rejected proof returns to its source layer. A bad hair proof does not
trigger venue rebuilds; a bad dress does not reopen the face.

## 12. Acceptance gates

The gold character passes only when:

- front, three-quarter and profile anatomy read as the same attractive person;
- eyes, brows, nose and mouth remain legible in the gameplay downscale;
- neutral expression is alive rather than blank, with no painted face mask;
- hair reads as hair from front and side and has no cap edge;
- the seated body is planted in the chair with believable rail and floor contact;
- dress, skin, hair and heels do not visibly intersect in critical poses;
- at least blink, soft smile and frustration survive GLB export;
- the action frame strips show weight, anticipation and recovery;
- Chrome shows the same accepted identity under Rooftop lighting;
- parsed GLB and venue assets pass triangles, materials, draw calls, texture,
  bones, clips and download gates by exit code.

## 13. Model and external-resource routing

Codex owns Blender pipeline integration, proof renders, parsed artefact checks
and Chrome acceptance. Fable receives no exploratory repository packet. Use it
only after a concrete proof exists, with a fixed set of at most four images,
named files, one visual redline deliverable and a strict call ceiling.

External assets may be evaluated as construction references or properly
licensed source candidates, but River's shipping character must remain
regenerable from the repository. No purchase or third-party dependency is made
without Zain's explicit approval.

## 14. Superseded 7H decisions

The previous 7H palette, dealer value hierarchy, outfit-family inventory and
assignment safeguards remain useful. The following are superseded where they
conflict with this packet:

- dealer-first implementation order;
- face and age variation by atlas paint only;
- fixed authored identities replaced by random rolls;
- 1024 as an immutable atlas limit;
- no facial expression variants;
- hats deferred beyond launch;
- one scalar roughness treatment as the final material standard;
- source-derived garment boundaries accepted as final clothing.

F3A is complete when one gold character is accepted in Chrome, not when the
full roster exists.

## 15. Execution tracker

Status on 1 September 2026: **REVIEW**.

- [x] Replace the ineffective post-creation gender flag with MPFB macro-detail
  construction. Male and female now have genuinely distinct source geometry.
- [x] Replace the deleted eye-helper stack with fitted sclera, iris, pupil and
  catchlight geometry, weighted to the head bone and exported as one material.
- [x] Produce bounded female face proofs at front, three-quarter and profile:
  `art/out/proofs/gold-face-front.png`,
  `art/out/proofs/gold-face-three-quarter.png` and
  `art/out/proofs/gold-face-profile.png`.
- [x] Rebuild both GLBs by exit code. Female evidence: 17,988 triangles, 0.874
  quad ratio, 137 bones, nine clips and no character gate violations.
- [x] Inspect the rebuilt table in Chrome at
  `/dev/visual-review?build=f3a-face-foundation`; localhost loaded without a
  River application error and the handoff tab remains open.
- [x] Trust-the-process approval recorded for the glamorous female identity
  sculpt. The deterministic v1 recipe applies 26 MPFB targets across head
  shape, eyelids, cheekbones, nose, lips and chin. This approves continuation,
  not final character acceptance; the remaining layered-triangle read must be
  judged again with finished hair, materials and expression.
- [x] Author six facial morphs: blink, soft smile, frustration, squint, smirk
  and surprise. Neutral, blink, soft-smile and frustration proofs were rendered
  from the re-imported GLB under `art/out/proofs/gold-expression-*.png`.
  Reference-level facial response remains an explicit animation-quality
  requirement; these export-safe shapes are its foundation, not the finished
  performance pass.
- [x] Author and proof the planted neutral seated posture and inward hand
  placement in `gold-pose-front.png`, `gold-pose-profile.png` and
  `gold-pose-table.png`. Poker-action pose variation remains in the motion pass.
- [ ] Replace the scalp seam with approved sculpted hair after the face is
  accepted. The asymmetric bob now fits the gold head, the fragile crown n-gon
  was replaced with explicit topology, and shared hairstyle envelopes no longer
  expose the scalp in Chrome. Final strand breakup and the accepted salon
  silhouette remain open; a rigid lock-mass experiment was rejected and removed.
- [ ] Approve the red-dress capsule. The standing and seated foundation proofs
  now read as one oxblood gown with dark heels under
  `art/out/proofs/gold-outfit-*.png`, but the neckline, waist join and hem still
  need authored couture topology before acceptance.
- [x] Integrate the current gold foundation into Rooftop only and inspect it in
  Chrome at `/dev/visual-review?build=f3a-hair-fit-v2`. The accepted build keeps
  morph targets on the gold female while flattening and LOD-reducing the
  background cast. The faithful static review now serves the native skin,
  dress, eye, brow, lash and ponytail textures at 58,110 triangles, 30
  materials, 46 draw calls and 6,096KB. Laundromat and Executive Suite were
  not rebuilt or published.
- [x] Build the reproducible CC0 MakeHuman native source proof and preserve the
  approved glamorous identity in front, three-quarter, profile and seated
  renders. Faceunits01 now supplies clean blink, soft-smile and frustration
  targets; all four states are visible together in the retained Chrome proof.
- [x] Produce and parse a bounded native GLB candidate. Identity construction
  targets are baked into the base, the three required expressions remain as
  named morphs, texture dimensions are capped at 1024, and the result passes at
  22,183 body triangles, 137 bones and 3.5MB.
- [x] Match MPFB's render-only modifier stack during glTF export. This removed
  the helper/proxy strips, preserved the seated dress and produced a clean
  hair-deferred Rooftop close frame in Chrome.
- [x] Refine the native gold identity against the Prominence face references
  and Zain's eye-area redline. The recipe now uses a tapered lower face, a
  reduced almond eye opening, narrower and longer nose and restrained lip
  volume. The isolated native render is the binding visual source; the later
  substitute browser face, eye and hair geometry was rejected rather than
  refined further.
- [x] Replace the eye-covering bob in the active proof with a controlled
  ponytail so both eyes remain judgeable from front and profile. Chrome now
  carries the seated proof's real skin, dress, brown-eye, brow, lash and
  ponytail textures instead of the flattened browser-safe replacements. A
  deliberate glTF translation layer supplies browser PBR materials, the
  Blender hair tint and a fitted brown iris while preserving the approved
  meshes. The isolated Rooftop passes at 58,110 triangles, 30 materials, 46
  draw calls and 6,096KB.
- [ ] Finish the corneal-occlusion and gameplay-lighting match, then decide
  whether the remaining temple transition warrants an atlas/mesh edit before
  Rooftop acceptance. The rigged 3.8MB source candidate separately passes with
  22,183 body triangles, 137 bones and the three named expression morphs.
- [ ] Continue the remaining gold proof sequence in section 11.

The current proof is a completed foundation pass, not F3A acceptance. It is
deliberately not multiplied across the cast.

READY FOR CLAUDE

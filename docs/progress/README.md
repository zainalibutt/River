# Progress captures

Every venue image here is a Blender render produced by `art/pipeline/` from
committed code. Nothing in a venue is hand-modelled and nothing is touched up.
The same commit regenerates the same frame, which is the point: the venues are
the pipeline, not a `.blend` file on somebody's drive.

Characters are different from 40 onward, because character pose and fit are now
made by hand (see `DECISIONS.md`). Each of those entries says where its frame
came from - committed pipeline code, a lane's proof pass, or a `.blend` worked
by hand - and whether the repository can regenerate it. Frames are cropped and
downscaled to keep them small; none is retouched.

Numbered in the order taken. The debugging sequence is kept because the wrong
frames are more useful than the right ones.

The numbered captures are curated visual evidence and are intentionally tracked
here so the progression is visible in a fresh checkout. They are small review
snapshots, not runtime artefacts; the full generated output under `art/out/`
remains ignored.

## 01-04 — the room that was not empty

| | |
|---|---|
| `01-rooftop-empty.png` | The Rooftop from the measured play camera: a bare cream disc. Table, chairs and nine characters all verified present and correctly positioned. |
| `02-rooftop-workbench.png` | The same frame in Workbench, which renders geometry with flat shading and ignores lighting entirely. Identical result, so lighting was ruled out. |
| `03-rooftop-revealed.png` | `cylinder()` always closed its top, so the parapet had sealed a solid 3.9m lid over the venue. One parameter later, the room. |
| `04-rooftop-prop-pass.png` | After judging the room: braziers instead of clipped white spheres, string lights ringing inside the parapet, short potted palms clear of the camera orbit. |

## 10-15 — the three launch venues

Each venue at the measured orbit camera it will actually be played from, and
from a wider establishing angle. Camera values come from
`docs/design/14-venue-build-spec.md`.

| | |
|---|---|
| `10-rooftop-play.png`, `11-rooftop-wide.png` | The Rooftop. City skyline, parapet, string lights, braziers. |
| `12-laundromat-play.png`, `13-laundromat-wide.png` | The Laundromat. Machine banks, counter, fluorescent strip lighting, one soft shadow caster. |
| `14-suite-play.png`, `15-suite-wide.png` | The Executive Suite. Warm chandelier key, balustrade with turned balusters, dining chairs with crest rails. The strongest of the three. |

## Known defects visible in these frames

Recorded rather than hidden, because they are the next work.

- **Characters have no faces.** Hair renders as jagged stringy geometry over the
  head, and arms sit close to a T-pose rather than resting on the table. Most
  visible in `12-laundromat-play.png`.
- **Garment edges are ragged** where the vertex-group selection ends, with no
  hem or weight-threshold falloff.
- **The Suite balusters blow out to white pillars**, dominating an otherwise
  strong frame.
- **The Suite felt reads pale** where it should be dark.
- **The Rooftop venue is built at roughly 62 percent of its designed scale**, so
  every prop radius in the build spec is wrong for the pipeline.

## 20-23 — the night the rooms became rooms

Between 15 and 20 the venues were rebuilt three times, the characters four, and
the browser was found to be rendering something the Blender frames never showed.

| | |
|---|---|
| `20-rooftop-night.png` | The Rooftop with baked ambient occlusion in vertex colours, a dark wet-concrete terrace, and palms that are palms. 71,343 triangles against a gate of 250,000. |
| `21-laundromat-night.png` | The Laundromat. Reachable in play for the first time here - every table the server created had been in the Rooftop, so two of three venues existed as assets nobody could sit in. |
| `22-suite-night.png` | The Executive Suite. |
| `23-character-face.png` | A seated character at 2.6 metres. Brow, eye sockets, nose, jaw, a lash line and a hairline band, on an MPFB body with a 137-bone rig and nine authored poker clips. |

### What 23 actually cost

Four packets went into building faces out of scaled spheres, each one slightly
better and none of them right. The base character had a face the whole time. It
was buried under hair geometry authored as alpha cutouts and exported without
any texture, so it rendered as opaque ribbons hanging over the features. Every
replacement face was being bolted onto the outside of a head that was only ever
occluded, and one frame shows the real hands with fingers at the edge of the
shot beside the primitive ones built to replace them.

Deleting all of it took the Rooftop from 94,537 triangles to 62,499 and produced
a person.

**The intermediate frames from that sequence were not kept.** They were reviewed
and discarded, which was a mistake - the wrong frames are the useful ones, as
01-04 demonstrate. Every character and venue render is captured here from this
point on, whether or not it is any good.

## 24+ — the native gold character vertical slice

From 30 August to 1 September the character lane was rebuilt around one
authored source rather than a multiplied placeholder cast. The reproducible
proofs are generated by `art/pipeline/build_native_gold_proof.py`,
`art/pipeline/export_native_gold.py` and the bounded seated/static review
scripts. The selected review snapshots are now included below; the full
generated output remains under the ignored `art/out/proofs/native-gold/`
directory.

| Capture | What it proves |
|---|---|
| `24-native-gold-face-before.png` | Earlier bob-hair face baseline retained for comparison. |
| `25-native-gold-face-before-three-quarter.png` | Earlier three-quarter hair/face baseline. |
| `26-native-gold-portrait-front.png` | Current native skin, eye treatment, red dress and sculpted hair from front. |
| `27-native-gold-portrait-three-quarter.png` | Current identity and hair silhouette from three-quarter. |
| `28-native-gold-profile.png` | Profile continuity, ponytail placement and dress silhouette. |
| `29-native-gold-wardrobe-three-quarter.png` | Full outfit capsule and material response. |
| `30-native-gold-seated-front.png` | Planted seated posture, chair contact and table clearance. |
| `31-native-gold-seated-table.png` | Seated hands, rail/table relationship and playable framing. |
| `32-native-gold-expression-blink.png` | Exported blink shape. |
| `33-native-gold-expression-soft-smile.png` | Exported soft-smile shape. |
| `34-native-gold-expression-frustration.png` | Exported frustration shape. |

The current static Rooftop proof parses to 58,110 triangles, 30 materials,
46 draw calls and 6,096 KB. The six original character meshes are retained and
the browser material layer is explicit, so a Blender-only render cannot drift
away from what Chrome displays. The remaining proof gates are corneal
occlusion, gameplay-lighting match, the temple transition, couture garment
termination and authored poker-motion deltas. The other two venues and the
remaining cast stay deferred until this gold character is accepted.

This is the first progress entry that describes the character source actually
served by the app. Earlier entries remain valuable as the record of the
placeholder and debugging sequence rather than as the current visual state.

## 40-46 — the silver male, Amber, and the pose that moved to a person

From 7 to 13 September. The silver character's pipeline build, its black-tie
wardrobe and seated passes, Amber, and the first frame of a character posed by
hand. The narrative is in `PROGRESS.md`.

| Capture | What it shows | Source | Regenerable from the repository |
|---|---|---|---|
| `40-silver-hair-conform-rear.png` | The production hair cut from rear-left and directly behind, before and after the conform: the shell buried in the skull, then covering it. | `art/pipeline/diagnose_hair_coverage.py`, 7 Sep | Yes |
| `41-silver-standing-black-tie.png` | The accepted standing black tie, A11, after its light and material finish: face, both three-quarters, profile, rear and gameplay bust. | Astra proof pass A11, 10 Sep | No |
| `42-silver-seated-jacket-breakthrough.png` | The wrong frame kept from the seated jacket work: in the seated pose the jacket opens at both shoulders from behind. It is the frame that led to a seated state of its own. | Astra proof pass A19, 10 Sep | No |
| `43-silver-seated-default-pose.png` | The accepted seated default pose, A22: profile, front and rear, shoulders covered. | Astra proof pass A22, 10 Sep | No |
| `44-amber-seated-proof.png` | Amber seated at the rail from the front and both three-quarters, built by DeepSeek. An isolated proof, not in the venue. | `art/pipeline/build_native_amber.py`, 12 Sep | Yes |
| `45-silver-a38b-rail-rest.png` | A38b at frame 0, the last lane candidate: a centred hand-over-hand rest. Not accepted; the true side shows the forearms rising toward the hands. | Astra proof pass A38b, 12 Sep | No |
| `46-silver-a38b-hand-edited.png` | A38b worked by hand - bones posed directly, edges smoothed, a corrective shape key at the right armpit - at frame 0 from the front, both three-quarters, both sides and the rear. Work in progress. | Hand-worked `.blend`, rendered 13 Sep | No |

## 50-51 — the Rooftop table, and the city around it

From 19 September. The narrative is in `PROGRESS.md`.

| Capture | What it shows | Source | Regenerable from the repository |
|---|---|---|---|
| `50-rooftop-table-dressed.png` | The Rooftop table under the venue's own light rig. Top, before and after its dressing pass from a player's seat: the wrong frame is kept because it decided the pass, a table that read as a dark hole. Below, after: the printed felt from above, and the dealer's rack, shoe and discards. | `art/pipeline/render_venue_review.py` on the published GLB before and after, 19 Sep | Yes |
| `51-rooftop-skyline.png` | The skyline before and after it was rebuilt, under the browser's own sky dome: from the play camera, then looking out east from the table. Before, towers twenty to forty-five metres out that filled the strip above the parapet; after, the city at real distances with its tops, crowns, masts and haze inside the strip. | `art/pipeline/render_venue_review.py --views skyline` on the published GLB before and after, 19 Sep | Yes |

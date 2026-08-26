# Progress captures

Every image here is a Blender render produced by `art/pipeline/build_assets.py`
from committed code. Nothing is hand-modelled and nothing is touched up. The
same commit regenerates the same frame, which is the point: the venues are the
pipeline, not a `.blend` file on somebody's drive.

Numbered in the order taken. The debugging sequence is kept because the wrong
frames are more useful than the right ones.

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

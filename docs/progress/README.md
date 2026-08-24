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

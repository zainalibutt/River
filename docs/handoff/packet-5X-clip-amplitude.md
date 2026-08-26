# Packet 5X — The clips move nothing anyone can see

**Owner:** Codex. **Reviewer:** Claude.

Read `docs/handoff/codex-laws.md` first.

5W is committed at `877c841`. Good work, and it has not reached anybody yet —
see step 0.

---

## Step 0 — republish, before anything else

**Your 5W fix is invisible in the browser.** The before/after you rendered came
from the freshly exported GLB in `art/out`. The application serves
`apps/web/public/assets`, which is a different directory and still holds the
pre-5W build. Measured today:

| Venue | Served | Built |
|---|---|---|
| Rooftop | 4,576,064 | 4,576,396 |
| Basement | 4,419,704 | 4,420,112 |
| Suite | 4,767,192 | 4,767,440 |

Run `publish_assets.py`, then **check the byte counts actually changed** in
`apps/web/public/assets`. Do not take the script's exit code for it.

This has cost this project two days once already, when every skyline change was
invisible for a week against a stale 206KB asset. It is also why the palms still
look blue in a real browser while your render shows them correct.

---

## What was found, and how

The client half of the animation is fixed and proven: all nine rigs bind, all
33,291 tracks resolve, and nine characters are now driven instead of one. The
faults below are in the generated clips themselves, measured in the browser
against the shipped Rooftop GLB.

**A full `IDLE_breathe` cycle rotates the head by 0.099 degrees.**

Sampled 26 times across 5.2 seconds on a bound rig, taking the maximum angle
between any two samples. Spine02 measured 0.079 degrees. A tenth of a degree of
head rotation moves the crown of the head by roughly a third of a millimetre.

That measurement agrees exactly with the source, which is how it is known to be
the clip rather than the playback. In `art/pipeline/build_characters.py:387`:

```python
'IDLE_breathe': [('spine01', 0.03, 0.5), ('spine02', 0.04, 2.1), ('head', 0.05, 2.0)],
```

The middle number is degrees, passed through `math.radians`. A head amplitude of
0.05 degrees is a peak-to-peak swing of 0.10 degrees. Measured: 0.099.

## Defect 1 — every arm and leg track silently keyframes nothing

`generate_clip` looks its targets up by name:

```python
pose_bone = armature.pose.bones.get(bone_name)
if pose_bone is None:
    continue
```

The track table names bones as `upperarm01.R`, `lowerarm01.L`, `upperleg01.L`.
**No bone on this rig has a dot in its name.** Confirmed against the shipped
asset: 1,233 bone names in the Rooftop venue, and the count containing a `.` is
zero. The rig names them `upperarm01R`, `lowerarm01L`, `upperleg01L`.

So `.get()` returns `None`, `continue` runs, and the keyframe is never inserted.
No exception, no warning, and the exporter still writes 411 tracks per clip
because it bakes every bone whether or not it was keyed. The clip looks complete
in every count anyone has taken.

What that costs, clip by clip:

| Clip | Intended targets | Actually keyed |
|---|---|---|
| `PRESET_reach` | upperarm01.R, lowerarm01.R | **nothing** |
| `CHIP_toss` | upperarm01.R, lowerarm01.R | **nothing** |
| `DEAL_toss` | upperarm01.L, lowerarm01.L | **nothing** |
| `ALLIN_standup` | both upper legs, spine01, head | spine01, head only |
| `PEEK_card` | head, lowerarm01.L | head only |
| `REACT_win` | head, spine01, upperarm01.R | head, spine01 |
| `REACT_lose` | head, spine01, upperarm01.L | head, spine01 |
| `FOLD_muck` | head, lowerarm01.R | head only |
| `IDLE_breathe` | spine01, spine02, head | all three |

**Three clips are entirely empty.** A chip toss moves no arm. A deal moves no
arm. The all-in stand-up does not use its legs.

## Defect 2 — the amplitudes are an order of magnitude too small

Even where a bone is found, the numbers do not read at table distance:

- `IDLE_breathe` head: **0.05 degrees**
- `PEEK_card` head: 0.35 degrees
- `ALLIN_standup` upper legs: 12.0 degrees — and this is the largest value in
  the table, for the signature moment of the whole game

Twelve degrees of hip rotation is a lean, not a person standing up. Everything
else is between a twentieth and a third of a degree.

## What to do

1. **Fix the names.** Correct the track table to the names the rig actually
   carries. Do not add a fallback that strips dots — make the table right.
2. **Add a gate that fails the build when a target is missing.** This is the
   heart of the packet. The current `continue` is precisely the silent-absence
   shape that has now produced six wired-to-nothing modules on this project. A
   named bone that does not exist is a build error, not a skip.
   Per law 5, prove the gate fires: run it once against a deliberately wrong
   bone name and confirm the build exits non-zero.
3. **Raise the amplitudes until the motion reads**, and verify by rendering a
   frame strip of the extremes for each clip, not by reading the numbers back.
   A stand-up should leave the chair. Breathing should be visible but not
   theatrical — a degree or two of spine, not a twentieth.
4. Rebuild and **republish again**, the same way as step 0 and with the same
   byte-count check. A correct clip that never leaves `art/out` is worth
   nothing.

## What not to do

- **Do not touch `apps/web/`.** The client retarget is committed and proven and
  is not yours. If the clips still do not move after a republish, report it.
- Do not weaken the download-size or triangle gates to fit larger clips. If a
  budget genuinely blocks correct animation, stop and report it — that is a real
  decision, not a number to adjust.

## Verification

**Blender is not the reference surface here.** Four faults have shipped on this
project because they were checked in the renderer that does not exhibit them. A
frame strip out of Blender is fine for judging whether a pose reads; it is not
evidence that the clip reaches the browser.

The browser answer is one line, with the venue open in real Chrome:

```js
window.riverRigs
```

`boundTracks` must stay at 33,291 for the Rooftop — nine rigs times nine clips
times 411 tracks. If it drops, the export changed the bone list and the retarget
no longer maps cleanly.

## Gates and report

`npm run lint && npm run typecheck && npm test`, plus the pipeline's own build
checks, all green before you commit.

Law 1: stage only the paths you were told to touch and run
`git diff --cached --name-only` immediately before committing.

Law 7: the commit is authored by Zain alone. No trailer, no attribution, no
emoji.

Finish with exactly: `READY FOR CLAUDE`

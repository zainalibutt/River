# Why the picture is still wrong, and what my approach got wrong

Written 2026-08-26, after Zain asked why weeks of art work have not produced a
frame anyone wants to look at. Measured against `docs/images/menus/`, which is
the target, and against the running app, which is not.

---

## Part 1 — What I got wrong

### I never looked at the reference

`docs/images/3_main/` has held the reference rooftop stills since 24 August.
`docs/behaviour-reference.md` is 46,820 bytes and I read it.
**I did not open a single reference image until tonight.**

Every visual judgement I made was against my own taste, dressed up in numbers.
That is the whole failure in one line. An art target existed in the repository
and the person judging the art never looked at it.

### I built instruments instead of looking

Three gates this session: a palette check, a budget check, a frame metric. Each
measures a property correctly. **None of them measures "does this look like the
reference", which is the only question that matters**, and their passing verdict
was actively misleading - the palette gate went green on all three venues while
the room looked like cardboard.

Instrumentation felt like rigour. It was displacement activity.

### I reached for numeric causes twice and was wrong twice

- Read glTF's linear `baseColorFactor` as sRGB, produced a contrast figure of
  1.119, and sent Codex a packet on it.
- Compared `RectAreaLight` nits against `SpotLight` candela, called it an 88x
  imbalance, and named it the root cause of the picture in a written audit.

Both were confident, both were arithmetic, both were wrong. The pattern is
reaching for a quantitative explanation because it feels more serious than
saying "the camera is in the wrong place" - which was the actual answer, and
which needed no maths at all.

### I treated art as defect-fixing

Every art packet has been shaped as find-the-bug: blue palms, dotted bone names,
clip amplitude, occlusion bake, wrong mixer root. **All real. All fixed. None of
them moved the picture**, because the picture is not broken by defects. It is
broken by composition that was never set against the target.

### Nobody owned the shot

Three lanes ran for days on asset correctness. Not one packet in the log says
"make the frame look like the reference". Correctness was owned, quality was
not, and the result is a technically clean render of the wrong image.

---

## Part 2 — What is actually wrong, measured

### The camera, which causes most of the rest

River's Rooftop camera, from `apps/web/src/lib/venue.ts`: radius 6.1m, height
4.05m, target the felt at 0.55m. That is **3.5m of drop over 6.1m of run - 30
degrees below horizontal.**

The reference puts the parapet line at roughly 48 percent of frame height, which
is a camera looking very nearly level, and the near chairs are cut off by the
bottom edge, which puts it close.

| | River | Reference (inferred) |
|---|---|---|
| Height above floor | 4.05 m | ~1.5 m |
| Distance from table | 6.1 m | ~3 m |
| Pitch below horizontal | ~30 deg | ~8 deg |

**Roughly two and a half times too high, twice too far, and four times too
steep.** Everything Zain listed follows from this one placement:

- Looking down 30 degrees puts floor across the bottom half of the frame. In the
  reference the floor is the bottom fifth.
- At 6.1m a seated character is small. In the reference a near player's shoulder
  spans an eighth of the frame width.
- At 4.05m you see the tops of heads and the open tops of the seat cylinders,
  which is exactly why the characters read as objects sitting in tubs.

### The chairs are drums

In the reference each seat is a chair with a **back**, a seat pad, a chrome
pedestal and a foot ring, and the character sits **in front of** the back. The
empty ones read as furniture and fill the near foreground.

River's `rooftop_chair_*` is a cylinder with the character inside it. That is
Zain's "standing in a cylinder", and it is a shape problem, not a budget
problem - the chair already has 1,432 triangles, which is more than enough for
a back and a pedestal.

### The HUD has no scale discipline

Reference, in a 1920-wide frame: the top-left icon row is six circles at roughly
44px each, about 2.3 percent of frame width. Player pins above heads are ~40px.
The player's own cards sit bottom-left at ~70px tall. **Total HUD coverage is
under ten percent of the frame, all of it cornered, none of it over the felt.**

River: the "return to table" disc is ~350px across and centred over the near
table edge. `POT 0` is ~90px tall in the middle of the screen. Three challenge
cards run ~250px wide. Nine `SIT` discs at ~55px float over characters' heads.
**Coverage is roughly a third of the frame and the largest single element is a
dead control.**

The rule the reference follows and River does not: **nothing overlaps the felt,
and no HUD element competes with a face.**

### Silhouette carries the characters, not detail

Reference identification comes from a top hat, purple hair, a bowler, a blonde
quiff, a pineapple shirt - read entirely from shape and colour at a distance.
Faces are present but not doing the work.

River spent three packets on a face atlas that is invisible at 6.1m, and gives
all nine characters the same torso silhouette in the same pink-red. **The budget
went into the thing that does not read and skipped the thing that does.**

### The purple is on the wrong surface

In the reference the magenta-purple is the **sky**, gradient, behind silhouetted
palms. In River it is a pool of light on the terrace floor. Same colour,
opposite placement, and it reads as a stain rather than as dusk.

---

## Part 3 — What to do, ordered by effect per hour

1. **Move the camera.** Three numbers in `venue.ts`. Height toward ~1.6m,
   radius toward ~3.2m, and re-derive the fit. This is the highest-value change
   available by a wide margin and it is an afternoon at most. Everything below
   is easier to judge once it lands.
2. **HUD scale pass.** Halve everything, corner it, get it off the felt, kill
   the centred disc. Packet 2E already specifies the action surface; this is the
   size and placement discipline that has never been applied.
3. **Chairs with backs.** One shape change in the pipeline, and the near
   foreground stops being empty floor.
4. **Silhouette variety** - hats, hair volume, jacket shapes. Cheaper than face
   detail and it is what actually identifies a player.
5. **Sky gradient, darker surround.** Put the purple where the reference puts
   it and let the palms go closer to silhouette.
6. **Only then** judge faces and materials, which cannot be assessed until the
   camera is close enough for them to matter.

---

## The rule this leaves behind

**Look at the target before measuring the thing.** Every instrument built this
session answers a question correctly. None of them would have caught a camera
two and a half metres too high, because none of them was pointed at the
reference. A frame is judged by comparison, and there was a folder of
comparisons in the repository the whole time.

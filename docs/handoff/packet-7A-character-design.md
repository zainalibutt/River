# Packet 7A — what a River character should be

**Owner: Fable. Read `docs/handoff/fable-laws.md` first. It is short and it is
binding, especially law 1 on cost.**

**Ceiling: 25 tool calls.** This packet is a document, not a build. If you pass
25, stop and report what you have.

---

## The one sentence

River's people are procedurally generated in Blender and they look wrong in a
way nobody has been able to name precisely enough to fix, so this packet asks
you to name it and to decide what they should be instead.

## Why you and not the pipeline author

Six attempts have been made at these characters. Every one fixed a defect that
was real and measurable, and the result still looks wrong. That is the signature
of a missing art direction rather than a missing fix: each pass optimised a
detail without a target to optimise towards.

You are not being asked to write Python. You are being asked to decide what
these people look like, at a level of specificity somebody can build from.

## Your one deliverable

**Write `docs/handoff/character-design.md`.** Nothing else. Do not touch any
other file, do not run Blender, do not run the test suite.

## What you may read, and nothing else

| path | what it is |
|---|---|
| `art/out/proofs/char-solo.png` | the current character, alone, 900x1100, three-point lighting. **Look at this first.** |
| `docs/images/menus_1/README.md` | the settled art direction for the product |
| `art/out/reference/in-hand-betting.jpg` | a frame of the reference game in play |

All three exist; I verified each one at 10:24 today. Do not open the pipeline
source — the constraints you need are listed below, measured, and the file is
being edited in another lane while you work, so what you read there may be
half-written.

## The constraints, measured, so you do not have to derive them

Taken from `art/out/char_male.glb` today:

- **15,178 triangles and 8,254 vertices per character.** Three meshes: body
  6,314 verts, garment 1,830, hair 110.
- **One material for the whole character**, `char_male_atlas_mat`: OPAQUE,
  base colour 1,1,1,1, roughness 0.62, double-sided, one 1024x1024 PNG atlas.
  Everything — skin, face, cloth, hair — is painted into that single texture.
  A second material is possible but costs a draw call per character per venue.
- **The atlas is painted procedurally, pixel by pixel, in Python.** There is no
  hand-painted texture and no sculpting step. Whatever you specify has to be
  expressible as generated geometry and generated pixels.
- **The body is cut off at the waist** and there is nothing below it — the
  table hides the cut. Characters are a bust, seated.
- **No pose variation.** Every character sits identically. There is a rig but
  it is not driven.
- **Viewing distance is about 3.2 metres**, camera between 61 and 85 degrees
  from vertical. A face is roughly 40 pixels tall at 1080p. This is the single
  most important number in this document.

## What is wrong now, so you do not spend calls rediscovering it

I measured these today. Take them as given; law 1 says do not re-derive them.

1. **The hair is a cap.** 110 vertices cannot be hair, so it is a shell over the
   skull and it reads as a flat cap with a peak.
2. **The body pokes through the shirt** at the pectorals and the navel — 22 to
   24 garment vertices still sit inside the body surface. The shirt is opaque;
   what looks like transparency is the body winning the depth test.
3. **A hard white Y across the chest** — collar and placket, far too bright.
4. **The face is not legible.** Eyes and mouth are faint smudges at 40 pixels.
5. **Hands are flat paddles**; arms are plain tubes with a visible seam where
   the sleeve ends.

## The questions your document must answer

Answer these specifically enough that somebody can build from them. Where a
number is the answer, give the number.

1. **Silhouette.** At 40 pixels of face, what actually reads? Proportions,
   shoulder mass, head size relative to body. What should a River character's
   outline be, and what does that mean for where the triangles go? You have
   15,178 and you may move them anywhere.
2. **The face.** What is the minimum that reads as a specific person at this
   distance, painted rather than modelled? Give the features in priority order
   and say which ones to drop rather than render badly. Say what should be
   geometry and what should be pixels.
3. **Hair.** Given it must be generated, what approach reads as hair rather
   than a hat? Say roughly what it costs in triangles and how many distinct
   types are worth having.
4. **The garment.** What does a person at this table wear, in the club language
   the product has already settled on? How should the collar and placket read
   so they are legible without becoming that white Y?
5. **Variation.** With one atlas and one material, what varies between nine
   people at a table so they read as nine people? Rank by how much each is
   worth against what it costs.
6. **Expression, if anything.** Is it worth having at 40 pixels, and if so what
   is the cheapest thing that carries it?

## What "done" looks like

A document somebody can build the next pass from without asking you a question.
Specific over comprehensive: five decisions with numbers beat fifteen
paragraphs of principle. Where you are unsure, say you are unsure and say what
would settle it.

If you think a constraint above is wrong, say which and why, and carry on within
it rather than around it.

## Gates

None. This is prose, so there is nothing to typecheck. Stage exactly one path:

```
git add docs/handoff/character-design.md
git diff --cached --name-only
```

If that lists anything else, unstage it — several models share this working
copy and the index is shared state. Do not commit; leave it staged and say so.

Finish with the routing statement: **READY FOR CLAUDE.**

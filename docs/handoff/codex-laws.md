# Operating laws — Codex

Binding for every packet on River. Read before starting. These are not
suggestions and they override any habit or default you would otherwise apply.

They exist because of specific incidents, named below. None of them are
hypothetical, and most of them are yours.

---

## 1. The git index is shared state

Three models write to this one working copy. **Whatever sits staged in the index
rides along in whoever commits next**, regardless of who staged it.

- **Never run `git add -A`, `git add .`, or `git add -u`.** Stage only the exact
  paths you were told to touch, named individually.
- **Run `git diff --cached --name-only` immediately before every commit.** If it
  lists a file that is not yours, unstage it with `git restore --staged <path>`
  and do not commit until the list contains only your files.
- Never reset, amend, or rebase. If the history looks wrong, stop and report it.
- Never stage or commit another model's work, even to be helpful, even to make a
  gate pass.

*Why:* on 2026-08-26 the commit "Add generated character face atlas" swept six
server and web files from another lane into itself, duplicating work that was
already pushed and dropping the original from the local branch. It was the third
collision of this kind on this project.

## 2. Look at the render before you report

You build geometry, materials and light. **A build that passes its gates and
renders wrong is a build that failed.**

- Render before every commit, at the camera the packet names.
- Open the image and look at it. Do not infer the result from the build log.
- If a face is not on a head, or a light is not on the thing it lights, you are
  not finished, whatever the triangle count says.

*Why:* packet 5Q passed every budget gate and put every character's head beside
its body. It was committed without a render, and cost two further packets.

## 3. Look at what is already there before you add to it

Before building a mesh, check whether the asset already carries one.

- Import the source file on its own, with everything else stripped, and render
  it.
- If something reads wrong, find out what is occluding, hiding or overriding it
  before you build a replacement.

*Why:* four packets went into building faces out of spheres. The imported human
already had a face, a 137-bone rig and nine animation clips. It was buried under
hair geometry exported without its alpha texture. Every sphere was bolted onto
the outside of a head that was only ever occluded.

## 4. Never delete quietly

If your packet is about removing something, name exactly what you removed in the
commit body.

Removing more than you were asked to is a defect even when the render improves.

*Why:* packet 5S was asked to strip occluding hair. It also deleted the garment
mesh four lines away, and the table sat as nine nude people for two packets
before anyone noticed.

## 5. Stay inside your named files

Your packet names the files you may create or modify. **Anything outside that
list is out of scope**, including files that look broken, files that would make
your gate pass, and files you think you could improve.

If something outside your scope blocks you, stop and report it. Do not fix it.

## 6. Budgets are gates, and headroom is not a virtue

Triangles, materials, draw calls, texture size and download size each fail the
build when exceeded.

- Never weaken a budget, a checker or a test to make a gate pass.
- Spending headroom on the thing a player actually looks at is correct. Coming
  in far under budget on a venue that reads badly is not an achievement.
- A check that records a failure without blocking is a log line, not a gate.

## 7. Prove it, do not assume it

Do not report a thing as working because it should work.

- Parse the exported artefact rather than trusting the exporter. Read the GLB
  JSON chunk and count what is actually in it.
- Test a gate against a known-bad input to confirm it fires.
- If your instrument cannot observe the thing you are measuring, your
  measurement is worthless.

*Why:* the venue exports carried nine skinned characters and zero animation
clips for several packets. Nothing said so, because nothing looked.

## 8. Commits are Zain's

Every commit is authored by Zain alone.

- **No `Co-Authored-By` trailer. No "Generated with" line. No tool attribution
  of any kind, anywhere.**
- No emoji in code, commit messages, file contents, documentation or
  identifiers.
- Plain-sentence subject, no conventional-commit prefix.
- Write the message as an engineer explaining a change to another engineer:
  what changed, and why it needed to.

*Why:* the repository is public and the commit log is read as evidence of the
author's own engineering.

## 9. Report honestly, with numbers

End every packet with a plain statement of what you did, what you did not do,
and anything you are unsure about.

- Report triangles, materials, draw calls and download for all three venues,
  before and after.
- Attach the renders the packet asked for.
- If a gate fails, say so and show the output. If you skipped part of the
  packet, say which part and why.
- If the packet cannot be done inside the budgets, say so with the number rather
  than shipping a partial result quietly.

Finish with the exact routing statement your packet asks for.

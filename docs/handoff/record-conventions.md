# Conventions for the development record

How `DECISIONS.md`, `PROGRESS.md` and `progress/` are written. Decided by Zain
2026-08-25. Binding for any model or session that adds to them.

The record is a deliberate artefact, not a by-product. It is read by people
deciding whether Zain can engineer, so it is held to the same standard as the
code.

---

## 1. The multi-model workflow is foregrounded

River is built by Claude, Codex, DeepSeek and Fable working in parallel in one
repository under one owner, with Sol and Astra as the character lanes from
September and the owner posing and fitting characters by hand from 13 September.
**That is a headline theme, not a footnote.** Where delegation stopped paying is
part of the theme, not an exception to it.

Write about it directly: the lane split and why the work has different shapes,
the shared-index incidents and what they cost, operating laws traced to specific
failures rather than stated as preferences, and the review discipline that came
out of it. The laws themselves are working notes and stay out of the tracked
tree; the record describes them rather than linking to them.

The orchestration is the least common thing here. Do not bury it out of
modesty, and do not inflate it either — it earns its place because there are
commits and incidents behind it.

## 2. Models are named

Say "Codex found the leaked light", "DeepSeek caught the export collision that
had broken the engine build", "Claude repaired the character pipeline".

Specific and checkable beats vague and safe. A named claim can be verified
against the commit log; "an AI helped" cannot. If a tool is swapped later, the
record still reads as an accurate account of what happened at the time.

## 3. Capture at every meaningful art change

Render the venues and characters whenever the art changes in a way a reader
would notice — a new prop set, a lighting pass, a character fix, a defect
discovered.

- **Venue renders** come from committed pipeline code, never hand-modelled,
  never retouched. The same commit must regenerate the same frame.
- **Character renders** may come from a lane's proof pass or from a `.blend`
  worked by hand, because that is where characters are now made. When they do,
  the index names the pass or the file and says plainly that the frame cannot be
  regenerated from the repository. Cropping and downscaling are fine;
  retouching is not.
- Number in the order taken, not the order that flatters the project.
- **Keep the wrong frames that carry a decision.** The empty-disc and Workbench
  captures are more valuable than the finished room, because they show the
  diagnosis. One wrong frame per decision is enough; a run of attempts belongs
  in the working notes.
- Index every image in `progress/README.md` with one line on what it shows.

## 4. Write layered, for two readers at once

Every document opens with a short summary that a skimmer gets real value from,
then goes deep underneath for someone who reads properly.

- **First screen:** what this is, what was decided, what it cost. Strong image
  early where there is one.
- **Underneath:** the reasoning, the rejected alternatives, the failure
  analysis, the numbers.

A hiring manager should get the point in thirty seconds. An engineer reading on
should find the tradeoffs and the debugging narrative intact.

## 5. Defects are recorded, not hidden

Known problems go in the record beside the wins, with enough specificity to act
on. A record showing only successes is not credible and is not useful.

State the defect, where it is visible, and why it matters. Do not apologise for
it and do not bury it in a footnote.

## 6. The record shows what landed and the decisions that turned it

Added 2026-09-13. Where the rules above pull against keeping the public record
to what got built, this one decides it: record what landed, the defects that are
still open, and the decision each failure forced. The sequence of attempts that
led to a decision - what was tried, in what order, and how each one fell short -
stays in the gitignored working notes, where the next lane looks for what not to
retry. The same applies to commit messages. Spend figures appear only in
`EFFORT.md`.

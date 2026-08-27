# Operating laws — Fable

Binding for every packet on River. Read before starting. These override any
habit or default you would otherwise apply.

They are short on purpose. You are the most expensive model on this project and
the budget is a real one, so this document tells you what you need and nothing
else. Most of the laws below exist because of a specific incident on this
repository, and several of them are recent.

---

## 1. Cost is a constraint, not a footnote

There is a fixed budget and it is the user's own money. Work like it.

- **Do not explore the repository.** Your brief names every file you may read
  and every file you may write. If you find yourself opening a third file to
  understand the second, stop and say so in your report instead.
- **The diagnosis in your brief is already done and already verified.** Do not
  re-derive it. If you believe it is wrong, say which part and why, and stop.
- **Never run `npm test`.** The full suite is 895 tests and about 26 seconds,
  and it tells you almost nothing about a change to one file. Run only the test
  files your brief names.
- **Never run the Blender pipeline.** `build_assets.py` is a three-minute build
  and it is not in your lane on any packet.
- **Do not re-read a file you have already read** unless you have changed it.
- One deliverable per packet. Finish it, report, stop. Do not pick up the next
  thing you noticed.

## 2. The git index is shared state

Several models write to this one working copy. Whatever sits staged in the
index rides along in whoever commits next, regardless of who staged it.

- **Never run `git add -A`, `git add .`, or `git add -u`.** Stage only the exact
  paths your brief names, individually.
- **Run `git diff --cached --name-only` immediately before every commit.** If it
  lists a file that is not yours, unstage it with `git restore --staged <path>`.
- Never reset, amend, rebase, or stage another model's work — not even to make a
  gate pass.

*Why:* a commit on 2026-08-26 swept six files from another lane into itself and
dropped the original work from the local branch. It was the third collision of
its kind.

## 3. Verify by exit code, never by grepping output

- `npm run typecheck > /tmp/tc.log 2>&1; echo $?` — zero or it failed.
- Do not write `... | grep -E "error TS"`. tsc colours its output, so the line
  reads `error` then an ANSI escape then ` TS2345:`, and the literal string
  "error TS" never appears. Piping through `tail` also replaces the exit status
  with tail's.

*Why:* that exact pattern reported "typecheck clean" for several commits while
a file had not compiled since the developer role was added. The first automated
deploy caught it. A verification that cannot fail is not a verification.

## 4. You cannot take screenshots. Measure the DOM instead

The browser pane does not composite frames unless it is displayed, so
`computer{action:"screenshot"}` times out. Do not spend turns trying.

Everything else works and is better anyway: `navigate`, `read_page`,
`javascript_tool`. Measure what you changed:

- Element rectangles via `getBoundingClientRect`, and pairwise intersection to
  find overlaps.
- `scrollWidth > clientWidth` to find clipped text.
- `getComputedStyle` for anything you assert about colour, size or spacing.

Report numbers, not adjectives. "HUD coverage 18.7 percent of frame, two
elements crossing the felt" is a finding. "Looks cleaner" is not.

## 5. Do not ship a control that does nothing

If a screen offers an action that is not wired, it says so and cannot be
pressed. A disabled item must state which it is — not built yet, or not
available to you — because a greyed-out control with no explanation reads as
punishment. The first person to use the menu asked why he had been banned from
the wardrobe.

## 6. Say what you did not do

A packet that is three quarters finished and reported as finished costs more
than one that stops and says where it stopped. If you could not verify
something, name it. If a claim in your brief turned out to be wrong, say so
plainly rather than working around it quietly.

## 7. House rules

- Commits are authored by Zain alone. **No `Co-Authored-By`, no tool
  attribution, no "generated with" line, in any commit, ever.**
- **No emoji** in code, commit messages, file contents, documentation,
  identifiers, or terminal output.
- Commit messages explain *why*, in prose, at whatever length the change earns.
  The repository is read as evidence of its author's engineering.
- British spelling in prose and comments.

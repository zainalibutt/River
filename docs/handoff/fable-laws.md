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
- **Your brief carries a tool-call ceiling. When you reach it, stop and report,
  finished or not.** A packet that stops at the ceiling with an honest account
  of where it got to is worth more than one that quietly spends double. If the
  brief has no ceiling on it, treat forty as the number and say so in your
  report.
- **Do not build a measurement harness.** If the brief asks for numbers it hands
  you the code to get them. If it does not, write the smallest thing that
  answers the question once, and reuse it rather than rewriting it per check.

*Why:* packet 6A cost around fifteen pounds for about an hour of work. It ran to
118 tool calls against a brief that carried three jobs, named no ceiling, and
asked for a DOM sweep that already existed. None of that was the model's doing
and all of it was avoidable in the brief.

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

## 4. Check the environment before you trust the brief about it

If the brief says a server is running, a session is seeded, or a file is in a
particular state, **verify it in one command before building on it** and say
what you found. A brief is written by someone who is not looking at your
machine.

If the environment is wrong, say so and fix it if that is cheap, or stop if it
is not. Do not spend a packet's budget working around a false premise.

*Why:* packet 6A was told the dev server was up on localhost:3000. It was not,
and `dev:web` alone cannot serve the app in any case - only
`apps/server/src/main.ts` loads the root environment and serves Next plus the
websocket on 3000. The agent worked that out correctly, and paid for the
privilege.

## 5. Measure the DOM. Use Chrome, and stop if you cannot

**Use the Chrome extension (`mcp__claude-in-chrome__*`).** It screenshots, and
seeing the thing is usually faster than inferring it. The in-app Browser pane
does not composite unless displayed - screenshots time out there and stage
rectangles come back as zero, which is worse than an error because it looks like
data. If the extension is not connected, stop and say so.

Measure what you changed:

- Element rectangles via `getBoundingClientRect`, and pairwise intersection to
  find overlaps.
- `scrollWidth > clientWidth` to find clipped text.
- `getComputedStyle` for anything you assert about colour, size or spacing.

Report numbers, not adjectives. "HUD coverage 18.7 percent of frame, two
elements crossing the felt" is a finding. "Looks cleaner" is not.

## 6. Do not ship a control that does nothing

If a screen offers an action that is not wired, it says so and cannot be
pressed. A disabled item must state which it is — not built yet, or not
available to you — because a greyed-out control with no explanation reads as
punishment. The first person to use the menu asked why he had been banned from
the wardrobe.

## 7. Say what you did not do

A packet that is three quarters finished and reported as finished costs more
than one that stops and says where it stopped. If you could not verify
something, name it. If a claim in your brief turned out to be wrong, say so
plainly rather than working around it quietly.

## 8. House rules

- Commits are authored by Zain alone. **No `Co-Authored-By`, no tool
  attribution, no "generated with" line, in any commit, ever.**
- **No emoji** in code, commit messages, file contents, documentation,
  identifiers, or terminal output.
- Commit messages explain *why*, in prose, at whatever length the change earns.
  The repository is read as evidence of its author's engineering.
- British spelling in prose and comments.

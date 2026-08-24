# Operating laws — DeepSeek

Binding for every packet on River. Read before starting. These are not
suggestions and they override any habit or default you would otherwise apply.

They exist because of specific incidents, named below. None of them are
hypothetical.

---

## 1. The git index is shared state

Three models write to this one working copy. **Whatever sits staged in the index
rides along in whoever commits next**, regardless of who staged it.

- **Never run `git add -A`, `git add .`, or `git add -u`.** Stage only the exact
  paths you were told to touch, named individually.
- **Run `git diff --cached --name-only` immediately before every commit.** If it
  lists a file that is not yours, unstage it with `git restore --staged <path>`
  and do not commit until the list contains only your files.
- Never stage or commit another model's work, even to be helpful, even to make a
  gate pass.

*Why:* on 2026-08-24 a commit titled "Wire economy grants into the server"
swallowed four packets from three models, because the index held everyone's
work. Untangling it took a full history rebuild.

## 2. Never leave partial work in the tree

Either **finish your packet and commit it**, or **revert your own files** and
report that you stopped.

A half-written file left uncommitted blocks the repository-wide typecheck, which
blocks every other lane. Stopping is acceptable. Leaving wreckage is not.

If you stop, say exactly which files you touched and what state they are in.

## 3. Stay inside your named files

Your packet names the files you may create or modify. **Anything outside that
list is out of scope**, including files that look broken, files that would make
your gate pass, and files you think you could improve.

If something outside your scope blocks you, stop and report it. Do not fix it.

## 4. One packet, no initiative

Do the packet you were given. Do not start the next one, do not refactor
adjacent code, do not rename things, do not add abstractions that were not
asked for.

Scope creep in a shared repository is not thoroughness. It is a merge conflict
with someone else's live work.

## 5. Gates are gates

`npm run lint && npm run typecheck && npm test` must all pass before you commit.

- Never weaken a test, a budget, a checker or a validation to make a gate pass.
- If a gate blocks you, the gate is probably right. Report it.
- A check that records a failure without blocking is a log line, not a gate.

## 6. Prove it, do not assume it

Do not report a thing as working because it should work.

- Parse the artefact rather than importing it.
- Test a gate against a known-bad input to confirm it actually fires.
- If your instrument cannot observe the thing you are measuring, your
  measurement is worthless.

*Why:* four separate "defects" on this project turned out to be faulty
instruments, not faulty code, including a gate that silently passed everything
because it read stale data.

## 7. Commits are Zain's

Every commit is authored by Zain alone.

- **No `Co-Authored-By` trailer. No "Generated with" line. No tool attribution
  of any kind, anywhere.**
- No emoji in code, commit messages, file contents, documentation or
  identifiers.
- Write the message as an engineer explaining a change to another engineer:
  what changed, and why it needed to.

*Why:* the repository is public and the commit log is read as evidence of the
author's own engineering.

## 8. Report honestly

End every packet with a plain statement of what you did, what you did not do,
and anything you are unsure about.

If a test fails, say so and show the output. If you skipped part of the packet,
say which part and why. Do not report completion that is not complete.

Finish with the exact routing statement your packet asks for.

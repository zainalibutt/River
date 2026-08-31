# What may be published

This repository is **public**, and has been since the day it was created. There
is no staging period: a push is a publication the moment it lands.

This file is the standing rule for what may go into it. It exists because the
rule was previously held in someone's head, and heads do not fail loudly.

## The rule

**Anything not clean to publish is gitignored, never committed and cleaned
later.**

Cleaning later does not work, and this is not a matter of opinion:

- A file removed at HEAD stays readable at every commit that carried it.
  `git log -p`, or clicking any older commit in the web UI, returns it in full.
- Force-pushing a rewritten history does **not** delete the old objects.
  GitHub keeps serving them by SHA. This was tested here: after the rewrite
  landed, a freshly cloned copy still pulled the old commits off the server.
- Old SHAs are not obscure. The Actions run history publishes the head SHA of
  every run, so anyone can enumerate them without guessing.

The only reliable remedies are never committing it, or destroying the
repository. One of those is free.

## Where local-only material lives

Two directories are default-deny. Everything inside them is ignored, forever,
with no further rules needed:

| Directory | For |
|---|---|
| `docs/reference/` | Third-party study material: captures, screenshots, downloaded kits, behaviour studies, competitor UI |
| `docs/private/` | Internal notes: ops state, audits, anything recording production identifiers |

Put material there **first**. Do not put it somewhere convenient and intend to
sort it out before committing.

Individually ignored, listed in `LOCAL.md`: assistant working files
(`AGENTS.md`, `CLAUDE.md`, `.claude/`, `.codex/`), the execution plan
(`docs/roadmap.md`), parked ideas (`IDEAS.md`), and every `.env` but the
example.

## What must never be tracked

1. **Third-party material redistributed rather than studied.** Screenshots,
   captures, model or texture packs, UI of another product. Studying it is
   fine and is recorded in the design documents; shipping it is not.
2. **The reference game's name.** The project is a poker game with a genre
   reference, not a request to reproduce somebody else's product. That is a
   presentation decision, and it is enforced rather than remembered.
3. **Production identifiers.** Project refs, database URLs, service IDs. Not
   credentials, but they point a stranger at live infrastructure, and a public
   repository is the wrong place to publish a map of it.
4. **Credentials of any kind.** Tokens, keys, passwords. These belong in
   `.env.local` or the platform's own secret store.
5. **Generated output.** `art/out/`, build artefacts, proof renders. The
   pipeline that makes them is the deliverable; the output is not.

## What enforces it

`hygiene.test.ts` runs in the suite and fails it on any tracked file that names
the reference, frames the project as a reproduction, or carries something
shaped like a project ref, a signed token or a platform key.

**Know its limit.** It reads `git ls-files` and the working tree, so it sees
**HEAD only**. It cannot see history. It passed, green, for the entire period a
production identifier was live in this repository's past. A gate that cannot
see history reads as complete protection and is not.

Until that gap is closed, the check before adding anything new is manual and it
is on the person adding it.

## Before you commit

    git status --short

Read it against this file. Anything that is study material, an internal note,
or a production identifier goes into `docs/reference/` or `docs/private/`
instead. Then let the suite run - the gate is part of it.

## If something slips through

Do not quietly delete it in the next commit. That leaves it public and creates
a record suggesting it was handled. Say so, and treat it as a history problem
rather than a file problem. The tooling for that lives outside this repository
at `River-history-rewrite/`, and the procedure is written down there.

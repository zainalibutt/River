# Brief

River is a social 3D poker room for friend groups: couch-multiplayer poker,
rebuilt for the browser and better in the places that matter.

It is also a measured experiment, and that is the more interesting half.

---

## The wager

A game of this shape took a studio. Pipeline artists, engine programmers, a
backend team, designers, QA — months to years of coordinated work by a lot of
people.

**The question River exists to answer: how far can one persistent developer get
against that, bending today's tools as hard as they will bend?**

Not a mockup. Not a prototype that looks right in a screenshot. Something that
holds up on the things a studio would be judged on:

- **No security shortcuts.** The shuffle is provably fair or the claim is
  withdrawn. Hidden information is proved with adversarial tests, not asserted.
  Money moves through an append-only ledger with idempotent writes, or it does
  not move.
- **UI and UX to a real standard.** Not a browser poker HUD with a 3D table
  behind it. A seat-relative orbit camera, a radial action surface, preset
  actions with public tells, chat that cannot steal focus mid-decision.
- **Real multiplayer**, server-authoritative, with reconnect, away policy and a
  clock the client never owns.
- **Generated art**, not bought assets. Venues, characters, chips and cards all
  come out of a Blender pipeline in the repository.

## How it is being answered

Three models working in parallel in one repository under one owner:

| Lane | Work |
|---|---|
| **Claude** | Design contracts, packet dispatch, all review, the web client, art direction |
| **Codex** | Server, security, transport, migrations, the asset pipeline |
| **DeepSeek** | Bounded deterministic engine modules — pure, tested, no I/O |

The delegation is the method, not a convenience. The work has genuinely
different shapes: a crypto construction wants adversarial reasoning, a state
machine wants exhaustive enumeration, a design contract wants judgement about
what a player will feel. Sending all three to the same place is either overkill
or underpowered.

## Why it is measured

A claim like "one developer, two days" is worth nothing without numbers behind
it, so `EFFORT.md` records what River actually cost: hours derived from commit
timestamps, token spend per model, and the share of time that went on diagnosis
rather than construction.

`DECISIONS.md` records the calls and the rejected alternatives. `PROGRESS.md`
and `progress/` record what the venues looked like at each stage, including the
frames that showed nothing and the bugs behind them.

The record is part of the experiment. An unmeasured result is an anecdote.

## Stated plainly

River is also a portfolio piece, and there is no point pretending otherwise. If
the experiment works, the artefact and the evidence are the same thing.

## What "better in the places that matter" means

River is not a faithful reproduction of anything. Deliberate divergences from
the genre reference:

- **Typed text chat.** The reference has none.
- **Provably fair shuffling** with a client-verifiable commit and reveal.
- **Chips are unbuyable and uncashoutable.** No purchase path exists anywhere
  in the codebase.
- **Three launch venues**, not the full set, with the reference roster kept as
  general law for what a venue should be.

Everything else — the radial action menu, preset actions with public gestures,
the muck-or-show personality, venue ambience, REP layered on top — is
the reference design working as intended, and is reproduced rather than
reinvented.

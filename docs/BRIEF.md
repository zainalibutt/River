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
- **Made art**, not bought assets. Venues, chips and cards come out of a Blender
  pipeline in the repository; characters are built on that pipeline and posed
  and fitted by hand.

## How it is being answered

Several models working in parallel in one repository under one owner:

| Lane | Work |
|---|---|
| **Claude** | Design contracts, packet dispatch, all review, the web client, art direction |
| **Codex** | Server, security, transport, migrations, the asset pipeline |
| **DeepSeek** | Bounded deterministic engine modules — pure, tested, no I/O |
| **Fable** | Bounded visual judgement and character/art review when the scarce input is taste rather than throughput |
| **Sol and Astra** | Character lanes from September: Sol chooses each next step and the evidence it needs, Astra builds in Blender |
| **Zain** | The owner. From 13 September, character pose and garment fit by hand in Blender |

The delegation is the method, not a convenience. The work has genuinely
different shapes: a crypto construction wants adversarial reasoning, a state
machine wants exhaustive enumeration, a design contract wants judgement about
what a player will feel, and a visual gold-standard pass needs a controlled
review budget. Sending every lane to the same place is either overkill or
underpowered.

### Where delegation stopped paying, so far

Character art was the most delegated part of River, and it is the first place
the experiment has given a clear answer. More than thirty bounded Blender passes
between 7 and 12 September produced an accepted standing character and a usable
seated base, and no accepted seated pose. Working on the file by hand turned out
far quicker and far cheaper than briefing another pass, so characters are now
posed and fitted by hand, with the models measuring, rendering and gating around
that work. Finding the edge of useful delegation is part of what River set out
to measure; the reasoning is in `DECISIONS.md`.

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

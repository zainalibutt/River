# Effort

What River actually cost, measured rather than estimated.

Kept because "built in a weekend" is a claim, and a claim with numbers behind
it is worth more than one without. Updated as the project runs.

This file is the evidence for the wager in `BRIEF.md`: how far one persistent
developer gets against work that used to take a studio. Without measurement
that question has no answer, only a story.

---

## Summary

| | |
|---|---|
| Project span | 2026-08-23 10:44 → ongoing |
| Active human sessions | ~16-18 hours across two days |
| Commits | 99 |
| Implementation | 12,626 lines |
| Tests | 5,374 lines, 396 tests |
| Models directed | 4, in parallel, one repository |

The headline is not the line count. The original two-day snapshot captured
12,626 tested lines without the repository ever going red for longer than one
packet — and the process discipline which made that possible was built from
incidents, not designed up front. The active fleet is now four models, with
Fable used selectively for bounded visual judgement.

The table above is the historical measurement snapshot from the first two
days; it is retained so the original claim remains auditable. Current checkpoint
(2026-09-01): `HEAD`/`origin/main` are `defa10a`, the native-gold F3A character
packet is reviewed, and curated visual captures 24–34 are tracked in
`docs/progress/`. The generated `art/out/` tree remains intentionally ignored.

---

## Human time at the keyboard

Derived from commit timestamps, splitting on gaps over 45 minutes. Commit time
is a proxy: much of it is dispatching and reviewing while three models grind,
which is real work of a different shape.

| Day | Span | Sessions | Commits |
|---|---|---|---|
| 2026-08-23 | 10:44 → 22:39 | one long block | 12 |
| 2026-08-24 | 03:08 → 23:52 | four blocks: 03:08-03:41, 11:12-11:29, 12:41-15:45, 18:03-23:52 | 85 |
| 2026-08-25 | from 00:04 | ongoing | — |

Roughly **6 hours** on the 23rd and **10-11 hours** on the 24th, of which the
evening block of ~6 hours straight was the most productive stretch of the
project: the leaked light, the lid, and the first honest venue renders all came
out of it.

## Model usage

Recorded per lane. Claude's figures are session-level and cover River only where
noted; Codex and DeepSeek report their own.

### Claude — design, review, client, art direction

| Metric | Value |
|---|---|
| Role | Design contracts, packet dispatch, all review, `apps/web`, Blender art direction |
| Session tokens | to be filled from the session panel |
| Notes | Account-wide totals at 2026-08-25 were 12.8M tokens across 24 sessions and 19 active days, but those span every project, not River alone |

### Codex — server, security, long grinds

| Metric | Value |
|---|---|
| Role | Transport, fairness rework, timers, social wire, asset pipeline, migrations |
| Tokens | not reported by the interface |
| Sessions | not reported by the interface |
| Wall-clock time | not reported by the interface |
| Model tiers | 5.6 Terra High for security and architecture; Terra/Luna Medium for specified work |
| Approximate tier share | not reported by the interface |
| Notes | Tier was deliberately dropped after 4F: top tier for novel security reasoning, cheaper tier for anything already specified to an acceptance list |

In practice, Terra/Luna Medium handled packets with precise contracts and
acceptance lists without an observed quality regression. The top tier remained
valuable for novel security and architecture reasoning and for ambiguous
diagnosis. The interface does not report a reliable percentage split.

### DeepSeek — bounded deterministic engine modules

| Metric | Value |
|---|---|---|
| Role | Pure `packages/engine` modules: economy, REP, challenges, table items, cosmetics, seat presentation, betting dial, showdown order, hand history, bot personalities |
| Tokens | not reported by the interface |
| Sessions | not reported by the interface |
| Restarted mid-work | not reported by the interface |
| Wall-clock time | not reported by the interface |
| Notes | Output quality was never the problem; process discipline was. `deepseek-laws.md` fixed it and its packets have been clean since |

The interface I work through does not expose cumulative token totals, a
reliable session count including restarts, or wall-clock time for this
project. Those figures have to come from the session panel, not from me, so
they are left as not reported rather than guessed.

Adding `deepseek-laws.md` changed the shape of my work more than the content
of it. Before it existed the costliest failure mode was process, not code: I
would let scope drift, or commit while another lane had left the tree dirty,
and the damage showed up as repo-wide breakage that was nobody's fault and
everybody's problem. The laws front-load the discipline instead of relying on
me to infer it. Naming the exact files up front and forbidding staged work
that is not mine stopped me from harming the shared index, and the rule that
a cross-scope blocker must be reported rather than repaired removed the
temptation to quietly "help" and in doing so collide with another lane. On
balance the bounds helped a lot. They did not make the packets easier to
write, but they made the difficult part of this repository — working in
parallel without breaking each other — scripted rather than improvised, and
that changed the failure rate more than anything else.

## What the numbers do not show

- **85 commits in a day is not a human rate.** It is three models working in
  parallel. Describing it as personal output would be false; describing it as
  directed output with the process discipline that held it together is both
  true and the more interesting claim.
- **Roughly a third of the work was diagnosis, not construction.** Five separate
  "defects" turned out to be faulty instruments rather than faulty code. That
  time does not appear as lines of code and was the most valuable time spent.

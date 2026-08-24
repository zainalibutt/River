# Effort

What River actually cost, measured rather than estimated.

Kept because "built in a weekend" is a claim, and a claim with numbers behind
it is worth more than one without. Updated as the project runs.

---

## Summary

| | |
|---|---|
| Project span | 2026-08-23 10:44 → ongoing |
| Active human sessions | ~16-18 hours across two days |
| Commits | 99 |
| Implementation | 12,626 lines |
| Tests | 5,374 lines, 396 tests |
| Models directed | 3, in parallel, one repository |

The headline is not the line count. It is that a three-model fleet produced
12,626 tested lines in two days without the repository ever going red for
longer than one packet — and that the process discipline which made that
possible was built from incidents, not designed up front.

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
| Model tier | 5.6 Terra High for security and architecture, Terra/Luna Medium for specified work |
| Tokens | to be filled |
| Notes | Tier was deliberately dropped after 4F: top tier for novel security reasoning, cheaper tier for anything already specified to an acceptance list |

### DeepSeek — bounded deterministic engine modules

| Metric | Value |
|---|---|
| Role | Pure `packages/engine` modules: economy, REP, challenges, table items, cosmetics, seat presentation, betting dial, showdown order, hand history, bot personalities |
| Tokens | to be filled |
| Notes | Output quality was never the problem; process discipline was. `deepseek-laws.md` fixed it and its packets have been clean since |

## What the numbers do not show

- **85 commits in a day is not a human rate.** It is three models working in
  parallel. Describing it as personal output would be false; describing it as
  directed output with the process discipline that held it together is both
  true and the more interesting claim.
- **Roughly a third of the work was diagnosis, not construction.** Five separate
  "defects" turned out to be faulty instruments rather than faulty code. That
  time does not appear as lines of code and was the most valuable time spent.

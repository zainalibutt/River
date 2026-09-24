# Cross-session reads

Doc 38's read rules were safe but inert within one session: a session gives too few public spots for a posterior to clear its break-even bound. This packet asked the cheapest question first, in simulation, before any storage is built: if a bot keeps its read of a player from one meeting to the next, do the same frozen rules start to pay? They do. Nothing here is wired into live play, and no database, migration or flag changed.

## Method

`runSessions` gained chains (`chainLength`): consecutive sessions in which one OG character meets the same opponents, a day apart, keeping its opponent memory throughout. The 30-day half-life still decays that memory between meetings. Each table ran 40 chains of six meetings, heads-up meetings of 100 hands and nine-seat meetings of 60. The base is the live version 5 policy (doc 39) carrying its own session-model memory the same way; the candidate is doc 38's three rules, unchanged, over that base, with the pooled public statistics carried as well. Intervals are clustered by chain, because a chain shares one memory.

## Development

On development styles (`b4-dev-*`), pooled candidate minus base was +46.7 big blinds per 100 hands (+36.7 to +56.6). The learning curves had the shape the evidence problem predicts, by meeting one to six:

| Opponent | Meeting 1 | 2 | 3 | 6 | Rule that fired |
| --- | ---: | ---: | ---: | ---: | --- |
| calling station | +6.5 | +90.7 | +190.7 | +232.5 | value bets |
| pot-odds chaser | 0 | +2.4 | +14.7 | +38.6 | pot-sized bluffs |
| nit | 0 | 0 | +0.5 | +8.4 | pot-sized bluffs |
| pressure player | +254.0 | +276.2 | +339.6 | +389.4 | bluff-catches |

The pressure player bets so often that its read forms inside the first meeting. Balanced-looking styles and the ordinary cast drew no reads and no change.

## Confirmation

Gates were written into the roadmap before one run on fresh `b4-confirm-*` seeds over the five held-out styles and the ordinary cast: no read in the first ten hands of a first meeting; a pooled lower bound above zero; every table at least −2, with one declared follow-up of 160 fresh chains for a table that missed −2 with a positive estimate.

| Gate | Result |
| --- | --- |
| No read early in a first meeting | Pass on every table |
| Pooled | +6.9 (+4.4 to +9.5), pass |
| Every table at least −2 | Eleven tables pass; nine-seat overbluff +4.0 (−6.4 to +14.4) missed on width |
| Follow-up, nine-seat overbluff, 57,600 hands | +10.6 (+4.6 to +16.6), pass |

Heads-up overbluff carried most of the gain, +63.4 (+48.3 to +78.6), and it grew with meetings: +4.5, +59.9, +69.6, +98.5 and +115.1 over the first five, then +32.9 (−11.5 to +77.2) in the sixth. The value, balanced, camouflaged and reverse-sizing tables stayed within 2.7 big blinds per 100 of zero in every meeting, which is the unknown-style fallback doing its job over longer memory too.

## What this decides

With a regular opponent, a public read carried between meetings is worth having, and it stays out of the way against players it cannot tell apart. The spec already has named bots remember a signed-in player across sessions; this is the evidence that doing so helps. Zain approved persistence on 24 September with a nightly consolidation. The storage design is recorded as the next packet in the roadmap: per-hand public evidence appended exactly once, one decayed checkpoint per bot and player folded nightly by the same pure update functions, and memory loaded once per pair per room so a bot's many decisions never wait on the database.

## Limits

- Every opponent is synthetic and keeps one style for all six meetings. People drift; the 30-day half-life is the only defence here.
- Six daily meetings with the same players is a regular's pattern, not a stranger's.
- The rules are doc 38's, frozen. Tuning them now needs new development evidence and new confirmation seeds; `b4-confirm-*` is spent.

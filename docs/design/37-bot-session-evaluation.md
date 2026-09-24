# Whole-game session evaluation

This is an offline instrument for judging bot policies over whole sessions rather than single spots or independent hands. It changes no live bot, room, transport, persistence or client code. The opponent-action forecaster (docs 28–31, 34–36) is untouched and remains a separate workstream.

## Why a new instrument

`runBotBenchmark` plays independent one-hand trials: every hand is a fresh room, every seat starts at 200 big blinds, and no seat receives opponent memory. That is right for comparing single decisions, but it cannot see the three things the next learning pass has to prove: that a read built from earlier hands helps or hurts later ones, how results change with stack depth, and how a bot fares against the held-out river styles when those players play whole hands.

## What it does

`runSessions` (`apps/server/src/bot-session-benchmark.ts`) plays a session as a sequence of hands with the same cast. Each hand is still an authoritative `Room` with its own deck seed and one random stream per seat, and entrants rotate one chair per hand, so the focal seat passes through every position. Between hands the focal seat keeps the live opponent memory: the same `opponentEvidenceFromHand` and `updateOpponentModel` calls `RoomHub` makes, fed only from the settled `HandRecord`. Its summaries reach the policy through the ordinary observation. A `FocalMemoryPlugin` can keep a second public-only memory for a candidate; it receives the settled record and the hole cards the table showed publicly, nothing else. Memory resets between sessions, which models a table of strangers.

Every seat buys in from a weighted set of depths: 40 big blinds (a seat that has lost chips) a quarter of the time, 100 a quarter, 200 (the default) 35% and 400 the rest. The result for a hand is sliced by the focal seat's position at the deal, its effective stack (the smaller of its own and the largest other stack: short up to 60 big blinds, standard up to 160, deep beyond) and its starting-hand class (premium, strong, small pair, suited playable, offsuit broadway, weak). The focal seat rotates through the four OG characters by session, so a number describes the OG skill rather than one personality. Non-focal seats have no memory, as live bots have none of each other.

`runPairedSessions` (`bot-session-evaluation.ts`) plays the same sessions twice, once per focal policy, and pairs hand by hand after checking that both runs dealt the same deck, seat, stack and cards. Hands inside a session share the focal memory, so they are not independent; intervals are clustered by session. A slice is a ratio of per-session totals, and its variance uses the linearised cluster-robust form with a Student t quantile on sessions minus one degrees of freedom.

### Opponents

`bot-style-opponents.ts` gives the five river styles from docs 32 a whole hand to play. Their river bet frequency by hand category and every bet size are read from the same tables the river experiments used (`riverBetProbability`, `sizeProbabilities`), so these are the same value, balanced, overbluff, camouflaged and reverse-sizing bettors. Flop and turn behaviour is authored: bet rates when checked to and the largest price each will call, by whether the player holds air, a flush draw, a pair, or two pair or better. Preflop ranges are shares of the 1,326 starting hands, converted into thresholds on the ordinal preflop score from that score's measured distribution. Full tables play tight ranges (value opens 11%, balanced, camouflaged and reverse-sizing 17%, overbluff 25%); heads-up ranges are wide (55%, 70% and 80%). These players are synthetic stress styles, not models of people.

Nine-seat style tables seat the focal OG, four players of one style and four ordinary River rookies and novices on the live policy. Heads-up tables put the focal OG against one style player. The ordinary tables use only River's rookie and novice characters. The campaign definition is `bot-session-campaign.ts`; `npx tsx apps/server/src/bot-session-run.ts --instrument` and `--baseline` reproduce the numbers below. Heads-up tables play 200 sessions of 100 hands; nine-seat tables play 200 sessions of 60 hands.

## Proving the instrument can see

Two checks ran on the ordinary nine-seat table, 12,000 hands each.

- A copy of the live policy under another name, paired against the live policy, gave exactly zero on every hand and in every slice. The pairing is exact, including the memory the two runs build.
- A planted leak that folds premium hands preflop whenever there is a bet to call moved the focal result by −185.6 big blinds per 100 hands (interval −241.8 to −129.4). The premium slice carried it: 303 hands at −7,360.8 per 100 (−9,394.1 to −5,327.5). The weak slice moved by +0.3 (−0.3 to 0.9), a small knock-on through the focal memory; every other hand class was exactly zero. The instrument puts an effect in the slice that caused it.

## The live OG's baseline

The live policy (`poker-guard` over the version 4 rule policy) in the focal seat, big blinds per 100 hands with session-clustered 95% intervals:

| Table | Hands | Live OG | 95% interval |
| --- | ---: | ---: | ---: |
| heads-up value | 20,000 | −80.3 | −98.5 to −62.1 |
| nine-seat value | 12,000 | −31.6 | −118.9 to 55.6 |
| heads-up balanced | 20,000 | −101.0 | −121.9 to −80.0 |
| nine-seat balanced | 12,000 | −113.7 | −213.5 to −13.9 |
| heads-up overbluff | 20,000 | −86.4 | −114.7 to −58.1 |
| nine-seat overbluff | 12,000 | −258.5 | −363.9 to −153.1 |
| heads-up camouflaged | 20,000 | −75.8 | −97.8 to −53.8 |
| nine-seat camouflaged | 12,000 | −202.0 | −295.0 to −108.9 |
| heads-up reverse-sizing | 20,000 | −86.0 | −109.5 to −62.4 |
| nine-seat reverse-sizing | 12,000 | −145.8 | −239.3 to −52.4 |
| heads-up ordinary | 20,000 | −13.9 | −30.5 to 2.7 |
| nine-seat ordinary | 12,000 | 77.7 | −69.3 to 224.6 |

The live OG loses to every held-out style heads-up and to four of five at nine seats. The slices say where: premium and strong starting hands win, while weak hands, three quarters of all deals, lose heavily. At the nine-seat overbluff table the weak slice runs at −446.7 (−539.2 to −354.2); against the ordinary nine-seat cast it is −289.3 (−414.1 to −164.6).

One mechanism explains most of it. Facing any bet, the rule policy raises the minimum plus 100 chips with any hand at the personality's `bluffRate`, which is 0.30 to 0.45 for the OG characters. A paired probe that set only that rate to zero, on separate seeds, gained +56.4 (+40.7 to +72.2) heads-up against value, +51.7 (+32.3 to +71.0) heads-up against balanced, +241.6 (+159.8 to +323.4) at the nine-seat overbluff table and +193.0 (+109.8 to +276.2) against the ordinary nine-seat cast, most of it in weak hands. The probe is a diagnosis, not a policy change: whether and how an OG should bluff-raise is a strategy decision for the live policy, and it is recorded here because every later comparison against the live policy inherits it.

These are synthetic opponents over simulated hands at fixed blinds with deep stacks, so large big-blind rates reflect large pots, not realistic human win rates.

## How much public evidence a session yields

Mean public opportunities per opponent per session, counted from accepted actions by `publicEvidenceFromHand` (`packages/engine/src/opponent-stats.ts`):

| Table | Postflop checked to | Faced a postflop bet | River checked to (range) | Showed | Shown river bet or raise |
| --- | ---: | ---: | ---: | ---: | ---: |
| heads-up value | 37.4 | 4.5 | 10.0 (3–18) | 9.8 | 1.3 |
| nine-seat value | 28.8 | 3.9 | 8.7 (0–26) | 11.1 | 0.7 |
| heads-up balanced | 38.9 | 6.9 | 8.9 (2–17) | 9.1 | 1.5 |
| nine-seat balanced | 28.7 | 6.7 | 8.1 (0–23) | 11.3 | 0.9 |
| heads-up overbluff | 35.6 | 9.9 | 5.7 (1–14) | 5.8 | 3.0 |
| nine-seat overbluff | 24.3 | 11.4 | 5.8 (0–20) | 11.5 | 1.3 |
| heads-up camouflaged | 36.5 | 6.3 | 8.0 (1–19) | 8.2 | 1.5 |
| nine-seat camouflaged | 28.5 | 6.5 | 8.1 (0–25) | 11.4 | 0.8 |
| heads-up reverse-sizing | 39.9 | 7.5 | 9.3 (2–18) | 9.7 | 2.3 |
| nine-seat reverse-sizing | 28.8 | 6.9 | 8.2 (0–25) | 11.4 | 0.9 |
| heads-up ordinary | 37.6 | 2.2 | 11.9 (3–20) | 12.6 | 0.5 |
| nine-seat ordinary | 58.5 | 4.4 | 18.2 (7–32) | 24.2 | 1.0 |

Heads-up sessions are 100 hands and nine-seat sessions 60. The river signal the earlier experiments leaned on averages six to twelve opportunities a session, some players see none, and a shown river bet arrives about once a session. Checked-to spots across all three postflop streets are three to four times as common. Facing a bet is the scarce spot at these tables, because most of them bet rarely. A learning pass should therefore pool public evidence across streets, weigh each statistic by its own opportunity count, and expect whole categories of read to stay unknown for a whole session.

## Limits

- Every opponent is authored or one of River's rule bots. None of this is evidence about people.
- The stack weights, session lengths and table compositions are evaluation choices, not measurements of real tables.
- Intervals are clustered by session, but the four focal characters and shared style families still link sessions; treat an interval that barely clears zero with suspicion.
- The live OG's bluff-raise leak dominates its baseline. A learning candidate compared only with the live policy would take credit for patching that leak; the next packet compares against a leak-free control as well.

## Verification

Tests beside the code cover the classifications, exact replay, the A/A pairing, a planted leak confined to its slice for a focal that ignores memory, public-only plugin input, per-opponent evidence counts, the clustered interval against a hand calculation, the t quantiles, the style players' river rates against the scenario tables, their sizing, and legal nine-seat play.

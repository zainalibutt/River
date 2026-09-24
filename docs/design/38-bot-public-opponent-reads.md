# Confidence-bounded public opponent reads

This is an offline OG candidate that adapts to opponents from their accepted public actions. It is not wired into live play, retrains no weights during a game, and touches no persistence, migration or cloud state. The opponent-action forecaster (docs 28–31, 34–36) is a separate workstream and is unchanged.

The candidate passed its safety gates and failed its value gate on fresh held-out seeds, so it is not eligible for live use. The same run confirmed, on every held-out table, that the live OG's largest loss is a rule-policy leak rather than anything learning would fix.

## Public statistics

`packages/engine/src/opponent-stats.ts` keeps decayed counts per opponent from the same sources the live opponent memory uses: the settled hand record and cards the table showed publicly. It counts preflop entry and raises, folds to a preflop raise, and, pooled across flop, turn and river, folds when facing a bet, raises when facing a bet, and bets when checked to, with the river's bet rate and bet sizes kept separately and shown river bets bucketed as air, pair or made. Pooling is deliberate: doc 37 measured three to four times as many checked-to spots across the three postflop streets as on the river alone.

Each rate is a Beta posterior whose prior is a population rate worth ten opportunities, and each carries a credible interval of plus or minus 1.645 posterior standard deviations. River has no human population yet, and its own rule bots are not one: over 40 sessions of the ordinary tables they bet 1.9% of postflop spots when checked to and raised 22–29% of the bets they faced. The priors are therefore neutral assumptions in `DEFAULT_OPPONENT_STATS_TUNING`, to be replaced by anonymous population statistics once people have played. A read is only as strong as its own opportunities, so a player seen folding twice stays close to the population.

The statistics reach a policy through an additive, optional `opponentStats` field on the version-one observation. `observationFor` copies only the entries for opponents seated at the table. The live room does not populate the field.

## The candidate

`apps/server/src/bot-opponent-reads.ts` changes an OG decision in three situations, only heads-up after the flop, only when the statistic concerned has at least six opportunities, and only when a posterior bound clears the break-even arithmetic plus a margin of 0.05:

| Rule | Situation | Read required | Change |
| --- | --- | --- | --- |
| Bluff-catch | Facing a bet, price at most 0.4 of the pot after calling, holding a pair or better, control would fold | Bets when checked to, lower bound at least 0.6 | Call |
| Fold-equity bluff | Checked to with air or a draw, control would check | Folds to a bet, lower bound at least 0.55 | Bet the pot |
| Station value | Checked to with a pair or better, control would check | Folds to a bet, upper bound at most 0.3 | Bet half the pot |

"Pair" here means a pair the actor adds to the board; a pair on the board is everybody's and counts as air. The bluff is pot-sized because fold rates are mostly observed against the OG's own bets, the minimum plus about a pot, and players fold less to smaller bets; a half-pot version lost slightly to the development pot-odds chaser. In every other case the candidate returns its base decision unchanged. That is the unknown-style fallback, and a test proves it exact: over whole sessions with no read established, the candidate and its base produce identical hands.

The base is a leak-free control: the live policy with the OG's `bluffRate` raise switched off. Doc 37 measured that any-hand raise when facing a bet as the live OG's largest leak. A candidate compared only with the live policy would take credit for removing the leak rather than for reading, so the value of reading is measured as candidate minus control.

## Development

Thresholds were set from the arithmetic above and checked only on the authored styles from docs 29 and 31 and the ordinary cast, on `b2-dev-*` seeds. Candidate minus control, big blinds per 100 hands with session-clustered 95% intervals:

| Development table | Reads | Candidate minus control |
| --- | ---: | ---: |
| heads-up pressure player | 1,338 bluff-catches | +61.4 (+49.3 to +73.5) |
| heads-up calling station | 181 value bets | +0.8 (−0.3 to +2.0) |
| nine-seat novel styles | 5 | +4.1 (−1.2 to +9.3) |
| the other eight tables | none | 0 |

No read fired in the first ten hands of any session.

## Confirmation

The gates were written into the roadmap before any confirmation seed ran: at most 0.1% of early-session decisions changed on every table; a lower bound of at least −2 big blinds per 100 on every table; and, pooled over all twelve tables, a lower bound above zero. `npx tsx apps/server/src/bot-session-reads-run.ts --confirm` played the five held-out styles and the ordinary cast, heads-up (200 sessions of 100 hands) and nine-seat (200 of 60), on fresh `b2-confirm-*` seeds. A second run reproduced every table exactly.

| Gate | Result |
| --- | --- |
| No reads early in a session | Pass: none in the first ten hands on any table |
| Non-inferiority on every table | Pass: eleven tables exactly zero; heads-up overbluff +0.1 (−0.1 to +0.2) |
| Reading adds value, pooled | Fail: lower bound −0.006 |

Across 2,400 sessions the reads fired three times, all bluff-catches at the heads-up overbluff table. The candidate is safe and inert against these styles.

Why it stayed inert was measured afterwards on separate `b2-diagnostic-*` seeds, which change nothing above. The overbluff player really does bet when checked to far more than the others: 70.5% of spots heads-up and 73.5% at nine seats, against 41–44% for balanced, camouflaged and reverse-sizing and 25–33% for value. But a session offers about 28 such spots heads-up and about 14 per style player at nine seats, so by the end of a session the posterior lower bound has a median of 0.50 heads-up and 0.42 at nine seats, short of the 0.6 the bluff-catch rule needs. At that player's rate the bound reaches 0.6 after roughly 80 spots, about three heads-up or six nine-seat sessions. Facing a bet is rarer still, one to six times per player per session, because these tables seldom bet, so no fold-based read can form within a session. The confident false read that the earlier river models made did not happen; the price of that caution, within one session, is that almost no read forms at all.

## The leak-free control against the live policy

The same confirmation run paired the control with the live policy on every table:

| Table | Control minus live |
| --- | ---: |
| heads-up value | +67.3 (+50.8 to +83.8) |
| nine-seat value | +199.4 (+145.6 to +253.2) |
| heads-up balanced | +71.1 (+51.8 to +90.3) |
| nine-seat balanced | +174.6 (+114.9 to +234.3) |
| heads-up overbluff | +52.5 (+29.7 to +75.3) |
| nine-seat overbluff | +169.4 (+90.6 to +248.2) |
| heads-up camouflaged | +44.3 (+26.8 to +61.8) |
| nine-seat camouflaged | +205.0 (+138.9 to +271.1) |
| heads-up reverse-sizing | +42.0 (+26.4 to +57.5) |
| nine-seat reverse-sizing | +190.8 (+122.1 to +259.4) |
| heads-up ordinary | +37.5 (+26.1 to +49.0) |
| nine-seat ordinary | +179.8 (+96.9 to +262.8) |

Every interval sits above zero. This is a strategy result, not a learning one: removing a rule the OG applies to any hand, on held-out styles and seeds nothing was tuned on. Whether the live OG should change is a product decision, because it alters live behaviour and the spec would change first. These opponents remain synthetic.

## What the evidence says to do next

- Cross-session memory is the missing evidence. The spec already has named bots remember a signed-in player across sessions; the persistence path exists and is off. Reads that need 80 spots cannot come from one sitting.
- Any change to thresholds, priors or rules needs new development evidence and fresh confirmation seeds. The confirmation seeds used here are spent.
- A fold-based read needs bets to be faced; at tables that rarely bet, a player's fold rate stays unknown.

## Verification

Tests beside the code cover the posterior rates and their narrowing with evidence, street pooling and decay, the holding classification, each rule firing only on an established read and never multiway or for a rookie or novice, the control never raising air into a bet where the live policy sometimes does, exact equality with the control over whole sessions while nothing is established, and the observation copying statistics only for seated opponents.

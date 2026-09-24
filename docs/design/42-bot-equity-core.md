# The OG's live strategy, version 6: equity and balanced bluffing

Version 6 of the rule policy changes only what an OG does after the flop. Before, it scored a hand as its made-hand category over eight, so it bet only a straight or better when checked to, folded top pair to a half-pot bet about three times in four, and, once version 5 removed its any-hand raise, never bluffed. Rookie and novice play is unchanged. The server still legalises every action and the deterministic policy is still the fallback; version 5 stays exported as `v5RulePolicy` and `v5GuardPolicy` so its records reproduce.

## What it does

`packages/engine/src/bot-equity-core.ts` judges the hand by its pot share against the ranges the opponents' public actions point to (the doc 33 range classes, one class stronger for this street's aggressor), discounted out of position before the river, with a small allowance for a draw's implied odds. Heads-up on the river the share is exact; otherwise it is sampled.

- Value: bet or raise when the share clears a threshold per street. Against several opponents a fair share is smaller, so thresholds scale by the square root of two over the hands in the pot, leaving heads-up play unchanged.
- Calling: continue when the realised share beats the price; heads-up, a pair or better within eight points of the price calls half the time, so bluffs cannot take everything.
- Bluffing, heads-up only: continuation bets on the flop after raising preflop, semi-bluffs with draws, semi-bluff raises only when calling is close to right anyway, and river bluffs with hands that cannot win at showdown at a rate near the share that makes a three-quarter-pot call break even. It does not bluff into two or more opponents.
- Character: a personality's bluff rate becomes a multiplier between 0.6 and 1.4 on those rates, so characters differ without spewing; tilt raises it within the same bounds.

`packages/engine/src/fast-evaluator.ts` scores five to seven cards in one pass. It ordered 20,000 random pairs exactly as `evaluateBest` does and made the equity module's estimates 25–30 times faster with byte-identical outputs, so earlier records still reproduce. The equity core samples opponents from precomputed range lists; that sampler agrees with the reference estimator within 0.03 at 4,000 trials.

## Evidence

Scenario tests found two defects in an earlier build, both fixed before the final confirmation: an additive multiway adjustment pushed the value threshold above certainty at a full table, so the river nut flush never bet; and the semi-bluff raise ignored the price. The build that went live was confirmed afresh.

Gates were written into the roadmap before one run on fresh `b6b-confirm-*` seeds over the five held-out styles and the ordinary cast, 200 sessions per table, version 6 minus version 5, big blinds per 100 hands with session-clustered 95% intervals:

| Table | Result |
| --- | ---: |
| heads-up value | +50.2 (+35.5 to +65.0) |
| nine-seat value | +156.0 (+111.2 to +200.8) |
| heads-up balanced | +86.4 (+68.7 to +104.1) |
| nine-seat balanced | +237.6 (+188.9 to +286.2) |
| heads-up overbluff | +127.5 (+107.8 to +147.2) |
| nine-seat overbluff | +221.2 (+154.8 to +287.5) |
| heads-up camouflaged | +100.0 (+83.7 to +116.4) |
| nine-seat camouflaged | +176.1 (+121.0 to +231.3) |
| heads-up reverse-sizing | +74.2 (+57.5 to +90.9) |
| nine-seat reverse-sizing | +210.1 (+154.5 to +265.7) |
| heads-up ordinary | +23.5 (+8.6 to +38.4) |
| nine-seat ordinary | +260.8 (+207.3 to +314.2) |
| pooled | +127.0 (+117.2 to +136.7) |

Every table's interval sits above zero, so no follow-up was needed.

## Limits

- These opponents are synthetic and none adapts, so they cannot measure how exploitable the new bluffing is; the next packet adds opponents that adapt and a heads-up best-response probe.
- River bluff frequency is a fixed approximation of the balanced rate, not computed from the OG's own range; the heads-up solver packet replaces it.
- Ranges are coarse classes from preflop action, one class stronger for an aggressor; postflop betting beyond that does not narrow them yet.

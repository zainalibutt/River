# The OG's live strategy, version 5

The live rule policy moved from version 4 to version 5 for OG characters only. An OG no longer raises as a pure bluff when facing a bet, and it ranks starting hands with the ranked preflop score from docs/design/32 instead of the pair-bonus score. Rookie and novice decisions are unchanged. The server still legalises every action, and the deterministic policy is still the fallback. Version 4 stays exported as `legacyRulePolicy` and `legacyGuardPolicy`, and every earlier record script uses it, so docs 32, 37 and 38 remain reproducible.

## Why

Doc 37 found the live OG losing to every held-out style heads-up, mostly in weak hands. The cause was one rule: facing any bet, the policy raised the minimum plus 100 chips with any two cards at the personality's `bluffRate`, which is 0.30 to 0.45 for the OG characters, before the flop included. Skill should decide how well a bot bluffs and style how often. An any-hand minimum raise is the right leak for a rookie and the wrong play for the strongest tier.

## How each part was chosen

`RuleStrategyOptions` makes each part a switch for OG only: what the bluff rate does when facing a bet (`any-hand`, `with-equity` or `never`), the ranked preflop score, and a heads-up bluff when checked to on the turn or river. Each part was kept only if it beat the step before it on development seeds (the doc 29 and 31 authored styles and the ordinary cast, `b3-dev-*`), pooled over twelve tables, big blinds per 100 hands with session-clustered 95% intervals:

| Step, against the one before | Result | Decision |
| --- | ---: | --- |
| No any-hand raise, against version 4 | +64.7 (+52.3 to +77.1) | kept |
| Raises only with a draw, or with a suited, connected or paired hand before the flop | −19.4 (−28.4 to −10.4) | not adopted |
| `never`, against a zero bluff rate | exactly zero on all twelve tables | equivalence check |
| Ranked preflop score | +48.2 (+29.1 to +67.3) | kept |
| Heads-up bluff when checked to with air or a draw | +1.1 (0.0 to +2.2) | not adopted |

The any-hand raise was not worthless everywhere. It won chips from players who fold too often (the nit, the pot-odds chaser) and lost many more to aggressive ones (+252.8 for removing it against the pressure player). The checked-to bluff behaved the same way: it gained against folders and lost to the calling station (−9.9, −11.7 to −8.1) and the pressure player (−4.1). Choosing whom to bluff is a read's job, so neither bluffing part is live until reads can make that choice.

## Confirmation

The bundle (`bluffRaises: 'never'` plus `preflopRanking`) was fixed in the roadmap before one run on fresh `b3-confirm-*` seeds over the five held-out styles and the ordinary cast. Bundle minus version 4:

| Table | Result |
| --- | ---: |
| heads-up value | +83.7 (+64.9 to +102.4) |
| nine-seat value | +191.3 (+86.8 to +295.8) |
| heads-up balanced | +67.5 (+43.9 to +91.1) |
| nine-seat balanced | +116.8 (+9.1 to +224.5) |
| heads-up overbluff | +102.2 (+74.6 to +129.8) |
| nine-seat overbluff | +95.6 (−16.7 to +207.9) |
| heads-up camouflaged | +61.0 (+38.2 to +83.8) |
| nine-seat camouflaged | +178.3 (+73.5 to +283.2) |
| heads-up reverse-sizing | +81.7 (+58.4 to +105.0) |
| nine-seat reverse-sizing | +205.7 (+95.6 to +315.9) |
| heads-up ordinary | +111.7 (+92.7 to +130.7) |
| nine-seat ordinary | +322.0 (+151.4 to +492.6) |
| pooled | +122.3 (+102.9 to +141.6) |

The pooled gate passed. The every-table gate, a lower bound of at least −2 on each table, failed at nine-seat overbluff. That was interval width, not a measured loss: the margin had been sized on doc 38's candidate, which changed a handful of hands, while this bundle changes most preflop decisions, and nine-seat intervals here are about ±110. The gate was not relaxed. A follow-up on that table alone was declared before it ran: 800 fresh sessions of 60 hands on `b3-confirm-extra-*` seeds, the same bar. It gave +96.2 (+32.6 to +159.9) over 48,000 hands. It is a second look at one table, and it is reported as that.

## Tests

Beside-code tests now assert that the version 5 OG never raises air into a bet where version 4 sometimes did, that it raises ace-king suited and folds a pair of deuces in the preflop scenario as the ranked score intends, that a draw is still raised at the bluff rate only in `with-equity` mode, that checked-to bluffs stay heads-up and OG-only, and that the holding classification, now shared by the rule policy and doc 38's reads, finds open-ended straight draws and flush draws only before the river.

## Limits

- Every opponent here is synthetic and none adapts. A player who learns that this OG never bluff-raises can fold to its raises; the harness cannot measure that exploitability, and bluffing returns only when reads can target it.
- An OG's `bluffRate` currently does nothing, so OG characters differ in aggression and tightness but not in bluffing.
- Rookie and novice keep the any-hand raise deliberately. Whether novice should keep it is a product question this packet did not measure.

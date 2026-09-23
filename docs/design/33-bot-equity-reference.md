# Offline preflop equity reference

The stronger OG preflop candidate still uses an ordinal hand score, not a win probability. `estimatePreflopEquity` provides a separate, seeded showdown-equity reference for development and testing. It does not run in live bot decisions and does not train model weights.

The reference removes the actor's two cards from a 52-card deck, samples distinct opponent cards and a five-card board without replacement, evaluates every best five-card hand with River's existing evaluator, and awards the actor a full pot share for an outright win or a fractional share for a tie. It supports one through eight opponents, matching the new nine-player table. Trials and seed are explicit, and the trial count is bounded. Tests cover replay determinism, outcome conservation, duplicate-card rejection and the broad ordering of strong and weak hands.

In one reproducible 1,500-trial sample per hand, using seeds `equity-heads-${hand}` for one opponent and `equity-${hand}` for eight opponents, the pot-share estimates were:

| Starting hand | Against one random opponent | Against eight random opponents | Candidate ordinal score |
| --- | ---: | ---: | ---: |
| AA | 0.848 | 0.334 | 0.950 |
| AK suited | 0.661 | 0.228 | 0.830 |
| 22 | 0.518 | 0.137 | 0.420 |
| 72 offsuit | 0.345 | 0.056 | 0.000 |

The reference and candidate agree on this broad order but clearly disagree in scale. Treating the ordinal score as equity when subtracting pot odds is unsound. Even sampled showdown equity against uniformly random hands is **not** the probability of winning after a real opponent raises. Opponents enter with selective ranges, can fold, can bet again, and may deny equity; position, stacks, implied odds and multiway action alter the decision. PokerStars' [pot-odds guide](https://www.pokerstars.com/poker/learn/lesson/pot-odds/) distinguishes call price from equity, and its [multiway guide](https://www.pokerstars.com/poker/learn/strategies/a-guide-to-multiway-pots/) describes the stronger continuing ranges typical of multiway pots.

The authored range and public-action sensitivity work below extends this reference, but does not replace the live policy. Any replacement must pass held-out action-quality, legal-action, hidden-information, latency and human-like-play gates. The old eight-seat candidate benchmark and the new nine-seat candidate benchmark remain synthetic outcome checks, not training evidence.

## Authored range extension (offline only)

The reference now accepts one explicit range per opponent: `random`, `loose`, `tight`, or `premium`. These are deliberately simple starting-hand sets, not a solver chart or a trained read of a person. `premium` contains TT+, AQs+, and AK; `tight` adds 88–99, ATs–AJs, AJo–AQo and KQ; `loose` admits all pairs and aces, suited connected/one-gap hands from the middle ranks upward, suited broadways and high offsuit broadways. The rank/suit predicate is public and tested. A future action model may suggest a mixture of these sets, but this pass does not infer one from a bet or silently promote a guessed range to fact.

Each opponent is dealt a uniformly selected currently legal two-card combination from its named set, in seat order; the board comes from the remaining deck. Dealing without replacement correctly blocks known and earlier-dealt cards. Seat-order conditioning means this is a scenario generator, not an exact posterior distribution for several independently selected opponents. If earlier hands leave no compatible hand for a later opponent, the estimator fails explicitly instead of returning an invented number. A caller should choose feasible ranges and treat multiway results as approximate stress tests. Seeds and trial counts remain bounded and repeatable. Neither the live bot nor its existing synthetic win-rate gates consume this estimator yet.

For illustration, AK suited with the fixed seed `range-baseline-2026-09-23` over 1,500 heads-up trials yielded pot shares 0.666 against `random`, 0.640 against `loose`, 0.571 against `tight`, and 0.451 against `premium`. This is the expected directional warning: the same hole cards are less attractive when an opponent's plausible continuing range is stronger. A separate 150-trial nine-player `loose` sample yielded 0.112; it is deliberately too small to drive policy. These are generated assumptions and Monte Carlo estimates, not measured win rates or calibrated probabilities of a particular person's cards.

## Known-board and public-action sensitivity (offline only)

`estimateShowdownEquity` now accepts the actor's legal known board at preflop, flop, turn or river. The board and actor hole cards are removed before sampling distinct opponent cards; an incomplete flop or duplicate known card is rejected. It completes only the unknown public cards and splits tied pots. Exact river fixtures cover a board that everyone plays (one-ninth share at a nine-player table) and a private royal flush (full share). This is still showdown equity against assumed starting ranges, not a future-betting solver.

`opponentRangeContext` uses only the current hand's accepted public preflop actions and an optional completed-hand opponent summary. A call-all-in is not mistaken for a reraise. No action, passive entry, raise and reraise select `random`, `loose`, `tight` and `premium` respectively as a **central scenario**, not a hidden-hand prediction. An established high-raise or low-raise read can move that central scenario one category, while a low-confidence read cannot. All four alternatives remain available. The thresholds are authored test knobs, not learned poker truths.

`estimateRangeSensitivity` runs those four heads-up scenarios on the same visible board and reports their minimum, maximum and central pot shares. On a fixed 1,000-trial AK-suited flop fixture (`Qs Js 2c`) after a public preflop raise, the pot shares were 0.7595 against `random`, 0.7490 against `loose`, 0.5810 against `tight`, and 0.5435 against `premium`. This wide span is the point: choosing a single range would give misleading precision. There is no action recommendation or live inference here. The prior read is built from public, decayed completed-hand statistics; neither opponent hole cards nor future board cards enter it.

The next strategic gate is a held-out action-quality comparison by hand class, position, stack depth and table size. Any policy use needs a cheap or cached estimator, explicit treatment of future betting and side pots, and replay/latency/legality checks. The existing opponent-action ML model remains a separate forecaster; this range analysis did not train or promote it.

The earlier verification paragraph records the preflop-range checkpoint. After the known-board and public-action extension, 1,142 tests passed, one opt-in local database test skipped, typecheck and scoped Biome passed. Repository-wide Biome remained red on unrelated art/web files in the shared working tree.

Local verification after this extension: 1,136 tests passed, one opt-in local database test skipped, repository typecheck passed, and the two changed engine files passed scoped Biome checks. Repository-wide Biome still reports unrelated formatting issues in the dirty art/web working tree; this pass did not reformat those files. The Chrome Play menu and bot-preset controls rendered locally, but joining a table would have touched the hosted Supabase account, so no nine-seat gameplay visual was claimed.

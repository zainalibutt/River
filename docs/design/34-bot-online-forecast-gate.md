# Causal online opponent-forecast gate

This is an offline supervised-forecast experiment. It does not choose a poker action, expose hidden cards, run at a live table or deploy a model. The frozen v2 and rejected v3 opponent-action models both predict the next legal fold/check/call/raise bucket from pre-action public features. A static mixture made ordinary-bot validation worse at every positive candidate weight tested. The online gate therefore starts every actor on the frozen model and uses only that actor's subsequently accepted public actions to decide whether the v3 model has earned weight.

`OnlineActionForecaster.forecast` takes an actor ID, their pre-action public feature vector and their legal-action mask. It never takes the target label. `observe` consumes the accepted label after the forecast; it rejects illegal labels and duplicate consumption of the same forecast object. Each actor's decayed evidence is separate. The evidence is the bounded cumulative difference in log probability assigned to their actual actions by v3 versus v2. A candidate needs at least four previous samples and three log-likelihood units of advantage before it gets any weight; its maximum weight is 0.9. Contradictory later actions can take that weight back to zero. This per-instance memory can die when the session ends. It is not neural-weight retraining.

The v3 candidate is trained and calibrated by the existing campaign. This experiment uses **new, distinct seeds** to select the online gate from nine predeclared sample-count/margin combinations. Selection requires no ordinary-bot validation log-loss regression and lower authored-style loss. It then evaluates new ordinary, authored-style, previously defined novel-style, mixed eight-seat and mixed nine-seat hand seeds without changing the selection. The novel policies were already known to the project from the earlier v3 experiment, so these are fresh hands, not a new style family. All actors are synthetic River or authored policies; no human behaviour is represented.

The selected gate used four samples, margin three, learning rate 0.2, per-action evidence decay 0.98 and maximum v3 weight 0.9. Selection ordinary loss stayed 0.53335; authored-style loss fell from 1.26710 to 0.23456. Fresh confirmation results were:

| Group | Frozen log loss | Online log loss | Frozen calibration error | Online calibration error | Adapted forecasts |
| --- | ---: | ---: | ---: | ---: | ---: |
| Ordinary A | 0.52863 | 0.52863 | 0.01004 | 0.01004 | 0 / 2,770 |
| Ordinary B | 0.51123 | 0.51123 | 0.02188 | 0.02188 | 0 / 2,797 |
| Authored familiar styles | 1.26825 | 0.22615 | 0.30329 | 0.05925 | 2,699 / 3,054 |
| Previously defined novel styles | 0.90813 | 0.74996 | 0.11461 | 0.05679 | 1,575 / 2,033 |
| Mixed eight-seat | 0.93187 | 0.81965 | 0.05245 | 0.04155 | 1,444 / 4,093 |
| Mixed nine-seat | 0.93406 | 0.83477 | 0.06590 | 0.04801 | 1,966 / 4,690 |

The paired log-loss improvements on the fresh novel, eight-seat and nine-seat sets were respectively 0.15817, 0.11221 and 0.09929 per action. Hand-clustered approximate 95% intervals were [0.10777, 0.20858], [0.09082, 0.13360] and [0.08058, 0.11800]. These intervals do not fully account for repeated actions by the same small group of synthetic actors or shared policy families. The two ordinary groups made no online switch, so their improvement and interval were exactly zero; this is successful non-regression, not an improvement.

The reproducible command is `npx tsx apps/server/src/bot-learning-online-run-v3.ts`. It writes no artifact, database row or live flag. All three offline checks passed: no ordinary regression, positive paired improvement on the shift groups, and no calibration regression in any confirmation group. `shadowEligible` means only that this synthetic gate supports the **next design step**, an opt-in read-only shadow trial with timing, replay, identity, exact-once update, privacy and rollback checks. `liveInferenceEnabled` remains false. There is still no evidence that a forecast improves the bot's own poker decisions, beats humans or makes OG expert.

Local verification on 23 September 2026: 1,147 tests passed, one opt-in local database test skipped, repository typecheck and scoped Biome passed. The repository-wide lint gate still fails on unrelated art/web working-tree files; this pass did not alter them. No cloud service or production flag was changed.

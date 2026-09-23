# History-aware opponent-action experiment

This is River's second **offline** supervised-learning experiment. It predicts an opponent's next public action; it does not choose the bot's wager and is not wired into a live room.

## What changed

Feature schema 2 retains schema 1's 20 public context features and adds eight causal, per-actor action-history features. They summarise earlier accepted folds, checks, calls and raises, separated by whether the actor faced a bet. The collector records a row *before* updating that actor's history with the current accepted action. It neither uses hole cards nor shares one actor's history with another. Each seeded run starts with cold priors, so validation and test rows cannot inherit training-run outcomes.

The model has separate linear softmax heads for facing a bet and being free to check. It still masks illegal labels. A validation-only step tunes temperature and four regularised class biases; the confirmation seeds do not participate in fitting or selection. This remains a small, inspectable model, not a claim of expert poker strategy. All normal bot actions still use the deterministic policy.

Run `npx tsx apps/server/src/bot-learning-train-v2.ts` from the repository root. It trains and writes `apps/server/models/opponent-action-v2.experimental.json`, refusing to replace a differing artifact. The export includes feature names, both heads, calibration values, campaign seeds and results, but no raw hands or cards.

## Evaluation

The fixed run used 10,816 training actions, 2,873 calibration actions, three development seeds, then three distinct confirmation seeds and a separate four-identity cast unseen in training. The comparator remains the identity-aware, legal-context statistical baseline fitted only on training actions. Positive log-loss improvement means the learned model assigns more probability to the action actually taken. Intervals are approximate 95% intervals clustered by hand, not by action.

| Confirmation set | Actions | Log-loss improvement | 95% interval | Raise-probability Brier, learned / baseline |
|---|---:|---:|---:|---:|
| A | 4,018 | 0.0376 | 0.0293–0.0459 | 0.1143 / 0.1154 |
| B | 3,875 | 0.0401 | 0.0315–0.0486 | 0.1090 / 0.1104 |
| C | 3,789 | 0.0351 | 0.0253–0.0450 | 0.1117 / 0.1121 |
| Unseen cast | 5,043 | 0.0573 | 0.0481–0.0665 | 0.1181 / 0.1285 |

This is substantially better probability prediction than schema 1 on simulated opponents. It is **not promotion-eligible**: top-choice calibration is worse than the baseline on confirmation B and C, and raise *argmax recall* is lower on A and B. A probability predictor's raise Brier score matters more than its argmax recall for future decision support, but the current gate intentionally demands both. The same simulation and four archetypes still dominate the training data; even the unseen cast comes from River's rule-bot family. No human-behaviour or live-play claim follows from these numbers.

## Next gate

Keep the artifact server-only and experimental. The next work should diversify legally authored opponent policies, collect consented public action observations from real players with exact pre-action timing, and evaluate on people and table sizes outside this simulator. If a later candidate passes calibration and class-specific checks, first run server-only shadow inference with model-load, latency and fallback audits. Durable per-bot experience and stronger poker fundamentals remain separate work; an accurate action forecast does not itself make an OG a skilled player.

## Authored-style distribution-shift audit

The frozen v2 artifact was also evaluated without retraining against four legally authored synthetic policies: a nit, calling station, pressure player and mixed player. Their identities were absent from training, and the held-out seed was separate. The stress harness uses the same authoritative `Room`, accepted actions and pre-action public features as the original campaign. Run `npx tsx apps/server/src/bot-learning-shift-run-v2.ts` to regenerate the training comparator and audit the frozen model; it writes no artifact.

| Style | Actions | Learned minus baseline log-loss improvement | Learned raise-probability Brier |
|---|---:|---:|---:|
| Nit | 400 | 0.0441 | 0.1361 |
| Calling station | 2,370 | 0.4424 | 0.0165 |
| Pressure | 1,441 | 0.1513 | 0.7627 |
| Mixed | 691 | -0.0568 | 0.1553 |

Across 4,902 actions the model improves log loss by 0.2540 over the training-population statistical baseline, but top-choice calibration is worse by 0.0141 and raise argmax recall is only 8.3%. The pressure policy raises on nearly every decision, and its 0.7627 raise-probability Brier exposes how poorly the model anticipates that shift. The mixed policy is worse than the statistical baseline on log loss. Aggregate improvement therefore does not clear a distribution-shift gate. These policies are intentionally extreme synthetic probes, not evidence of human realism, GTO strength or live bot improvement. No model was promoted and no live inference was enabled.

The follow-up [public-history adaptive forecast experiment](30-bot-adaptive-forecast.md) also failed its validation gate; no adaptive overlay was promoted.

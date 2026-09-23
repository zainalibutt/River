# Experimental opponent-action learning

River now has a reproducible, offline trained opponent-action predictor. It is an experiment, not a live bot policy or a claim of strong poker play.

## Question and data boundary

Given only the public state immediately before an opponent acts, estimate the probabilities of fold, check, call and aggression. This is a *behaviour* predictor, not a range or hand-strength oracle. The training label comes from an action accepted by the authoritative `Room`. An all-in is grouped with a raise only when it exceeds the previous street bet; otherwise it is grouped with a call.

`bot-learning-data.ts` collects examples from seeded benchmark hands. Feature schema 1 contains street, price, pot, stack, position, number of active players, earlier public-action frequencies and legal-action flags. It excludes hole cards (including the acting bot's own cards), future cards or actions, shuffle state, opponent summaries, tilt, personality labels and identity as a numeric feature. IDs remain only as dataset grouping keys and for the identity-aware statistical comparator. The callback captures a pre-action observation and emits an example only after the room accepts the action.

Training, temperature calibration and final test use disjoint hand-seed groups. The 20 numeric features are finite and bounded to `[0, 1]`; their fixed names and order travel with the exported model. A schema mismatch or non-finite weight is rejected at inference.

## Model and comparator

The trained model is a four-class, L2-regularised softmax regression with legal-action masking. Offline full-batch gradient descent and temperature selection are deterministic. There is no neural-weight update during a game. The comparator is not a coin flip: it combines legal-action-conditioned population frequencies with per-actor frequencies under a twelve-example prior. Both are fit on training hands only.

Run `npx tsx apps/server/src/bot-learning-train.ts` from the repository root to reproduce the campaign. The script creates `apps/server/models/opponent-action-v1.experimental.json` once and refuses to overwrite a differing artifact. The file includes the campaign seeds, sample counts, metrics, promotion flag, feature schema and trained weights. It contains no raw hands or cards.

## First held-out result

The fixed campaign trained on 9,064 decisions, calibrated on 2,162 and tested on 4,426 decisions from four seeded River bot identities, spanning rookie, novice and OG. Final test:

| Metric | Learned | Statistical baseline |
|---|---:|---:|
| Multiclass log loss, lower is better | 0.5602 | 0.5672 |
| Accuracy | 75.06% | 70.24% |
| Brier score, lower is better | 0.0808 | 0.0833 |
| Expected calibration error, lower is better | 0.0424 | 0.0088 |
| Raise recall, higher is better | 7.8% | 51.9% |

An additional manually run 400-hand seed with four bot identities absent from training yielded 4,904 decisions: log loss 0.5685 versus 0.5910, accuracy 73.57% versus 64.68%, and calibration error 0.0289 versus 0.0250. This supports a limited generalisation check but is not a substitute for real human data or a multi-seed confidence interval.

The current campaign requires at least 0.02 log-loss improvement with a positive hand-clustered lower confidence bound, no calibration or accuracy regression, and raise recall of at least 30% and no worse than the baseline to become promotion-eligible. It fails the log-loss margin, confidence, calibration and raise-recall gates. The headline accuracy is dominated by common checks; 100% check recall does not mean the model understands aggressive play. The artifact explicitly records `promotionEligible: false` and `liveInferenceEnabled: false`. The follow-up history-aware experiment is in [29-bot-opponent-action-v2.md](29-bot-opponent-action-v2.md).

## What must happen next

- Expand data beyond the current rule-bot population: diverse legally authored policies, then consented public-action histories from real players. Never join final board, showdown result or revealed seed to an earlier decision.
- Test multiple held-out seeds, identities, table sizes and action frequencies; report uncertainty, class-level calibration and performance under distribution shift.
- Improve calibration, possibly with context-specific smoothing or a richer model. Compare to the same identity-aware baseline, not an intentionally weak one.
- Add server-only shadow inference at the accepted human-action boundary, with bounded CPU and model-load failure handling. Do not influence a live OG decision until the offline gate and shadow audits pass.
- Durable per-bot opponent memory and stronger poker reasoning remain separate required work. Predicting an action is not equivalent to knowing a player's cards or playing optimally.

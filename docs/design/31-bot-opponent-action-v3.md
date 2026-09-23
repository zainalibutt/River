# Broader opponent-action experiment

This is an offline supervised-learning experiment, not a live bot brain. It predicts the next public action bucket (fold, check, call, raise) from information available before that action. It neither chooses poker actions nor updates model weights during a game. The server's existing legal-action guard and deterministic fallback remain unchanged.

`npx tsx apps/server/src/bot-learning-run-v3.ts` reads the frozen v2 experimental model and compares it with a new candidate. The candidate trains on 12,663 seeded, legally accepted actions from a mix of ordinary River rule bots and the four already-authored nit, calling-station, pressure and mixed styles. A separate 2,969 examples calibrate it. Every training, validation and test set uses distinct hand seeds. The novel cast uses distinct bot identities. The novel policies may look at their own hole cards, which the actor is entitled to see; the predictor receives only its existing pre-action public feature vector and causal action-history counts.

The confirmation set contains four different, deliberately synthetic styles: a selective bluffer, pot-odds chaser, slow-player and volatile caller. It also includes two ordinary-bot seeds, an eight-seat table with four ordinary and four novel-style opponents, and a later nine-seat table with one additional ordinary bot. The novel policies and final-test seeds are not used for fitting or calibration. These are policy caricatures for distribution-shift testing, not examples of expert poker or evidence from human players. Some use simple hole-card heuristics, not real equity calculation.

First fixed run, 23 September 2026:

| Held-out group | Candidate log loss | Frozen v2 log loss | Candidate calibration error | Frozen v2 calibration error |
|---|---:|---:|---:|---:|
| Ordinary A | 0.53833 | 0.50568 | 0.04476 | 0.01110 |
| Ordinary B | 0.50712 | 0.48680 | 0.02928 | 0.01682 |
| Familiar extreme styles | 0.17183 | 1.27326 | 0.02484 | 0.29721 |
| Novel styles | 0.73333 | 0.99540 | 0.06817 | 0.13746 |
| Mixed eight-seat table | 0.76922 | 0.93296 | 0.04332 | 0.05042 |
| Mixed nine-seat table, added 23 September | 0.84258 | 0.90844 | 0.09170 | 0.05853 |

Lower is better for both reported error metrics. The candidate clearly learns the exaggerated training styles and transfers some of that to unfamiliar synthetic styles. It also gets worse on both ordinary-bot seeds. Novel-style raise recall rises from 0.250 to 0.634 overall, but volatile-caller recall falls from 0.172 to 0.149; on the mixed eight-seat table raise recall falls from 0.558 to 0.524. Per-style calibration errors are still high for the selective bluffer (0.257) and slow-player (0.138). The campaign's predeclared checks therefore reject promotion. No v3 model is saved or loaded by live play.

The new full-table gate uses a separate 300-hand seed and nine distinct identities: four ordinary training-cast bots, four novel-style bots and one additional ordinary bot absent from both groups. Its candidate-minus-frozen paired log-loss improvement is 0.06586 with an approximate 95% interval [0.04245, 0.08927], but calibration error worsens by 0.03317. This is a distribution-shift check on the same trained candidate, not new training or evidence from people. The additional gate remains failed and does not change the rejected rollout decision.

A paired, hand-clustered 95% approximation compares candidate and frozen forecasts on the same actions. Candidate minus frozen improvement is negative on both ordinary seeds: -0.03264 with interval [-0.04333, -0.02196] and -0.02032 with interval [-0.02959, -0.01106]. It is positive on the novel-style set, 0.26208 with interval [0.20259, 0.32156], and on the mixed eight-seat set, 0.16374 with interval [0.13535, 0.19214]. Hands within a session and policies within a synthetic family are still related; these intervals do not establish generalisation to human opponents. The promotion check requires positive lower bounds on both ordinary seeds and the novel, eight-seat and nine-seat mixed sets, so it remains false.

This result does not establish that the forecast helps a bot win, plays human-like poker, or adapts to a real player. The next development candidate should address the ordinary-player regression using only training and validation data, then face new untouched confirmation seeds and style variants. Human-action data would require consent, strict pre-action capture, privacy limits and a new evaluation split. An expert OG decision policy remains a separate strategic benchmark against win rate, legal play and no hidden information.

The later [causal online forecast gate](34-bot-online-forecast-gate.md) addresses the ordinary-bot regression in a different way: it leaves ordinary actors on the frozen model and shifts weight only after a given actor's accepted public actions support v3. Fresh synthetic hand seeds cleared that offline gate, but neither the forecast nor the gate is wired into live play.

# A first learned decision model

This is River's first learned model that chooses bot actions rather than forecasting them. It is offline and experimental: it is not wired into live play, and the version 5 rule policy (doc 39) stays the live OG and the fallback. The opponent-action forecaster (docs 28–31, 34–36) is a different model with a different job and is unchanged.

## The idea

For an OG facing a decision heads-up after the flop, estimate what each legal action is worth in chips if the hand then plays on, and take the best one when it clearly beats what the rule policy would do. This is one-step policy improvement over the rule policy: if the estimates were exact, acting on them at every decision could only help. A learned model supplies the estimates from features the seat is allowed to see.

## Labels, from the simulator

`bot-rollout.ts` reopens a recorded session hand from its seed through the same function that dealt it, replays the accepted actions up to the decision, and throws if the replayed stack or pot differs from what was recorded. It then plays one action bucket (fold, call or raise three quarters of the pot when facing a bet; check, half pot or pot when free) and lets every seat play the hand out with fresh random streams, returning the focal seat's chip change from that point, divided by the pot. The rollout plays the dealt cards, so a label knows where the hand was going; that is legitimate only because it is a training target computed offline. The model's inputs never contain those cards. A fold is worth exactly zero from the decision on, which the tests check.

## Inputs and model

`bot-value-model.ts` reads 22 inputs from the legal observation: the street; whether the seat holds air, a draw, its own pair or better (doc 39's holding); two seeded Monte Carlo equities against one random hand and one from the tight range (doc 33); the price and the bet against the pot; the stack-to-pot ratio; whether it acts last; whether the opponent is this street's aggressor and for how many streets; the opponent's pooled fold-to-a-bet and bet-when-checked-to rates with their evidence weights (doc 38); and whether the board is paired, three-suited or straight-coordinated.

Each situation (facing a bet, or free to act) has its own network: 22 standardised inputs, 32 rectified hidden units and one output per bucket, trained by deterministic minibatch Adam on a Huber loss masked to the buckets that were legal and so rolled out. No external library is involved.

## Training

Data came from development styles (docs 29 and 31) and the ordinary cast on `b5-data-*` seeds, 24 sessions per table, with the version 5 policy in the focal seat. Up to 1,200 heads-up postflop decisions were kept per table, 9,005 in all, each bucket labelled by two rollouts. Sessions 0–17 trained the networks and 18–23 were held back. On held-back decisions the networks beat a per-bucket average on the same loss: 0.538 against 0.716 facing a bet, 0.369 against 0.445 when free.

The override margin was chosen on the held-back decisions by the best lower bound of the one-step gain the rollout labels imply: 0.5 pots facing a bet (+0.144 pots per decision, +0.006 to +0.281, changing 27.5% of those decisions) and 0.3 pots when free (+0.114, +0.060 to +0.167, changing 44%). Those figures are optimistic, because the margin was picked on the same decisions they describe; whole-session play is the test.

The artifact is `apps/server/models/og-action-value-v1.experimental.json`, with its features, networks, margins, campaign and offline report, and `promotionEligible` and `liveInferenceEnabled` both false. `npx tsx apps/server/src/bot-value-train.ts` regenerates it and refuses to overwrite a different artifact.

## Whole-session results

Every figure below is the learned policy minus the version 5 policy in paired whole sessions, big blinds per 100 hands with session-clustered 95% intervals, 100 sessions per table. The base plays exactly as live version 5 does; the learned policy takes over only for an OG heads-up after the flop.

On fresh development-style seeds (`b5-dev-eval-*`, the styles it trained on) the pooled result was +108.7 (+97.1 to +120.4). Its largest single habit was to bet where version 5 checks: 5,870 of its 6,047 changes against the calling station were pot-sized bets instead of checks, worth +479.9 there.

The gates for the held-out test were written into the roadmap before one run on fresh `b5-confirm-*` seeds over the five held-out styles and the ordinary cast:

| Table | Result |
| --- | ---: |
| heads-up value | +9.2 (−11.7 to +30.1) |
| nine-seat value | +71.9 (+45.7 to +98.1) |
| heads-up balanced | +42.3 (+15.8 to +68.8) |
| nine-seat balanced | +57.6 (+23.9 to +91.4) |
| heads-up overbluff | +97.8 (+65.3 to +130.4) |
| nine-seat overbluff | +74.9 (+37.4 to +112.4) |
| heads-up camouflaged | +65.5 (+39.0 to +92.1) |
| nine-seat camouflaged | +17.6 (−18.1 to +53.3) |
| heads-up reverse-sizing | +28.8 (−1.6 to +59.2) |
| nine-seat reverse-sizing | +16.4 (−16.7 to +49.4) |
| heads-up ordinary | +32.7 (+13.2 to +52.2) |
| nine-seat ordinary | +11.5 (−11.8 to +34.9) |
| pooled | +44.4 (+36.0 to +52.8) |

The pooled gate and the no-clear-loss gate passed. Four tables had positive estimates but lower bounds below −2, so each got the declared follow-up of 400 fresh sessions on `b5-confirm-extra-*` seeds, all four passing: heads-up value +23.4 (+12.7 to +34.2) over 40,000 hands, nine-seat camouflaged +30.8 (+13.8 to +47.8), nine-seat reverse-sizing +16.5 (+0.4 to +32.5) and nine-seat ordinary +12.6 (+5.1 to +20.1), 24,000 hands each. They are second looks at single tables and are reported as that.

By its own gates the model is eligible for Zain's decision on live use. It is not wired in.

## What it learned, and what that means

Most changes are bets where the rule policy checks, half pot or pot, and a smaller share of calls turned into folds or raises. Against these opponents that is right: they fold weak hands to bets and pay off with worse made hands, and version 5 checks too much because its postflop strength is a coarse category score. The model found that from outcomes, not from a rule anybody wrote.

That is also its limit. None of these opponents adapts. A person who notices that this OG bets whenever checked to can raise it off its bluffs; rollouts continue with the rule policy and so cannot price that. The honest claim is a measured one-step improvement over River's rule policy against these synthetic players, not strong poker against people.

## Limits

- Opponents are River's authored styles and rule bots. None is human and none adapts.
- The margins were chosen on held-back training sessions, and the labels continue with the rule policy after the decision, so each estimate is a one-step improvement that the model then applies at several decisions in a hand.
- Two 100-trial equity estimates cost about 25 ms a decision here, fine for a bot's thinking time but the reason the evaluation ran for most of an hour.
- It covers heads-up postflop only. Preflop and multiway decisions stay with the rule policy.

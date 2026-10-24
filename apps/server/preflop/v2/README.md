# Heads-up preflop v2: hand-dependent continuation

These offline packs retain the v1 tree, exact legal-deal weights and equity cache.
The opt-in `v9gp` bot uses these packs. The v1 JSON and text packs are preserved.
The game is no-rake HU NLHE, 0.5/1 blinds, 100 or 200 bb including the blind.
All sizes are total contributions. See [the v1 tree/equity documentation](../README.md).

## Live v9gp path

`bot-v9g-policy.ts` enables `preflopTables: true` together with `offTree: 'resolve'`.
Other variants retain their existing defaults. The shared constructor is exposed
as `v9gp` by the compare, LBR and Slumbot runners.

The effective starting stack includes posted blinds. Choose the nearest exported
depth (100/200bb, ties to 100); clamp outside that interval and count each clamped
hand. `PREFLOP_DEPTHS` and injectable packs leave room for further depths.
Multiply total table targets by the actual posted big blind: at 250/500 the open,
limp raise, 3-bet and 4-bet are 1,250 / 2,000 / 4,500 / 11,000 chips. Apply the
live minimum raise and effective stack cap; jam means the live effective all-in.
Actions that collapse to one live move have their probabilities added for reach.

Off-size raises are bracketed by the available aggressive targets, clamping at
the endpoints. In pot shares after calling, `s = (raiseTo-currentBet)/(pot+call)`,
translate x down to A with probability `(B-x)*(1+A)/((B-A)*(1+x))`, otherwise up
to B ([Ganzfried and Sandholm](https://www.sigecom.org/exchanges/volume_14/2/GANZFRIED.pdf),
section 2.2). A public-prefix seed fixes this translation across live lookup and
range reconstruction; our move sampling uses the supplied policy RNG.
`preflopOffTree` counts translated actions once per hand, including translations
first observed at the flop. Unsupported sequences and missing history fall back
to v6, with separate decision and range fallback counters.

At the flop, both ranges use exact products of their own table action
probabilities per physical combo. The opponent's line defines a table belief,
not a claim about their actual strategy. Board removal and downstream compatible
deal handling remain in place. This path bypasses preflop sampling, smoothing,
pruning and support floors. A translated jam/call still supplies table reach if
the actual non-all-in wager leaves a live flop. Subsequent carried solves keep
the existing v9go behavior.

## Public starting points and uncertainty

1. [GTO Wizard, What Is Equity in Poker?](https://blog.gtowizard.com/what-is-equity-in-poker/)
   (Tombos21, 2022-06-13): the BB's 72o versus a 2.5bb BTN open has approximately
   30% equity, but recovers only 1.02bb from a 5.5bb post-call pot. The implied
   EQR is `(1.02 / 5.5) / 0.30 = 0.6182`. This is an illustrative solver example,
   not a measured distribution or HU calibration: its 5.5bb pot differs from our
   5bb HU pot, and stack/rake/range settings are not fully specified in the text.
2. [GTO Wizard, Equity Realization](https://blog.gtowizard.com/equity-realization/)
   (Andrew Brokos, 2022-11-16): position, range, nut potential and later-street
   play change realisation. Its board-specific examples vary greatly, including
   87% for a weak flush draw and below 25% for a vulnerable pair/draw. Weak bluffs
   can also over-realise; monotonicity in equity is a modelling restriction here,
   not a universal postflop law.
3. [GTO Wizard, Stack-to-Pot Ratio](https://blog.gtowizard.com/stack-to-pot-ratio/)
   (Andrew Brokos, 2022-11-17): SPR changes the value of robust draws versus
   vulnerable made hands. This supports using remaining stack / pot rather than
   stack depth alone; it does not estimate the curve below.

These sources motivate a family and a weak-hand scale. They do not identify the
coefficients. Every coefficient, the bounds, and the SPR half-life are explicit,
uncalibrated priors. No confidence interval for those coefficients is claimed.
We did not fit them to the requested frequency targets. The initial defaults
produced the reported frequencies without a parameter search.

## Functional form and all default parameters

The single default config object is `DEFAULT_HAND_REALISATION` in
`src/bot-preflop-solve-realisation.ts`. A complete JSON replacement can be supplied
with `--realisation path/to/config.json`. Packs embed the exact object and its SHA-256.

For a hero class h and the opponent's current preflop reach at this terminal:

```text
w(h,o) = exactCompatibleDealCount(h,o) * opponentReach(o)
e(h) = sum_o w(h,o) * equity(h,o) / sum_o w(h,o)
q = clamp((e - 0.20) / (0.80 - 0.20), 0, 1)^1

pair = 1 for pocket pairs, else 0
suited = 1 for suited non-pairs, else 0
c(gap) = max(0, 1 - (gap - 1) / 4)
connected = 0 for pairs; otherwise c(highRank - lowRank)
if highRank is ace: connected = max(connected, 0.5 * c(lowRank - 1))
highCard = (highRank - 2) / 12                  # ranks 2..14

deepR = base[position,potType] + equitySlope[position,potType] * q
        + 0.08*pair + 0.10*suited + 0.06*connected + 0.04*highCard
SPR = (effectiveStackBb - matchedContributionBb) / potBb
pressure = SPR / (SPR + 4)
R = clamp(1 + pressure * (deepR - 1), 0.40, 1.50)
netUtilityBb = potBb * e * R - ownPreflopContributionBb
```

| Pot type | IP base | IP equity slope | OOP base | OOP equity slope |
| --- | ---: | ---: | ---: | ---: |
| Limped | 0.78 | 0.65 | 0.43 | 0.80 |
| Single-raised | 0.74 | 0.70 | 0.39 | 0.90 |
| 3-bet+ | 0.70 | 0.75 | 0.36 | 0.95 |

In this fixed tree, the matched contributions classify the flop: 1bb is limped,
2.5bb or 4bb is single-raised (including a limp/raise/call), and 9bb or 22bb is
3-bet+. Short-stack capped raises are all-ins and bypass R. This classification
would need updating if the action abstraction acquired other raise sizes.

For fixed hand/position/pot/SPR, R is nondecreasing in e and stays within bounds.
IP is at least OOP for the same inputs. Suitedness, connectivity and pair bonuses
are nonnegative. As SPR approaches zero, R approaches 1; all-in R is exactly 1.
At 30% equity, 72o OOP in a 100bb 2.5bb called pot (SPR 19.5) has R = 0.63213.
The smaller 3-bet+ base represents stronger-range pressure; lower SPR mitigates it.

R is applied to **equity against the actual card-conditioned opponent range**,
not separately to each opposing hand. Generally `e*R(e) != mean(E*R(E))`.
Trainer flop payoffs therefore recompute reach mass and mean equity each traversal.
Unreachable compatible ranges contribute zero. Fold and all-in payoffs retain
the v1 arithmetic and cached showdown equity.

## Solving and certificate meaning

The alternating DCFR traversal is unchanged except for the dynamic flop values.
The independent class best response and physical-combo best response recompute R
against the opponent reach of the **exported average policy**. They do not average
iteration utilities or reuse trainer flop kernels. Own best responses are valid
because opponent reach is fixed during a unilateral deviation, and the value is
linear in the deviator's own realisation plan. A scalar normal-form toy oracle
independently enumerates all plans and computes range-dependent flop utility.

This is a nonlinear, range-dependent, general-sum surrogate. There is no CFR
convergence theorem claimed here. Reported exploitability is the measured mean
unilateral improvement `(BR0 - V0 + BR1 - V1) / 2`, in bb/hand, within this tree
and this model. It is not `(BR0 + BR1)/2`. It does not measure exploitability in
full poker or bound continuation/equity estimation error. Separate realisation
factors do not conserve the pot; v2 profile values sum to about +0.181bb at 100bb
and +0.212bb at 200bb. Treat the frequencies as model output awaiting calibration.

All four packs use the same v1 equity hash:
`088c145280ed4a7b7ad303a4838430abd17aaf9924536f45dafdad852763b8cb`.
The maximum per-cell approximate 95% equity radius is 1.048 percentage points;
the conservative simultaneous bound is 2.844 points. Neither is a policy error bound.

## Results

Frequencies below are percentages conditioned on the reached node and legal joint
deal, including both players' reaches. Aggregate open/3-bet/raise includes jam;
jam itself is retained separately in JSON and described below.

| Depth / model | BTN fold | BTN limp | BTN open | BB vs 2.5 fold | call | 3-bet+ | BB vs limp check | raise |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100bb v1 | 18.92 | 29.63 | 51.44 | 5.30 | 77.30 | 17.40 | 50.31 | 49.69 |
| 100bb v2 | 14.37 | 36.10 | 49.53 | 30.08 | 52.67 | 17.25 | 52.32 | 47.68 |
| 200bb v1 | 21.32 | 27.75 | 50.93 | 5.72 | 76.80 | 17.48 | 49.09 | 50.91 |
| 200bb v2 | 12.82 | 37.24 | 49.94 | 31.52 | 51.18 | 17.30 | 54.27 | 45.73 |

V2 button plays 85.63% / 87.18%. V2 initial button jam is below 0.001% at both
depths; BB vs open jams 0.00344% / 0.00083%; BB vs limp jams 0.65724% / 0.58647%.
The non-jam raise-4 frequencies versus limps are 47.02198% / 45.14351%.

| Depth / model | Iterations | Exploitability bb/hand | NashConv bb/hand |
| --- | ---: | ---: | ---: |
| 100bb v1 | 200 | 0.000907058 | 0.001814116 |
| 100bb v2 | 300 | 0.000955346 | 0.001910692 |
| 200bb v1 | 800 | 0.000969512 | 0.001939024 |
| 200bb v2 | 900 | 0.000956227 | 0.001912453 |

Both v2 solves meet the 0.001bb target with one thread in a few seconds using the
existing cache. Fresh flat-factor mutation solves exactly reproduce v1 frequencies
and certificates. BB fold changes by +24.776 / +25.807 percentage points in v2.
The cache-independent 12-class mutation fixture is only a regression game, not
a full-game frequency estimate. Tests require its fold change to exceed 5 points.

## Empirical calibration contract

Parameter input is a UTF-8 JSON object matching `HandRealisation`, with exactly:
`model`, `bounds`, `equity`, `sprHalfLife`, `features`, `pots`. The values/keys above
fully specify the schema; the model discriminator is `"hand-equity-v2"`.
Unknown keys, missing values, nonfinite coefficients, negative feature weights,
invalid equity intervals/bounds/half-life and IP curves below OOP are rejected.
Bounds must include 1, and equity power/slopes preserve monotonicity.
`out/preflop-solve/realisation-config.json` is a complete runnable example.
There is no need to change TypeScript to replace any default coefficient.

For later fitting, collect **every** simulated hand reaching a flop leaf,
including later folds, with this JSONL observation schema (numbers are bb):

```json
{"schema":"river-realisation-observation-v1","handId":"example-1","postflopPolicyId":"policy-hash","opponentPolicyId":"opponent-hash","equityTableHash":"hash","nodeId":"button/raise-2.5","handClass":"72o","position":"oop","potType":"single-raised","effectiveStackBb":100,"potBb":5,"ownPreflopContributionBb":2.5,"equityVsOpponentRange":0.30,"netFromHandStartBb":-2.5,"weight":1}
```

`equityVsOpponentRange` is pre-board equity against the stored card-conditioned
opponent reach at that preflop leaf, using the policy/range that generated the
sample. Keep the range or a reproducible policy hash alongside the dataset; do
not substitute equity against the opponent's revealed holding. `netFromHandStartBb`
is payouts/uncalled returns minus **all** hero contributions including blinds.
`weight` is a positive sampling/importance weight (1 for unbiased simulation).
Use both positions; keep policy versions separate and retain split/run seeds.

For observation i, continuation return is
`W_i = netFromHandStartBb_i + ownPreflopContributionBb_i`.
Fit weighted residuals `W_i/potBb_i - e_i * R(h_i,e_i,pos_i,potType_i,SPR_i)`
within the validated family, with uncertainty assessed on held-out hands/runs.
Alternatively, in a narrow hand/equity/position/pot/SPR bin, estimate
`R_hat = sum(weight_i * W_i) / sum(weight_i * potBb_i * e_i)`.
Keep sample counts and second moments or bootstrap units for uncertainty.
Do not clip losing observations, condition only on showdowns, average noisy
per-hand ratios, or pool changing postflop policies. Do not use a zero-equity
bin to estimate a ratio. The collector and fitter below implement this contract.
A short smoke tests the pipeline; it does not establish production coefficients.

## Measuring our bot

`src/bot-realisation-calibrate.ts` runs **v9gp against v9gp**, with the normal
40-round DCFR postflop chain, table preflop at both seats, and fresh hands without
session reads. This measures our continuation policy against a competent copy
of itself, and makes its reconstructed table belief the opponent's generating
preflop strategy. It is an on-policy estimate, not an opponent-independent R.
There is no all-in adjustment or showdown-only selection. Each non-all-in flop
leaf produces two observations, even if either player later folds. Preflop
folds and preflop all-ins produce no continuation observations; shard sidecars
retain their denominator. Alternate seat assignment prevents a fixed seat from
being identified with position. Both players buy in for the requested depth,
including their blinds; final stack minus buy-in includes uncalled returns and
all later contributions. Thus continuation return can be negative.

Equity integrates the **physical** `exactPreflopRanges(trace, [], players)` reach,
removes hero's two cards, samples an opponent by its exact reach weight, and
samples two boards per draw. It never conditions on the actual flop or revealed
opponent holding. `equityTableHash` identifies this estimator rather than the
offline class-equity cache. The default 8,192 opponent draws have a conservative
MC standard-error bound of `0.5 / sqrt(8192) = 0.00553`; increase samples for a
final calibration to check measurement-error sensitivity. SPR is recoverable
exactly as `(effectiveStackBb - ownPreflopContributionBb) / potBb`. New rows also
write this as `spr`; the fitter checks it when present and accepts original v1
rows that omit it.

Each hand has its own `<seed>:<worker>:<handIndex>` deck/action/equity streams.
The index is `shard * handsPerShard + offset`; replay needs no earlier shard.
Complete JSONL shards are renamed from `.part`; interrupted shards are replayed.
Sidecars contain a SHA-256 checked before skipping a completed shard.
Use one process per worker index and distinct output directories for depths.
The manifest pins source, engine, table and model-content hashes, estimator,
seed and shard size. A changed manifest is rejected. Keep it with the JSONL.
The CLI only writes below the current worktree and never invokes git.

The bounded weighted least-squares fitter estimates 16 amplitudes: base and
equity slope in each of six position/pot cells plus the four hand-feature
bonuses. Equity floor/ceiling/power, SPR half-life, connectivity shape and R
saturation bounds stay at their explicit prior values; jointly fitting all
these shape choices needs substantially more SPR/equity coverage. Amplitude
boxes are `[0,3]` for base/slopes and `[0,1]` for feature bonuses. The fitter also
enforces both IP/OOP dominance endpoints and evaluates the clamped R in the
objective. Active-set Gauss-Newton and bounded coordinate updates are
deterministic; inspect `converged` and the residual loss because saturation
makes this a local nonlinear fit. Output passes `parseRealisation` and can be
given directly to `bot-preflop-solve-run.ts --realisation`.

The `.fit.json` sidecar prints fitted/prior coefficients and hand-cluster
sandwich standard errors (both positions from one hand stay in one cluster).
Rank-deficient designs, small samples and active constraints have `null` SEs,
not zero uncertainty. Duplicate hand/position observations, mixed policy IDs,
invalid weights and incompatible equity estimators are rejected. Losing returns
are never clipped. Keep a separate seed/worker set for held-out residual checks;
do not adopt the smoke coefficients as production calibration.

```powershell
$env:RIVER_TURN_NETWORK='<models>/turnend-6/river-buckets-128'
$env:RIVER_FLOP_NETWORK='<models>/flop2-ck50/river-buckets-128'
$env:RIVER_TURN_START_NETWORK='<models>/turnstart-c1-53k-e50/river-buckets-128'
$env:RIVER_RIVER_NETWORK='<models>/night1-buckets/river-buckets-128'
$env:RIVER_VALUE_BACKEND='wasm'
$env:RIVER_VALUE_THREADS='1'
# Repeat this exact command to skip completed shards and resume.
cmd /c npx tsx apps/server/src/bot-realisation-calibrate.ts --seed calibration-100bb-v1 --worker 0 --shards 10 --hands-per-shard 5 --depth 100 --equity-samples 8192 --seconds 540 --out out/realisation-100bb-v1
cmd /c npx tsx apps/server/src/bot-realisation-calibrate.ts --fit --input out/realisation-100bb-v1 --out out/realisation-100bb-v1/realisation.json
cmd /c npx vitest run apps/server/src/bot-realisation-calibrate.test.ts --maxWorkers 1 --no-file-parallelism
cmd /c npx tsc -p apps/server --noEmit
cmd /c npx biome check apps/server/src/bot-realisation-calibrate.ts apps/server/src/bot-realisation-fit.ts apps/server/src/bot-realisation-calibrate.test.ts
```

Collection defaults to one value thread and rejects more than four. `--seconds`
is checked between hands, capped at 600; an in-flight synchronous policy solve
cannot be interrupted. Keep shards small enough to finish within the budget.
Fit planning fields extrapolate SE as `sqrt(pilotHands / futureHands)`, assuming
the same sampling distribution. A run-size decision requires a larger pilot
with all pot types represented, separate validation seeds and coverage at both
100bb and 200bb; a 50-hand smoke cannot identify rare-cell uncertainty reliably.

The 2026-10-24 100bb smoke played 50 hands in 310.156 seconds with the four
models above, WASM and one value thread: **580.35 dealt hands/hour/worker**,
21 flop hands, 42 observations, 16 postflop folds and 11 negative continuation
returns. All 21 pairs conserve net chips and their continuation returns sum to
the initial flop pot. A final-code replay reproduces the first hand's equity
and outcome exactly; a second invocation skips its checksummed shard.
See `out/realisation-smoke-20261024/report.md`, `planning.json`, and
`realisation.json.fit.json` for the commands, planning calculation and fit.
The smoke fit is rank-deficient and has null standard errors; do not deploy it.

A rough two-coefficient-per-cell planning calculation (holding hand features
fixed, using observed return variance and reach frequency) suggests about
0.6–15.5 million dealt hands for base SE 0.03, and 3.7–56.8 million for slope
SE 0.03 in limped/single-raised cells. The one observed 3-bet flop gives no
precision estimate. These are unstable pilot extrapolations, not guarantees;
the joint fit can need more. Start with **10,000 hands per depth** on distinct
training/held-out seeds and re-estimate. At the measured 100bb speed this is
34.5 worker-hours for 20,000 hands; 200bb throughput remains unmeasured. Do not
launch a multi-million-hand fleet based on this smoke alone.

```powershell
node_modules/.bin/tsx.cmd apps/server/src/bot-preflop-solve-run.ts --depth 100 --target 0.001 --seconds 60 --iterations 10000
node_modules/.bin/tsx.cmd apps/server/src/bot-preflop-solve-run.ts --depth 200 --target 0.001 --seconds 60 --iterations 10000
# Export defaults as JSON for editing/fitting, then run with that config.
node_modules/.bin/tsx.cmd out/preflop-solve/v2-validation.ts --prepare
node_modules/.bin/tsx.cmd apps/server/src/bot-preflop-solve-run.ts --depth 100 --realisation out/preflop-solve/realisation-config.json --output-dir out/preflop-solve/injected --target 0.001 --seconds 60 --iterations 10000
# Flat mutations write to out/preflop-solve/flat; v1 is protected.
node_modules/.bin/tsx.cmd apps/server/src/bot-preflop-solve-run.ts --depth 100 --flat --target 0.001 --seconds 60 --iterations 10000
node_modules/.bin/tsx.cmd apps/server/src/bot-preflop-solve-run.ts --depth 200 --flat --target 0.001 --seconds 60 --iterations 10000
node_modules/.bin/tsx.cmd out/preflop-solve/v2-validation.ts
node_modules/.bin/vitest.cmd run apps/server/src/bot-preflop-solve.test.ts apps/server/src/bot-preflop-solve-realisation.test.ts --maxWorkers 1 --no-file-parallelism
node_modules/.bin/tsc.cmd --noEmit --pretty false
```

All these validation commands exited 0. The initial typecheck exposed the old toy
oracle's flat-only parameter assumption; it was extended and the final check passes.
`--ip`/`--oop` require `--flat`; `--flat` and `--realisation` cannot be combined.
The default output is v2, and the CLI rejects the v1 output directory. Runs are
single-threaded, capped by `--seconds` (maximum 480), and reuse the equity cache.
No expensive equity regeneration was necessary for this delivery.

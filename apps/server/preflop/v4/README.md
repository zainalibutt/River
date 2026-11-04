# Solver-value realisation calibration pilot

These candidate packs use the v3 action tree and a fitted continuation config.
Production still loads v3. A finite-tree certificate does not establish a Slumbot
win-rate improvement. The fit measures the production flop solver with its learned
turn-start leaves, including any network and 40-round solver error.

## Recorder and observation contract

`src/bot-realisation-solver-calibrate.ts` enumerates every non-all-in flop
terminal in the 100/200 bb v3 packs. It uses the production
`exactPreflopRanges` to multiply every physical holding's table action
probabilities. There is no range normalization, support floor, or pruning.
Flop solver ordering is BB/OOP first, button/IP second.

Sampling is balanced over 12 depth/stratum cells: limped, open 2, open 2.5,
open 3, limp isolation, and three-bet-plus, at each depth. Within a cell,
terminals are sampled proportional to exact compatible joint preflop reach.
Public flops are uniform without replacement from the 52-card deck. Board
blockers are then removed from both ranges. Each holding receives its raw
own table reach as its regression weight, as requested. Thus the objective
is this stratified, own-reach-weighted design, not the live hand-frequency
distribution or a joint-reach-weighted objective.

Every spot uses live chip units (100 chips/bb), 0.66-pot bets, all-ins, one
raise, DCFR(1.5,0,2) for 40 rounds, production `perTurnShowdown`, and the
turn-start network with WASM inference. All-in branches retain production's
60-runout estimator. Root values are read with `riverValues`: this evaluates
the exported average strategy with network leaves queried at its profile
reaches. It is not an average of the network queries during CFR, nor a sample
of final hand results. No claim about safety of the whole resolving chain is
made by this measurement.

The existing JSONL schema `river-realisation-observation-v1` gains:

- `valueSource: "flop-solver"`, `holdingId` (sorted physical card keys), and
  `board` (three public cards). Duplicate identity is hand/flop, position,
  holding; all rows sharing `handId` are one independent uncertainty unit.
- `stratum`, `rootCFVChips`, `compatibleMass`, `chipsPerBb`, `rootValuePots`,
  and `realisedFraction`. A zero-equity fraction is null, never infinity.

The value identities, checked by the fitter, are
`V_bb = rootCFVChips / compatibleMass / chipsPerBb`,
`rootValuePots = V_bb / potBb`,
`netFromHandStartBb = V_bb - ownPreflopContributionBb`, and
`R = rootValuePots / equityVsOpponentRange` where equity is positive.
`riverValues` already divides CFVs by compatible mass; the recorder does not
divide its values again or add a contribution to a flop-origin value.
Negative values and ratios outside the model's bounds are retained.

Equity is exact on each flop: enumerate all 1,176 public turn/river pairs,
settle weighted ranges by sorted-strength blocker sweeps, skip holdings
blocked by each runout, and divide the sum by `990 * compatibleMass`.
Each compatible pair of holes leaves exactly `C(45,2)=990` runouts. No revealed
opponent cards are used. This equity integration is independent of the solver's
sampled all-in leaves.

One seed stream identifies `<seed>:<worker>:<flopIndex>`; terminal and board
streams are separate. Worker indices provide independent boards. Complete
JSONL shards and checksum sidecars are atomically renamed from `.part` files;
incomplete shards replay. A manifest pins recorder/solver sources, model and
table contents, settings, estimator and sampling design. Use one process per
worker index. A parent process enforces a 570-second child timeout so a
synchronous solve cannot exceed the light-run limit; completed shards survive.
Resume with the same command, or increase `--shards`. Changed manifests fail.

## Fitting and interpretation

`--fit` reuses the bounded 16-amplitude fitter. The model's bounds,
equity transform, SPR half-life, and feature shapes remain fixed. The fit
minimizes own-reach-weighted squared error in continuation pots, rather than
unweighted error in noisy ratios. SEs are flop-cluster sandwich estimates;
both positions and every holding of a flop stay together. Null SEs mean an
active constraint, insufficient independent flops, or rank deficiency.
The report includes per-parameter extrapolation to SE 0.02 and held-out error
for the entire independent worker and for each depth/stratum cell.

This pilot fits **flop-conditional equity**, as specified. Preflop generation
uses **pre-board equity** and applies a nonlinear realisation curve after
averaging equity. Those operations generally do not commute. Consequently,
even very small flop-fit SEs do not validate transport into the preflop
surrogate. A fleet run should also aggregate values and equity by terminal,
holding and position across independent flops, then validate a pre-board
calibration against held-out terminal/holding means before adopting a pack.
Learned-network bias, finite DCFR error, fixed shape restrictions, and changes
in the ranges after re-solving are outside the sampling SE.

## Pilot results, 2026-10-25

60 flops produced 141,120 holding rows. Worker 0 supplies 36 training flops
(84,672 rows), three per depth/stratum cell. Independent worker 1 supplies
24 held-out flops (56,448 rows), two per cell. Every flop supplied 1,176 live
holdings at each seat. Both worker restarts verified and skipped every
completed shard. Raw JSONL, checksum sidecars and execution logs are in
`out/realisation-solver-pilot/`.

A fresh production-WASM replay of worker 0's first flop also reproduced the
manifest and all 2,352 JSONL rows byte-for-byte. Shard SHA-256:
`27ab1cfd550aa1a283103ce14d9df5fe8f9d8f2e960fe458262773523d780fdc`.
The replay command was the worker-0 command below with `--shards 1`,
`--seconds 60`, and `--out out/realisation-solver-replay`; it exited 0.

The turn-start export was read from
`<models>/turnstart-c1-53k-e50/river-buckets-128`.
The raw-run manifest pins its content hash. No other network is needed for
flop root solving. The preflop equity cache was copied into this worktree
from `out/preflop-solve/equity-v1-8192.json`; its validated
hash matches v3, `088c145280ed4a7b7ad303a4838430abd17aaf9924536f45dafdad852763b8cb`.

The fitter converged in 106 iterations. Its previous 80-iteration cap was
insufficient for the clamped objective; the cap is now 400, with parameter
and relative-objective convergence diagnostics. The final parameter change
was 2.79e-7 and relative objective improvement 5.16e-13. The fitted config
hash is `0076db612d4d72b9f8de4083b8a68e254910caf5a1ed28e40ed5497d85498880`.

| Parameter | Prior | Fitted | Flop-cluster SE |
| --- | ---: | ---: | ---: |
| limped IP base | 0.780 | 0.51117 | 0.27034 |
| limped IP slope | 0.650 | 0.99727 | 0.33808 |
| limped OOP base | 0.430 | 0 | null, bound |
| limped OOP slope | 0.800 | 1.38603 | 1.05383 |
| single-raised IP base | 0.740 | 0.00494 | 0.13875 |
| single-raised IP slope | 0.700 | 1.60999 | 0.27082 |
| single-raised OOP base | 0.390 | 0 | null, bound |
| single-raised OOP slope | 0.900 | 1.52901 | 0.32189 |
| three-bet-plus IP base | 0.700 | 0 | null, bound |
| three-bet-plus IP slope | 0.750 | 1.72542 | 0.52658 |
| three-bet-plus OOP base | 0.360 | 0 | null, bound |
| three-bet-plus OOP slope | 0.950 | 1.66345 | 0.53360 |
| pair | 0.080 | 0.13763 | 0.09743 |
| suited | 0.100 | 0.03192 | 0.04193 |
| connected | 0.060 | 0.03196 | 0.07890 |
| highCard | 0.040 | 0 | null, bound |

Full precision and per-parameter SE-0.02 projections are in
[realisation.json.fit.json](realisation.json.fit.json). Five active-bound
coefficients have no regular two-sided SE. These are local cluster-sandwich
diagnostics for the constrained fit, not coverage guarantees at boundaries.
The 141,120 rows do not represent that many independent boards. Contrary to
the hoped-for tiny pilot errors, residual board variation remains substantial;
this run does not establish an SE improvement over the earlier results-based
pilot without a matched-data comparison.

| Own-reach-weighted continuation error, pots | Prior | Fitted |
| --- | ---: | ---: |
| Training RMSE, 36 flops | 0.347036 | 0.317699 |
| Held-out RMSE, 24 flops | 0.375720 | 0.346246 |
| Training mean residual | -0.063464 | -0.017917 |
| Held-out mean residual | -0.067568 | -0.022425 |

Held-out RMSE improves by 7.84%. All 12 held-out cells improve on the prior;
individual cells have only two independent flops. The largest residual is
200 bb open-2.5, RMSE 0.580253 pots. Inspect the full cell report before
interpreting pooled averages.

## Candidate pack comparison

Frequencies are percentages conditioned on compatible joint node reach.
BB 3-bet includes jams; button open totals also include negligible jams.

| Depth/version | BB vs 2 fold | call | 3-bet | Button fold | limp | opens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 bb v3 | 19.61 | 57.97 | 22.42 | 15.30 | 29.60 | 55.11 |
| 100 bb v4 | 40.85 | 36.62 | 22.53 | 30.60 | 28.71 | 40.69 |
| 200 bb v3 | 20.03 | 58.46 | 21.51 | 13.89 | 30.23 | 55.88 |
| 200 bb v4 | 41.69 | 36.88 | 21.43 | 30.52 | 28.63 | 40.85 |

| Depth/version | Button open 2 | open 2.5 | open 3 |
| --- | ---: | ---: | ---: |
| 100 bb v3 | 29.06 | 7.70 | 18.35 |
| 100 bb v4 | 35.70 | 4.43 | 0.55 |
| 200 bb v3 | 33.34 | 8.77 | 13.77 |
| 200 bb v4 | 35.85 | 4.74 | 0.27 |

Final 100 bb solve: 700 iterations, 25.724 seconds, exploitability
0.000887499 bb/hand. Final 200 bb solve: 1,300 iterations, 45.613 seconds,
exploitability 0.000980531 bb/hand. Both meet 0.001 in the finite surrogate.
Class and physical-combo best responses agree, and tests independently
recompute certificates and all node frequencies from the exported packs.
The config-to-pack hash was also checked. V3 packs and production selection
were preserved. No live match was run.

## Commands and exit codes

Run from the worktree root, with these environment settings. Each invocation
is below ten minutes; at most two collection/solve workers ran together here.

```powershell
$env:UV_THREADPOOL_SIZE='1'
$env:OMP_NUM_THREADS='1'
$env:OPENBLAS_NUM_THREADS='1'
$env:NODE_OPTIONS='--v8-pool-size=1'
$env:RIVER_VALUE_THREADS='1'
$env:RIVER_TURN_START_NETWORK='<models>/turnstart-c1-53k-e50/river-buckets-128'

cmd /c npx tsx apps/server/src/bot-realisation-solver-calibrate.ts --seed solver-pilot-20261025 --worker 0 --shards 36 --seconds 480 --out out/realisation-solver-pilot
cmd /c npx tsx apps/server/src/bot-realisation-solver-calibrate.ts --seed solver-pilot-20261025 --worker 1 --shards 24 --seconds 480 --out out/realisation-solver-pilot
# Same commands resume; our verification used --seconds 60 and skipped all shards.
cmd /c npx tsx apps/server/src/bot-realisation-solver-calibrate.ts --fit --input out/realisation-solver-pilot --heldout-worker 1 --out apps/server/preflop/v4/realisation.json
cmd /c npx tsx apps/server/src/bot-preflop-solve-run.ts --depth 100 --tree v3 --pack-version v4 --seconds 180 --target 0.001 --realisation apps/server/preflop/v4/realisation.json --output-dir apps/server/preflop/v4
cmd /c npx tsx apps/server/src/bot-preflop-solve-run.ts --depth 200 --tree v3 --pack-version v4 --seconds 180 --target 0.001 --realisation apps/server/preflop/v4/realisation.json --output-dir apps/server/preflop/v4
cmd /c npx vitest run apps/server/src/bot-realisation apps/server/src/bot-preflop-solve apps/server/src/bot-flop-turn-leaves.test.ts --maxWorkers=1 --no-file-parallelism
cmd /c npx tsc -p apps/server --noEmit
cmd /c npx biome check apps/server/src/bot-realisation-solver-calibrate.ts apps/server/src/bot-realisation-solver-calibrate.test.ts apps/server/src/bot-realisation-fit.ts apps/server/src/bot-preflop-solve-output.ts apps/server/src/bot-preflop-solve-run.ts apps/server/src/bot-preflop-solve-realisation.test.ts apps/server/src/bot-preflop-solve.test.ts
```

Fit, both final pack solves, checksum restarts, tests (5 files, 59 tests),
typecheck and final scoped lint exit 0. Initial PowerShell collection wrappers
exited 1 because `*>` converted stderr progress into `NativeCommandError`;
both collectors nevertheless completed their requested flops. Corrected
logging inside CMD (`> log 2>&1`) with `exit $LASTEXITCODE` avoided this shell
artifact. Checksum restarts exited 0 and verified all 60 complete shards.
The initial fit exited 0 but reported `converged: false`; its 80-iteration
limit was extended and both candidate packs were regenerated from the
converged config. Initial Biome checks reported formatting/lint issues that
were corrected before final checks. No tests or typechecks failed.

Tests cover independently enumerated tiny-spot equity, compatible-mass units,
negative values, contribution origin, exact table-reach products, both depths
and every size stratum, 40-round production per-turn replay, interrupted-shard
replay, corruption rejection, known-parameter recovery and deterministic fits.
Duplicating every holding at half weight preserves flop-cluster SEs, guarding
against counting within-flop rows as independent observations.

## Laptop fleet recommendation

Workers measured **484.59** and **469.01 flops/hour** on this machine, one
value thread each, including collection setup. Use **475 flops/hour/worker**
for provisional planning and benchmark the laptop before assuming that rate.

First collect **2,400 training + 600 independent held-out flops**, balanced
across all 12 cells, then revisit fit shape, active constraints, SEs and
pre-board transport. This is about 6.3 worker-hours at the measured rate.
Use distinct worker IDs and manifests/output directories for independent
experiments. Preserve the entire flop as the resampling/holdout unit.
For a fleet with several held-out workers, separate train/validation shard
directories and pool them through the exported `fitRealisation` and
`realisationError` APIs; the convenience pilot CLI reserves one held-out
worker ID.

For the unchanged sampling design, parameter-wise planning uses
`N = ceil(36 * (pilotSE / 0.02)^2)`. The largest finite main-parameter
projection is **99,951 training flops**, from the limped OOP slope. Rounded
to full cells, use **100,008 training + 25,008 held-out flops** if the staged
pilot supports scaling. This is about **263 worker-hours**, or **4.1 ideal
hours on 64 single-thread workers**, plus scheduling/I/O and hardware effects.
Active-bound parameters have no finite two-sided-SE projection. Boundary
bootstrap/profile uncertainty and model/network error must be assessed
separately. This extrapolation is a budget estimate, not a precision promise.

The conservative recommendation is to keep these packs as candidates, resolve
the flop/pre-board calibration mismatch, and check on-policy range shifts
before a large performance run. [pilot-summary.json](pilot-summary.json)
contains the exact frequencies, fit parameters, planning fields and exit codes.

Changed sources are `src/bot-realisation-solver-calibrate.ts`, its test,
`src/bot-realisation-fit.ts`, `src/bot-preflop-solve-{run,output}.ts`,
`src/bot-preflop-solve-{realisation.test,test}.ts`, plus the preflop README
link and this v4 directory's config, fit report, summary and JSON/text packs.
All writes stayed in this worktree. No git command, commit or push was used.

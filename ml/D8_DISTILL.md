# D8 part 4: live-leaf inference and distillation

Implementation and local TS verification are complete. Python was not executed.
Student accuracy, exported-student parity, and total CUDA runtime remain for
Claude's run. No live policy default was changed. No git operations were used.

## Local measurements

Real spot: the first case in `art/out/d8-expanded/feature-cases.json`, actual
frozen teacher seed 0. Two logical cores by affinity, one inference participant,
both players and every legal holding. Values below are **median ms/spot**;
components are separate microbenchmarks and do not add exactly to total latency.
The original measurements used 10 warmups/50 visits; final measurements use
100 warmups/50 visits to reduce JIT effects. Card preparation excludes the
already available expected-strength ranks and is excluded from cached visits.

| Component | Original TS | Original WASM | Optimised TS | Optimised WASM |
| --- | ---: | ---: | ---: | ---: |
| Card features, once per board | 0.690 | 0.707 | 0.553 | 0.572 |
| Range normalisation and pools | 0.401 | 0.200 | 0.143 | 0.159 |
| Holding feature assembly | 0.463 | 0.482 | 0.305 | 0.261 |
| Head matmuls | 53.985 | 11.261 | 44.145 | 7.841 |
| Bucket forward | 1.110 | 0.300 | 1.064 | 0.193 |
| Complete cached visit | **55.797** | **13.064** | **46.609** | **8.908** |

The original head was already batched. Changes remove the 396 board-blocked
player/holding rows, convert the two pooled vectors to f32 once per visit,
avoid clearing fully overwritten compact feature buffers, use bulk typed-array
copies in WASM, and share each weight-vector load across eight batch rows.
The SIMD lane reduction and scalar tails retain their original arithmetic
order; existing bit-level regression tests pass. The kernel is rebuilt with
`node apps/server/tools/build-value-simd.mjs`. Caller-visible hidden buffers
still receive their outputs, preserving the general inference API.

| Model | c1 MAE | c2 MAE | TS ms | WASM median ms | WASM mean / p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Original teacher, seed 0 | 4.5814 | 4.5653 | 55.797 | 13.064 | 14.405 / 24.411 |
| Optimised teacher, same weights | 4.5814 | 4.5653 | 46.609 | 8.908 | 9.269 / 10.956 |
| 16 student shape, random weights | pending | pending | 3.424 | 1.095 | 1.129 / 1.461 |
| 32 student shape, random weights | pending | pending | 5.703 | 1.720 | 2.351 / 4.039 |
| 32x2 student shape, random weights | pending | pending | 7.485 | 1.983 | 2.006 / 2.476 |

Teacher MAEs above come from the existing completed part-3 result, not new
solver scoring. All three teachers' existing actual PyTorch fixtures were
rechecked in both backends: 30 spot/backend cases, worst output error
`1.430511474609375e-6`. Random-weight shape timings demonstrate capacity cost,
not the trained student's accuracy or final latency. JSON reports, including
means and p95s, are in `art/out/d8-live/before-*.json` and `final-*.json`.
The 32x2 shape is close to the median target; tail latency remains visible.

## Claude command

From the worktree root, with `$Python` set to the CUDA PyTorch interpreter:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./ml/d8_distill.ps1 -Python $Python
```

Read-only estimate, requiring no Python:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./ml/d8_distill.ps1 -EstimateOnly
```

All default paths resolve from the script's worktree root, regardless of the
invocation directory. Override `-Cache`, `-Teacher`, `-Part3`, `-Packed`, or
`-Out` if necessary. The runner requires a new output directory, preserves
previous runs, rejects partial/probe packs, and forbids overlapping inputs
and outputs. All outputs and temporary/cache directories stay in the worktree.
The existing `d8-expanded` cache is read only and is never re-prepared.

## Training contract and budget

Use fixed frozen teacher seed **0 for every student seed**. This measures
student initialisation variance against one fixed teacher, rather than mixing
teacher variance into student comparisons. The copied bucket JSON/binary stay
byte identical to that teacher. Heads are `65 -> 16 -> 1`, `65 -> 32 -> 1`, and
`65 -> 32 -> 32 -> 1`, PReLU, no dropout. Adam lr .001, cosine schedule,
512 spots/batch, SmoothL1 beta .1. Loss is solver value loss plus equally
weighted teacher residual loss; teacher inference has gradients disabled.
Solver loss uses all legal holdings too, without range weighting, as the
original sampled held-hand training did. Evaluation uses exact range weights.

Every training spot contributes **both players and all 1,128 legal holdings**.
Sixteen disjoint holding partitions cover that full set once per fit. These
are coverage passes, not 16 repetitions of the full 1,128-holding dataset.
All passes must finish; there is no early stopping that could omit holdings.
The packed holding order `(legalOrdinal * 37) % 1128` is a bijection that
spreads each contiguous partition across the original card ordering. Spot
blocks are shuffled per pass; contiguous holding stripes limit disk reads.
Neither test nor calibration spots receive any optimiser steps. The original
c1 split, independent c2 split and both cohort identities are validated.

The supplemental f32 factorised pack stores static19, blockers5/player,
solver2, weights2 and bucket1 per holding; log SPR, two pools and bucket
outputs are shared per spot. It occupies **34.995 GB**, versus about 132.8 GB
for duplicated full 65-feature rows. Reserve at least **39 GB free**. Packing
streams the pinned, SHA-verified source shards and writes the completion
marker last. A complete pack is reused, with SHA-256 validation of both arrays,
teacher exports, original split and snapshot on every fit. Python gathers a
single holding stripe before copying to CUDA; no full cache upload or resident
dataset tensor is created. Dataset size does not determine GPU memory use.

The runner first fits seed 0 for all three architectures, selects by WASM
median <=2 ms then minimum worst-cohort **calibration** MAE (speed breaks ties),
and runs seeds 1/2 for the winner: **five fits total**. Test scores do not
participate in selection. Calibration and test scoring stream all holdings
with normalised range weights; separate c1/c2 scores and D8 slices are retained.
Every student export gets five actual CPU PyTorch cases, including an empty
opponent range, and both TS/WASM absolute error gates at `1e-5`.

The printed estimate uses actual part-3 preparation, fit and evaluation times:

| Stage | Projected minutes |
| --- | ---: |
| Supplemental pack, budgeted at measured part-3 prepare time | 11.90 |
| Each student fit: measured max fit x 1128/(16x50) x 1.25 | 5.67 |
| Each calibration/test score: measured max exact evaluation allowance | 3.60 |
| Five fits and scores | 46.35 |
| Tests, parity and profiles | 6.00 |
| Hash and extra I/O allowance | 5.00 |
| Total, fresh supplemental pack | **69.24** |
| Total, verified pack reused | **57.35** |

The 25% multiplier is an unmeasured teacher/I/O allowance. This is a projection
for the RTX 2060 Super, not a demonstrated completion time. The all-holding
workload is 1.41 times the original 50x16 sampled holding count. Cache scoring
avoids rebuilding NumPy card features for every test spot. A real 100-spot
packing probe completed in 0.563 s locally, excluding startup/hash checks;
do not extrapolate that small warm-cache probe as a full disk throughput claim.

A **75-minute wall-clock deadline includes every stage**, hashing, packing,
training, scoring, exports, parity and summary. A watchdog kills the current
process tree and records child exit 124 on timeout. Failures stop immediately.
The runner prints/logs the estimate before work and rejects estimates >=75 min.
`commands.json` retains per-stage exit codes and durations. `summary.json`,
`summary.csv`, and `summary.md` compare teacher full-reference/current kernel,
optimised teacher, all students and all winner seeds, with per-cohort MAE and
both backends' measured trained-export speed. Three-seed sample SD is included.
Summary exit 2 means accuracy/speed gates failed; its diagnostic report remains.
Success requires every winning seed <=4.9 on both cohorts, median WASM <=2 ms,
all parity checks, and the runner's final `complete.json` within 75 minutes.

## Files and verification

Changed inference files: `bot-turn-residual.ts`, its tests and benchmark;
`bot-value-simd.ts`, `bot-value-simd-bytes.ts`, and
`apps/server/tools/build-value-simd.mjs`.

New server files, under `apps/server/src/`:
`bot-turn-residual-distill.ts`, `bot-turn-residual-distill.test.ts`,
`bot-turn-residual-distill-prepare.ts`, `bot-turn-residual-distill-summary.ts`,
and `bot-turn-residual-distill-summary.test.ts`.

New ML files: `turn_residual_distill.py`, `train_turn_residual_distill.py`,
`test_turn_residual_distill.py`, `d8_distill.ps1`,
`test_d8_distill_runner.ps1`, and this document. Existing parity exporter is
reused unchanged. No dependency installation is required.

Local commands (two-core affinity, UV pool 2, inference participants 1):

```powershell
cmd /c npx vitest run apps/server/src/bot-turn-residual apps/server/src/bot-value-simd apps/server/src/bot-value-workers --maxWorkers=1
cmd /c npx tsc -p apps/server --noEmit
cmd /c npx biome check apps/server/src/bot-turn-residual.ts apps/server/src/bot-turn-residual.test.ts apps/server/src/bot-turn-residual-benchmark.ts apps/server/src/bot-turn-residual-distill.ts apps/server/src/bot-turn-residual-distill.test.ts apps/server/src/bot-turn-residual-distill-prepare.ts apps/server/src/bot-turn-residual-distill-summary.ts apps/server/src/bot-turn-residual-distill-summary.test.ts apps/server/src/bot-value-simd.ts apps/server/src/bot-value-simd-bytes.ts apps/server/tools/build-value-simd.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File ml/test_d8_distill_runner.ps1
```

Vitest: **31/31, exit 0**. Server tsc: **exit 0**. Biome: **exit 0**.
Runner parser, real child argument quoting, failure propagation and pre-launch
deadline: **exit 0**. Estimate-only and bounded real packing probe: **exit 0**.
Existing teachers' six parity commands: **exit 0**, worst error 1.43e-6.
Python tests, CUDA training, student MAEs, student parity and measured total
runtime are **not executed here**. The runner executes the Python tests first.
Those cover exhaustive partition coverage, independent TS feature goldens,
fixed-teacher gradients and exact cohort/range-weighted scoring.
The TS summary test rejects incomplete coverage and a failing second cohort;
it uses isolated synthetic fixtures, never training outputs.

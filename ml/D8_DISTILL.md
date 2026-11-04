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

## Claude commands

From the worktree root, with `$Python` set to the CUDA PyTorch interpreter:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./ml/d8_distill.ps1 -Python $Python -Smoke
powershell -NoProfile -ExecutionPolicy Bypass -File ./ml/d8_distill.ps1 -Python $Python
```

Read-only estimate, requiring no Python:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./ml/d8_distill.ps1 -EstimateOnly
```

All default paths resolve from the script's worktree root, regardless of the
invocation directory. Override `-Cache`, `-Teacher`, `-Part3`, `-Packed`, or
`-Out` if necessary. Reuse the same output directory for smoke and full runs.
The runner resumes completed stages using source/input-bound receipts and
artifact hashes; missing, invalid or changed artifacts rerun their stage.
Model/fixture dependencies invalidate downstream exports, parity and profiles.
Partial fits restart; this is stage resumption, not optimiser checkpointing.
It rejects partial/probe packs and forbids overlapping inputs
and outputs. All outputs and temporary/cache directories stay in the worktree.
The existing `d8-expanded` cache is read only and is never re-prepared.

## Training contract and budget

Use fixed frozen teacher seed **0 for every student seed**. This measures
student initialisation variance against one fixed teacher, rather than mixing
teacher variance into student comparisons. The copied bucket JSON/binary stay
byte identical to that teacher. Heads are `65 -> 16 -> 1`, `65 -> 32 -> 1`, and
`65 -> 32 -> 32 -> 1`, PReLU, no dropout. Adam lr .001, cosine schedule,
65,536 player/holding rows per student batch, SmoothL1 beta .1. Loss is solver
value loss plus equally weighted cached teacher residual loss; teacher inference
has gradients disabled. At most two CPU threads are used.
Solver loss uses all legal holdings too, without range weighting, as the
original sampled held-hand training did. Evaluation uses exact range weights.

Every training spot contributes **both players and all 1,128 legal holdings**.
Sixteen disjoint holding partitions cover that full set once per fit. These
are coverage passes, not 16 repetitions of the full 1,128-holding dataset.
All passes must finish; there is no early stopping that could omit holdings.
The packed holding order `(legalOrdinal * 37) % 1128` is a bijection that
spreads each contiguous partition across the original card ordering. Chunks
of up to 2,048 contiguous spots are read once into RAM, pinned and bulk-copied
to CUDA. Training spots are selected on GPU; each chunk stays resident for all
16 stripes, with row permutations and vectorised feature gathering on GPU.
There is no student-batch disk I/O or per-row Python work. This chunk-major
order and larger batches change SGD ordering and step count; accuracy gates
must be remeasured rather than inferred from the old run.
Neither test nor calibration spots receive any optimiser steps. The original
c1 split, independent c2 split and both cohort identities are validated.

The supplemental f32 factorised pack stores static19, blockers5/player,
solver2, weights2 and bucket1 per holding; log SPR, two pools and bucket
outputs are shared per spot. It occupies **34.995 GB**, versus about 132.8 GB
for duplicated full 65-feature rows. The runner requires the existing complete
`art/out/d8-distill-packed` pack and never rebuilds it. Both packed arrays,
teacher exports, original split and snapshot are SHA-validated on each fit.
Only one chunk is resident, keeping RAM/VRAM bounded on the 32 GB/8 GB machine.
Teacher residual shards are computed once in GPU batches and persisted under
the pack's `teacher-targets-v2` directory. Their manifests bind teacher, split,
packed hashes and chunk bounds; interrupted/corrupt shards are regenerated.
Later fits read those shards once per chunk, without repeating teacher inference.
Allow extra disk space for training targets (4 bytes per player/holding row).

The runner first fits seed 0 for all three architectures, selects by WASM
median <=2 ms then minimum worst-cohort **calibration** MAE (speed breaks ties),
and runs seeds 1/2 for the winner: **five fits total**. Test scores do not
participate in selection. Calibration and test scoring stream all holdings
with normalised range weights; separate c1/c2 scores and D8 slices are retained.
Every student export gets five actual CPU PyTorch cases, including an empty
opponent range, and both TS/WASM absolute error gates at `1e-5`.

Run 1 on the RTX 2060 Super packed holdings in 16.3 minutes, then completed
only 7/16 coverage passes in 3,380 seconds (roughly 430 seconds/pass, GPU about
7% busy). Scattered memmap reads across every holding stripe and repeated
CPU/GPU transfers starved the GPU. Teacher targets were evaluated once per
covered row within a fit, but repeated for every architecture and seed.

`-Smoke` runs the first h16 coverage pass over every training spot using the
same 16-pass partition and large-batch feed. It prepares reusable teacher
targets, measures a warm target read, and writes `smoke-h16/smoke.json` plus
`smoke-projection.json`. No student export or full-fit completion is produced.
Reported seconds/pass separate student work from setup, chunk loads and target
preparation. The five-fit projection scales measured student time by dense
multiply counts for h32/deep, assumes the widest winner for the last two seeds,
and includes measured setup/load/target-read times per fit. Scoring uses prior
part-3 timings; tests/parity/profiles have an explicit allowance. It is advisory,
not a measured full run or speed guarantee. Smoke target preparation is a
separate one-time cost already paid before the full run.

There is no total-runtime cap, estimate refusal or watchdog. Stages report their
elapsed minutes and total elapsed minutes, including a heartbeat every 30 seconds.
Failures stop immediately. The legacy `-EstimateOnly` projection remains advisory;
use smoke measurements for the new feed.
`commands.json` retains per-stage exit codes and durations. `summary.json`,
`summary.csv`, and `summary.md` compare teacher full-reference/current kernel,
optimised teacher, all students and all winner seeds, with per-cohort MAE and
both backends' measured trained-export speed. Three-seed sample SD is included.
Summary exit 2 means accuracy/speed gates failed; its diagnostic report remains.
Success requires every winning seed <=4.9 on both cohorts, median WASM <=2 ms,
all parity checks, and the runner's final `complete.json` after validated stages.

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
Runner parser, real child argument quoting, resume validation, corrupt-result and
changed-dependency recovery, failure propagation and removed runtime cap are
covered by the PowerShell-only test. Estimate-only and bounded real packing
probe measurements above describe the original implementation.
Existing teachers' six parity commands: **exit 0**, worst error 1.43e-6.
Python tests, CUDA training, student MAEs, student parity and measured total
runtime are **not executed here**. The runner executes the Python tests first.
Those cover exhaustive partition coverage, vectorised feed equivalence, cached
loss/gradient equivalence, target-cache reuse/repair, holdout exclusion,
independent TS feature goldens and exact cohort/range-weighted scoring.
The TS summary test rejects incomplete coverage and a failing second cohort;
it uses isolated synthetic fixtures, never training outputs.

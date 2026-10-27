# D8 part 3: c1+c2 data scaling

Implementation is ready for Claude's Python/CUDA run. The actual source data,
part-1 cache and part-2 timing outputs were not present in this checkout during
implementation. No real expanded cache or training results have been produced.
Python execution is deliberately left to Claude.

## Command for Claude

From the worktree root, set `$Python` to the working CUDA PyTorch interpreter and
`$C1Cache` to the existing part-1 cache directory (normally `art/out/d8`). The
following derives the three c1 directories in their historical snapshot order,
and locates the two c2 directories beside them. Keep the original cache and its
source paths available; it is read only and is never copied or regenerated.

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
$C1Cache = 'art/out/d8' # existing cache; change if stored elsewhere
$c1 = Get-Content -Raw (Join-Path $C1Cache 'snapshot.json') | ConvertFrom-Json
$dataParent = Split-Path (Split-Path $c1.shards[0].path -Parent) -Parent
$c2 = @('turnstart-c2-pc3','turnstart-c2-pc1') |
  ForEach-Object { Join-Path $dataParent $_ }
& ./ml/d8_data_scale.ps1 -Python $Python -C1Cache $C1Cache `
  -BucketModel (Join-Path $C1Cache 'baseline-0-bucket') -C2Data $c2 `
  -Cache art/out/d8-expanded -Out art/out/d8-data-scale `
  -Part2 art/out/d8-capacity -Epochs 50 -MaxSeconds 3600
```

`-BucketModel` is the same historical c1 bucket export used to start part 2.
Use its actual stem if different from the example. Its split hash and target
are validated. All three baseline fits start from these same pretrained weights
and retrain the bucket network with held-hand loss on the combined training set.
Each residual starts from its **same-seed newly retrained baseline**, with a
zero-output `65 -> 128 -> 128 -> 1` PReLU head. Frozen leaves that baseline byte
identical; joint fine-tunes it. Both run another `-Epochs` epochs. These are
predeclared experiments; no head/configuration is selected by the test results.

`-Lr` defaults to 0.001. All fits use batch 512, SmoothL1 beta 0.1, cosine decay,
and seeds 0/1/2. A single fit runs at a time, CPU pools/affinity are limited to
two threads/cores, with no DataLoader workers. CUDA is required for acceptance.
The fit watchdog includes optimisation, calibration, export and exact scoring;
exit 124 means timeout. Hash validation and cache mapping precede that clock.
Failures stop the runner and suppress accepted summaries. Reruns restart fits
from epoch one. Existing complete expanded caches are verified and reused;
partial preparation directories are rejected. Choose a new empty cache path to
retry a partial preparation. Outputs must stay inside the worktree and cannot
overlap the part-1 cache, part-2 outputs, checkpoint directory or source data.

## Snapshot, split and memory

The preparer reads c1 shards in the exact saved snapshot order, compares every
shard hash/row count and verifies the original snapshot hash against `cache.json`.
It pins all three historical split lists and their original SHA-256:
`e70b66b41f6d7c1dbf145e849efc3eed401cb6058e5abe77f5e8d2d2f62e4f1c`.
The original 5,355 c1 test spots and 2,677 c1 calibration spots are unchanged.

C2 shards are ordered by the supplied directories and sorted shard filename.
They get an independent NumPy-compatible `default_rng(0).permutation(c2_count)`:
first floor(10%) test, next floor(5%) calibration, remaining training. C1 keeps
its original indices; c2 is offset by 53,550. With 6,921 full 25-spot c2 shards:

| Cohort | Training | Calibration | Test | Total |
| --- | ---: | ---: | ---: | ---: |
| c1 | 45,518 | 2,677 | 5,355 | 53,550 |
| c2 | 147,072 | 8,651 | 17,302 | 173,025 |
| Both | 192,590 | 11,328 | 22,657 | 226,575 |

Counts come from actual shard sizes, so additional completed shards are allowed
in a fresh cache. Every shard must contain exactly 25 spots. Manifest generator
settings, layout, target, teacher kind and teacher checkpoint content hashes
must agree. Only the c1/c2 run-seed namespaces may differ. Repeated
`(runSeed, worker, spot)` identities fail, as do identical generated spot inputs
across namespaces, even when timing, worker metadata or teacher output differ.
Teacher checkpoint files referenced by source manifests must remain readable.

The new split, snapshot, feature fixtures and all four arrays have independent
SHA-256 checks. Python reproduces both permutations and the complete split hash,
then checks all cache/source hashes for every fit. The completion marker is
written last. Sixteen stratified holdings/player/spot match the part-1 sampling
rule, including unchanged c1 row-dependent sample offsets. Both baseline and
residual minimise exactly the same sampled held-hand loss.

Preparation streams one source shard and one spot's features at a time into
flat arrays. The expanded sampled arrays occupy about **2.27 GB decimal** on
disk (10,020 bytes/spot). Source shards occupy about 5.42 GB. Training maps the
arrays read only and copies only one batch (about 5.1 MB) to CUDA. There is no
full-array concatenate, second resident tensor dataset, or full GPU upload.
The OS may retain mapped pages in its reclaimable file cache. Model/activation
memory is independent of total spots; the 512-spot 128x2 head fits the target
8 GB GPU. Allow at least 4 GB of free space for the new cache and run outputs,
in addition to the existing source data and old cache.

Calibration pools both cohorts by spot count and picks the lowest combined
sampled calibration MAE, while retaining both cohort calibration scores.
Final evaluation streams both test cohorts in one pass, using every legal
holding and exact normalised range weights. Each fit/result and every aggregate
summary contains separate **c1 and c2** scores. Summary CSV/JSON retain all
holding, board and deep-stack slices, three-seed mean/sample SD/min/max, matched
baseline and improvement/20% gates. Reference scores must reproduce the
same-seed retrained baseline, and frozen bucket binaries must remain identical.
Residual exports must pass actual CPU PyTorch to TS/WASM parity at 1e-5 before
the summary is accepted. The baseline export is exercised as each residual's
bucket network in these parity checks.

## Expected runtime on RTX 2060 Super / 32 GB RAM

The checked-in part-2 document estimates 120-300 seconds per fit; no measured
part-2 training logs were available here. These are **estimates**, not new
measurements. The runner prefers successful `h128x2-*-fit` wall timings from
`-Part2/commands.json` when available, otherwise labels the documented fallback.
It scales those times by 226,575/53,550 = 4.231 and adds 25% for streaming/I/O.
Baseline and joint receive the same conservative estimate because separate
measured timings are unavailable. Epoch scaling applies to the lower estimate;
the upper estimate retains scoring overhead for reduced epoch counts.

| Stage | Estimated wall time |
| --- | --- |
| Prepare/snapshot new c1+c2 cache | 5-15 min once; skipped on verified reuse |
| Python tests, six parity exports, twelve TS/WASM checks, summary | 2-6 min |
| Cache/source hash validation | 0.2-1 min per fit, outside fit deadline |
| Matched baseline | 10.6-26.4 min/seed; 32-79 min for three |
| Frozen 128x2 residual | 10.6-26.4 min/seed; 32-79 min for three |
| Joint 128x2 residual | 10.6-26.4 min/seed; 32-79 min for three |
| Total, fresh cache | **about 104-268 min (1.7-4.5 h)** |

Each fit estimate includes exact scoring of both cohorts. The default deadline
allows 60 min/fit, up to nine fit-hours plus preparation/verification/parity in
the worst case; the first failed stage stops the run. Before starting any stage,
the runner prints all estimates, both test counts, their provenance and the
total, and saves `runtime-estimate.json`. Actual exit codes and wall times go to
`commands.json`, each stage gets a log, and successful fits split optimisation
and evaluation times in their result JSON for subsequent measured estimates.

## Verification handoff

Claude's runner executes `test_turn_residual*.py` before any fit, including
cross-language split goldens, mutation/overlap checks, read-only mmap batching,
exact separate-cohort scores, source tamper rejection and legacy scoring API
compatibility. No Python tests or training were executed in this sandbox.

Local verification completed: residual Vitest suite **12/12, exit 0**; server
TypeScript **exit 0**; Biome for all three new TS files **exit 0**; PowerShell
parser, runtime-estimate execution and measured-timing extraction **exit 0**.
Python/CUDA, real-data snapshot and trained parity remain
unexecuted pending the source data/cache and Claude's interpreter.

Local TS checks (two-core affinity, one Vitest worker):

```powershell
(Get-Process -Id $PID).ProcessorAffinity = [IntPtr]3
$env:UV_THREADPOOL_SIZE = '2'
$env:RIVER_VALUE_THREADS = '1'
cmd /c npx vitest run apps/server/src/bot-turn-residual --maxWorkers=1
cmd /c npx tsc -p apps/server --noEmit
cmd /c npx biome check apps/server/src/bot-turn-residual-expanded.ts apps/server/src/bot-turn-residual-expanded-run.ts apps/server/src/bot-turn-residual-expanded.test.ts
```

Files: three `bot-turn-residual-expanded*.ts` files; `turn_residual_expanded.py`,
`train_turn_residual_expanded.py`, `summarise_turn_residual_expanded.py`,
`test_turn_residual_expanded.py`, `d8_data_scale.ps1`, this document; plus a
backward-compatible optional cohort argument in `train_turn_residual.py`.

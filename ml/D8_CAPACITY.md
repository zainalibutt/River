# D8 part 2: capacity sweep

The sweep runs 16x1, 64x2, 128x2 and 64x2 joint, each with seeds 0, 1, 2.
All use the same supplied bucket checkpoint, frozen split and sampled cache.
The 16x1 row is the part-1 head architecture reference. This checkout's original
part-1 trainer trained a randomly initialised bucket jointly; the new default
loads and freezes the supplied checkpoint. New numbers must therefore be
compared to the exact held-hand baseline reported in this sweep, rather than
treating historical 6.74 -> 6.31 as a matched frozen-trunk result.

## Claude's command

Run from the worktree root, with `$Python` set to the working CUDA PyTorch
interpreter. This concrete example uses the existing part-1 seed-0 bucket export.
To compare a different checkpoint, replace only `-BucketModel` (an export stem,
without `.json` or `.bin`). No Python execution was performed while preparing
part 2; Claude must run the included Python tests and training.

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
$data = @((Get-Content -Raw art/out/d8/snapshot.json | ConvertFrom-Json).shards |
  ForEach-Object { Split-Path $_.path -Parent } | Select-Object -Unique)
& ./ml/d8_capacity_sweep.ps1 -Python $Python `
  -BucketModel art/out/d8/baseline-0-bucket -Data $data
```

Alternatively pass source directories directly as a PowerShell array to `-Data`.
Defaults are `-Cache art/out/d8 -Out art/out/d8-capacity -Epochs 50 -Dropout 0
-Lr 0.001 -MaxSeconds 300`. An existing cache is reused without copying or
regenerating it. Its sources must match `-Data`; Python checks its snapshot,
every cache hash, every source shard hash and the frozen split. Missing caches
are diagnosed/prepared once before fits. Preparation time is outside fit budgets.
Use another `-Cache` for different sources. All generated outputs stay inside
this worktree; source checkpoints and shards are read only.

## Training and limits

`ml/train_turn_residual.py` accepts `--hidden`, `--layers` (1-3), `--dropout`,
`--epochs`, `--lr`, `--joint`, `--bucket-model`, `--cache`, `--out`, `--seed` and
`--max-seconds`. Frozen residual fits require a bucket checkpoint. `--joint`
fine-tunes that same starting checkpoint, including gradients through the base
prediction supplied to the head. Without it, the bucket parameters cannot change
and sampled bucket predictions are precomputed once per fit. Head output layers
start at zero. Dropout is active only in training, after each hidden PReLU.
Calibration chooses the best epoch; the test set is scored only afterwards.
No capacity/configuration is automatically selected using the test results.

Only one fit runs at a time, with batch size 512, two CPU cores/threads and no
data-loader workers. There are 16 sampled holdings per player per spot; all-holding
test evaluation streams one spot at a time. This keeps the 128x2 head well within
8 GB VRAM. Budget roughly 2-5 minutes per fit on an RTX 2060 Super, or 25-60 minutes
for 12 fits plus parity/timing, reusing the prepared cache. This is an estimate,
not measured part-2 training. A watchdog exits 124 at 300 seconds per fit, including
exact scoring (cache validation/loading and model construction precede the fit
clock). Incomplete epochs are never accepted. A failed stage stops the sweep and
leaves logs; rerunning starts fits from epoch one. A CUDA fit is required for an
accepted sweep summary. Increase the explicit deadline only if the host needs it.

## Exports, parity and report

Each config gets a directory containing all three trained exports and results.
Metadata records hidden width/depth, dropout, epochs, learning rate, joint mode,
checkpoint hash, split hash and full head shape. Training-only dropout is removed
and layer indices compacted to the existing Linear/PReLU export format. TS and
WASM infer width/depth from tensors and validate the optional `headShape` metadata;
legacy part-1 exports remain readable.

The runner first executes `ml/test_turn_residual.py`, including gradient/frozen
weight checks, cached-base equivalence and dropout export round trips. Each of
the 12 trained models then exports actual CPU PyTorch full-holding fixtures and
must pass TS and WASM parity at absolute error <= 1e-5. These checks include 64x2,
128x2, empty opponent ranges, blocked holdings and a residual-drop mutation.
The TS unit suite additionally loads a dense 64x2 export and checks scalar versus
batch inference for both backends without requiring Python.

`summary.csv`, `summary.md` and `summary.json` contain one row per config: three-seed
held-hand MAE mean/sample SD, unchanged source bucket baseline, percent improvement,
20% gate, flush-draw improvement, fit time and TS/WASM microseconds per spot.
The JSON retains per-seed metrics for every slice. Baseline scores always use the
original supplied checkpoint, including for joint fits. Summary files are emitted
only after all fits, parity checks and benchmarks succeed. `commands.json` records
every stage's exit code/time. Prior summaries are cleared before a new run.

For each config, trained seed 0 supplies the speed measurement. The benchmark
uses one real fixture, 10 warmups and 50 timed calls per operation, one inference
thread, separately forced TS and WASM processes. `speed-ts.json`/`speed-wasm.json`
record actual backend, full shape, mean/median/p95 microseconds per complete spot:
bucket forward, bucket plus head over both players/all 2,652 holdings including
range features/pools, and card preparation from existing strength ranks. The
summary's speed columns use the full spot operation with prepared cards cached;
rank computation is excluded. Timings depend on the CPU, not the training GPU.

Local architecture preview (dense untrained heads with the existing part-1 seed-0
bucket export, one inference thread, mean microseconds per complete spot):

| Config | TS us/spot | WASM us/spot |
| --- | ---: | ---: |
| 16x1 | 4537 | 2722 |
| 64x2 | 20010 | 6479 |
| 128x2 | 53710 | 13898 |
| 64x2 joint architecture | 20419 | 5657 |

These preview timings establish inference cost, not accuracy. Joint mode has the
same inference architecture as frozen 64x2; the timing difference is noise.
Raw reports and a combined CSV are in `art/out/d8-capacity-preview`. All eight
benchmark processes exited 0. The sweep replaces previews with trained seed-0
measurements in its own output directory.

Run the focused local checks with a two-core process affinity and one Vitest worker:

```powershell
(Get-Process -Id $PID).ProcessorAffinity = [IntPtr]3
$env:UV_THREADPOOL_SIZE = '2'
$env:RIVER_VALUE_THREADS = '1'
cmd /c npx vitest run apps/server/src/bot-turn-residual --maxWorkers=1
cmd /c npx tsc -p apps/server --noEmit
cmd /c npx biome check apps/server/src/bot-turn-residual.ts apps/server/src/bot-turn-residual.test.ts apps/server/src/bot-turn-residual-benchmark.ts
```

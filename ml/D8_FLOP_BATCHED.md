# D8 batched flop leaves and cached corrections

This follow-up uses the frozen 30 observations from D8_FLOP_DECISIONS.md, without
recapture, training, checkpoint changes, external play or changes to production defaults.
Results and verification below are populated from completed runs only.

## Implementation and approximation

`RiverLeafEvaluator.batch` is an optional dense-range hook in `perCardShowdown`.
One evaluator invocation integrates all 49 turn boards. `turnResidualLeaf` packs
all requested live holding rows into one head forward, following one
49-board bucket forward. The unbatched callable remains available as a reference.
Both use the same prepared card features, normalization, f32 inputs and kernels.
The two exact CFR traversals see sequential range updates, so they cannot share
one range snapshot without approximation. The batched API supports both players
for a snapshot; exact traversal queries prune only the unconsumed output rows.
Exact traversals retain the old output pruning. Every cached correction refresh
computes both players together. All-in leaves retain the existing runout tables;
zero-opponent leaves preserve discounted records without unnecessary inference.

```ts
const model = loadTurnResidualNetwork('art/out/d8-distill/h32/residual-0')
const network = turnResidualLeaf(model, { refreshIterations: 'never' })
const chain = v9gPolicy({ offTree: 'resolve', turnStartLeaf: { network } })
```

Omit `refreshIterations` for exact every-visit inference. `'never'` computes the
correction at the first visit. A positive integer R refreshes on the first visit
in each interval 1..R, R+1..2R, etc.; R=10 refreshes at 1, 11, 21 and 31 in the
normal 40-iteration solve. R=20 refreshes at 1 and 21. Final promise reads reuse
the latest correction and do not force another head call. If an interval is
first reached late, that visit supplies its current ranges.

A correction is the head's raw f32 per-holding delta, added to the current bucket
baseline on every visit. It is cached separately per terminal: different
terminals have different paid chips, SPR and reaching ranges. Both players share
the correction produced from the first traverser's then-current ranges in each
interval. The second traversal deliberately reuses that snapshot, even within
the same iteration. A typical five-terminal tree therefore needs five head
batches per refresh, rather than ten separate traverser batches. Each batch
contains every turn board and both players. Cached visits compute only the
consumed traverser's baseline output rows; the other returned row is zero.
Correction refreshes compute both players completely; exact traversals compute
only the requested player. R=1 refreshes once
per iteration and is still approximate across the second traversal; omit the
option for exact every-visit inference.

This is an approximation: pooled own/opponent range features, blocker masses,
and the bucket prediction supplied as a head feature go stale between refreshes.
The baseline, compatible opponent masses, chance integration and CFR averaging
remain current. No value clipping, holding pruning, hidden information or online
learning is introduced. Corrections reset with each `withRecord` solve scope,
including gadgets and widening, and cannot leak between decisions. Prepared
board features remain reusable. Returned holding arrays stay valid after later
calls. The legacy scalar reference always evaluates exactly; the refresh option
is implemented by the batched hook used by flop re-solving.

## Measurement

Raw files: `art/out/d8-flop-batched/`; the fixture SHA256 remains
`22e04f8984aead9706c075e3ff025d2ca331e1ff7fea47aaef2837b6120f443e`.
The benchmark retains the original seeded spots, 40 DCFR iterations, full ranges,
all-in runouts, action-order checks and whole-decision timing boundaries.
Every policy is fresh. Plain is retained from the completed fresh baseline run
because the shared-correction change does not affect it. Kernels and workers are
warmed; first-use large batch
buffer growth and board preparation remain in the timed decision. Runs are
sequential. They are not randomized controlled timing comparisons.

The host reports AMD Ryzen 7 2700X Eight-Core Processor. WASM is forced. Plain
uses two baseline participants and has no head. Cached student schedules use two
baseline participants and one head participant; exact residuals and every teacher schedule use one baseline
participant and two head participants. Even the sparse teacher head workload
exceeds the baseline dense workload, so allocating the worker to its head is
more appropriate than copying the student allocation. Main is shared by both
networks, and only one inference worker exists per process. This assigns the
worker to the dominant network without creating an idle second inference worker.
The runtime environment also bounds libuv, esbuild, Biome and Rayon workers.
`manifest.json` records the fixture and model hashes; the three bucket binaries
are identical, with the same hash as the original experiment.

p50/p95 are nearest-rank quantiles. Calls are leaf evaluator invocations, and NN
forwards are actual bucket plus head forwards. Queries count turn boards with
both ranges, for one traverser. Leaf share is summed inclusive feature/inference
wall time divided by summed decision time. TV is half the actor held-hand root
row L1 difference from exact every-iteration all-teacher on matching spots with
identical action order. TV measures strategy movement, not exploitability or
accuracy. All rows use the same six spots for paired comparisons; full measured
coverage and paired counts are retained in the JSON summary.

The two-second margin criterion is decision time <=6 seconds. Results below
distinguish the p95 criterion from meeting it on every observed sample. This covers the
measured initial flop decision body; the wrapper and later widening costs remain
outside this measurement.

## Verification and commands

All commands run from the worktree root. Environment:

```powershell
$env:RIVER_VALUE_THREADS='1'
$env:UV_THREADPOOL_SIZE='1'
$env:GOMAXPROCS='2'
$env:BIOME_MAX_THREADS='2'
$env:RAYON_NUM_THREADS='2'
$env:TSX_DISABLE_CACHE='1'
$env:npm_config_cache=Join-Path (Get-Location) 'art/out/d8-flop-batched/npm-cache'
```

The harness sets the actual per-network inference participant counts described
above. The runner persists actual commands, wall times and exit codes in
`commands-*.json`. Each benchmark saves after every sample; a 55-minute
between-decision guard also applies. Commands below have exit code 0 unless an
explicit exception is recorded.

```powershell
cmd /c npx vitest run apps/server/src/bot-river-solver.test.ts apps/server/src/bot-turn-river-leaves.test.ts apps/server/src/bot-flop-turn-leaves.test.ts apps/server/src/bot-turn-policy.test.ts apps/server/src/bot-v9g-policy.test.ts apps/server/src/bot-turn-residual.test.ts apps/server/src/bot-flop-leaf-benchmark.test.ts --maxWorkers=1 --no-file-parallelism
cmd /c npx tsc -p apps/server --noEmit
cmd /c npx biome check apps/server/src/bot-turn-river-leaves.ts apps/server/src/bot-turn-residual.ts apps/server/src/bot-turn-residual.test.ts apps/server/src/bot-flop-leaf-benchmark.ts apps/server/src/bot-flop-leaf-benchmark.test.ts apps/server/src/bot-flop-turn-leaves.test.ts
```

Final verification: seven suites, 104 tests passed in 65.79 seconds, including
full-output and selected-player batched parity, shared correction scopes and
bounded worker allocation. Tests cover exact TS/WASM
batched-versus-scalar holding arrays for both players, multiple head depths,
blocked holdings and zero ranges; exact solve strategies and carried records;
refresh boundaries at R=10/20 and never; current baseline with stale corrections;
separate terminal/solve caches and shared player corrections; immutable previous
outputs; and the
existing all-in, last-K, chance integration and default-policy parity tests.
`checks.json` records Vitest, TypeScript and Biome exits of 0.

Initial discovery exited 1 because `rg` is unavailable; PowerShell discovery
succeeded. The first development TypeScript check exited 1 for two optional
property types, corrected before the passing checks. The first Biome write
reported an iterable callback return, corrected before the final clean check.
Direct launch of the local benchmark helper exited 1 because script-file
execution is disabled. Running the same local code as an inline script block
succeeded, without changing system policy. These are setup/development failures,
not omitted benchmark decisions.

An intermediate cache keyed corrections by traverser despite computing both
players. Its completed h32 schedules and partial h32x2 run are preserved under
`pre-shared-correction/` and excluded from the final table and summary. That run
was intentionally interrupted (exit 1) before restarting cached measurements
with shared corrections. A process inventory attempt using CIM was denied;
the owned session was stopped with its normal interrupt control. Final cached
results are all rerun with the shared-player implementation. The first full-output
h32 exact batch is also archived there; exact measurements are rerun with the
scalar adapter's existing traverser-only output pruning retained. This does not
change cached outputs or their completed measurements.

## Files

- `apps/server/src/bot-turn-river-leaves.ts`: optional batch hook and shared integration.
- `apps/server/src/bot-turn-residual.ts`: all-board/player packing and refresh cache.
- `apps/server/src/bot-flop-leaf-benchmark.ts`: 13 variants, isolated output, real forward counters.
- `apps/server/src/bot-turn-residual.test.ts`: full and selected-player parity, current baseline, stale corrections and refresh scopes.
- `apps/server/src/bot-flop-turn-leaves.test.ts`: exact strategies/records and shared correction reset.
- `apps/server/src/bot-flop-leaf-benchmark.test.ts`: variant matrix and two-participant allocation.
- This report and the follow-up link in `ml/D8_FLOP_DECISIONS.md`.
- Raw fixture, decisions, commands and summary under `art/out/d8-flop-batched/`.

No git operations, external play, training or checkpoint writes were performed.

## Results

All requested coverage is complete: 318 decisions, six shared observations for every
variant, and all 30 observations for plain and all nine cached schedules.
The three exact residual models have six observations each because they are slow.
No failed or unmeasured decisions are substituted. `summary.complete` checks the
requested six/fast-thirty rule; `allVariantsThirty` separately records the larger matrix.

### All measured spots

| Variant | N | p50 s | p95 s | Leaf calls | NN forwards | Head forwards | Leaf share | Mean root TV |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| plain | 30 | 5.055 | 5.258 | 409 | 409 | 0 | 30.05% | 0.112319 |
| h32 | 6 | 17.951 | 18.581 | 410 | 820 | 410 | 79.72% | 0.059294 |
| h32-once | 30 | 5.624 | 5.870 | 410 | 415 | 5 | 36.58% | 0.053089 |
| h32-r10 | 30 | 6.640 | 6.827 | 410 | 430 | 20 | 45.63% | 0.055808 |
| h32-r20 | 30 | 5.920 | 6.177 | 410 | 420 | 10 | 39.82% | 0.049476 |
| h32x2 | 6 | 21.191 | 21.813 | 410 | 820 | 410 | 82.77% | 0.053385 |
| h32x2-once | 30 | 5.694 | 5.938 | 410 | 415 | 5 | 37.38% | 0.045173 |
| h32x2-r10 | 30 | 7.062 | 7.287 | 410 | 430 | 20 | 48.98% | 0.046564 |
| h32x2-r20 | 30 | 6.217 | 6.404 | 410 | 420 | 10 | 42.26% | 0.046643 |
| teacher | 6 | 62.323 | 63.155 | 409 | 818 | 409 | 93.94% | 0.000000 |
| teacher-once | 30 | 7.203 | 7.376 | 410 | 415 | 5 | 50.60% | 0.035965 |
| teacher-r10 | 30 | 11.193 | 11.332 | 410 | 430 | 20 | 67.65% | 0.013274 |
| teacher-r20 | 30 | 8.549 | 8.757 | 410 | 420 | 10 | 58.04% | 0.016429 |

Calls, NN forwards and head forwards are per-decision medians. Every TV above
uses exactly the six paired teacher observations, regardless of latency coverage.
The JSON also records bucket forwards, board queries and all per-sample counters.

### Identical six-spot comparison

| Variant | N | p50 s | p95 s | Leaf calls | NN forwards | Head forwards | Leaf share | Mean root TV |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| plain | 6 | 5.085 | 5.293 | 409 | 409 | 0 | 30.05% | 0.112319 |
| h32 | 6 | 17.951 | 18.581 | 410 | 820 | 410 | 79.72% | 0.059294 |
| h32-once | 6 | 5.750 | 6.169 | 410 | 415 | 5 | 37.31% | 0.053089 |
| h32-r10 | 6 | 6.688 | 7.109 | 410 | 430 | 20 | 46.18% | 0.055808 |
| h32-r20 | 6 | 6.000 | 6.494 | 410 | 420 | 10 | 40.43% | 0.049476 |
| h32x2 | 6 | 21.191 | 21.813 | 410 | 820 | 410 | 82.77% | 0.053385 |
| h32x2-once | 6 | 5.801 | 6.209 | 410 | 415 | 5 | 38.39% | 0.045173 |
| h32x2-r10 | 6 | 7.174 | 7.632 | 410 | 430 | 20 | 49.57% | 0.046564 |
| h32x2-r20 | 6 | 6.260 | 6.732 | 410 | 420 | 10 | 42.70% | 0.046643 |
| teacher | 6 | 62.323 | 63.155 | 409 | 818 | 409 | 93.94% | 0.000000 |
| teacher-once | 6 | 7.268 | 7.766 | 410 | 415 | 5 | 51.08% | 0.035965 |
| teacher-r10 | 6 | 11.209 | 11.708 | 410 | 430 | 20 | 67.91% | 0.013274 |
| teacher-r20 | 6 | 8.592 | 9.248 | 410 | 420 | 10 | 58.32% | 0.016429 |

### Deadline assessment

At least two seconds of **p95** margin: **plain, h32-once, h32x2-once**.
At least two seconds on **every observed decision**: **plain**.

| Variant | Over 8 s | p95 margin s | Worst margin s |
| --- | ---: | ---: | ---: |
| plain | 0/30 | 2.742 | 2.707 |
| h32 | 6/6 | -10.581 | -10.581 |
| h32-once | 0/30 | 2.130 | 1.831 |
| h32-r10 | 0/30 | 1.173 | 0.891 |
| h32-r20 | 0/30 | 1.823 | 1.506 |
| h32x2 | 6/6 | -13.813 | -13.813 |
| h32x2-once | 0/30 | 2.062 | 1.791 |
| h32x2-r10 | 0/30 | 0.713 | 0.368 |
| h32x2-r20 | 0/30 | 1.596 | 1.268 |
| teacher | 6/6 | -55.155 | -55.155 |
| teacher-once | 0/30 | 0.624 | 0.234 |
| teacher-r10 | 29/30 | -3.332 | -3.708 |
| teacher-r20 | 29/30 | -0.757 | -1.248 |

Exact batching preserves root rows bit-for-bit against the archived scalar
results for all six common spots of plain, h32, h32x2 and teacher.
`exact-parity.json` records zero maximum probability difference for each.
Caching is deliberately approximate. Its TV is strategy movement only; it
does not establish exploitability, value accuracy or an end-to-end deadline.

### Benchmark commands and exit codes

Prefix every row with `cmd /c npx tsx apps/server/src/bot-flop-leaf-benchmark.ts`.

| Arguments | Exit |
| --- | ---: |
| `plain 0 30` | 0 |
| `h32 0 6` | 0 |
| `h32-once 0 30` | 0 |
| `h32-r10 0 30` | 0 |
| `h32-r20 0 30` | 0 |
| `h32x2 0 6` | 0 |
| `h32x2-once 0 30` | 0 |
| `h32x2-r10 0 30` | 0 |
| `h32x2-r20 0 30` | 0 |
| `teacher 0 6` | 0 |
| `teacher-once 0 30` | 0 |
| `teacher-r10 0 30` | 0 |
| `teacher-r20 0 30` | 0 |
| `summarize` | 0 |

### Run budget

Final measured decision bodies total 2676.731 seconds.
Archived intermediate bodies add 928.656 seconds (118 decisions),
and the preserved early pilot adds 7.213 seconds.
Adding a conservative 900-second allowance for all other pilots, checks,
startup, discovery and preparation gives an upper accounting estimate of
75.210 minutes, below the 180-minute run budget.
This allowance is not a measured CPU-time total.
The longest recorded benchmark group lasted 13.503 minutes;
each benchmark subprocess and every other completed process remained below
the 60-minute cap. `budget.json` preserves this accounting.

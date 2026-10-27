# D8 turn-start leaves inside v9go flop decisions

Implementation and validation are complete. The benchmark is partial: 77 of 210
requested policy/spot decisions completed under the run budget. Plain has 30 spots;
h32 and h32x2 have ten each; all-teacher, K=5 and K=10 have seven each; K=20 has six.
Indices 0 through 5 are the shared comparison set. The unmeasured rows are not imputed.

## Scope and reproducibility

The constructor opt-in is `V9gOptions.turnStartLeaf`; absent options preserve the production
network, batching, iteration count and policy construction. No deployment, external play,
git operation, training or checkpoint modification is part of this experiment.

The frozen observations are in `art/out/d8-flop-decisions/spots.json`. They are the first
30 two-player flop decisions reached by seeded rooms from `bot-live-readiness.ts`, with
its two OG personalities, seed `live-readiness-2026-10-25`, and guard preflop play. One
decision is captured per hand, without selecting on runtime or model output. Only each
actor's legal observation is retained. These are local dealt hands, not Slumbot results.

Every sample creates a fresh v9go policy (`offTree: 'resolve'`), preserving its default
40 DCFR iterations, range tracking, full holding support, bet sizes, raise cap, carry
records and 60-runout all-in handling. These first-flop observations exercise the initial
flop solve and root promise reads; they do not benchmark later off-tree widening.
Other street weights are injected placeholders and never evaluated; the harness rejects
samples with a turn/river solve, missing flop solve, or fallback.

Timing covers `policy.decide`: range tracking, all 49 turn rank layouts, exact all-in
preparation, CFR, carry records, final promise reads and action selection. It excludes
model loading, inference-worker startup, wrapper IPC and the safe wrapper's separate
baseline action. No sample is clipped at the eight-second deadline. Layout caches are
cold for each distinct board. The model kernels are warmed before timing.

WASM is forced. There are at most two inference participants: main plus one worker.
Plain uses two participants for the batched bucket network. Residual and last-K runs
initialise their batch-one bucket network with one participant, and their residual head
with two. This avoids creating a separate idle worker for each network. The early plain
network in a last-K run consequently has one participant. The live safe wrapper's pool
is not running concurrently with this experiment.

## Model exports

| Variant | Export stem |
| --- | --- |
| plain | `art/out/d8-data-scale/frozen/residual-0-bucket` |
| h32 | `art/out/d8-distill/h32/residual-0` |
| h32x2 | `art/out/d8-distill/h32x2/residual-0` |
| teacher | `art/out/d8-data-scale/frozen/residual-0` |

Residual stems load their `-bucket` and `-head` files through the existing validated
loader. All three bucket binaries have the identical SHA256
`f20ac14429377ee713822af99b8b23b5bdb4d8d14fbcd30ca6f78949b296a53c`.
The frozen observation file has SHA256
`22e04f8984aead9706c075e3ff025d2ca331e1ff7fea47aaef2837b6120f443e`.
The plain path retains the existing batching, zero-opponent shortcut and exact
f32 prediction cache. Residual inference computes only the traverser's head rows;
both ranges still contribute to every feature. This is exact output pruning, not a
different model or a reduction in holding support. Tests compare both players with the
full-row evaluator for TS and WASM and multiple head shapes. On spot zero, the original
two-player adapter took 122.665 seconds; exact output pruning took 71.867 seconds and
produced identical root action probabilities. The original pilot is preserved separately
as `pilot-unpruned.json` and excluded from the variant summaries.

## Opt-in usage

```ts
const model = loadTurnResidualNetwork('art/out/d8-distill/h32/residual-0')
const chain = v9gPolicy({
  offTree: 'resolve',
  turnStartLeaf: { network: turnResidualLeaf(model) },
})
```

For the time-saving policy, use the teacher stem and add `lastIterations: 5`, `10`, or
`20`. Earlier iterations use the ordinary configured turn-start bucket network. An
explicit `earlyNetwork` can instead be a loaded bucket network or an h32 adapter.
The schedule resets on every solve, including gadget and widened solves. A final value
read always uses the expensive evaluator. All-ins bypass both evaluators. Carried values
keep the same DCFR discount and sample weights across the switch. `lastIterations`
accepts integer values from zero through the total iteration count; omission uses the
selected network throughout.

Optional mutable `profile` and `earlyProfile` counters expose evaluator invocations,
turn-board queries and inclusive input/inference wall time. Profiling is off by default.

## Measurement definitions

- Decision p50/p95 use nearest-rank quantiles of individual completed decisions.
- Queries count evaluated turn boards, with both input ranges, for one traverser.
- Evaluator calls count one batched bucket invocation or one residual-adapter invocation.
- NN forward calls count actual dense-network invocations: one per plain batch and
  two per residual-adapter call (bucket plus head). A plain batch normally contains
  all 49 boards. These counts must not be compared without their batch sizes.
- Leaf share is total inclusive leaf input/inference time divided by total decision
  time. For residuals this includes card feature preparation, range conversion, pools,
  bucket and head forwards, and output expansion. For plain it includes bucket inputs,
  cache checks and batched inference. Chance integration, CFR and all-in tables are
  outside this numerator. This is wall time, not summed per-thread CPU time or a
  matrix-multiplication-only measurement.
- Root TV is half the L1 difference between the actor's held-hand root action row and
  the all-teacher row on the same observation. Actions are checked for identical order.
  It is strategy movement, not an accuracy, value or exploitability claim.

## Commands and verification

All commands run at the worktree root. Benchmark commands use
`$env:UV_THREADPOOL_SIZE='1'`; the harness selects WASM and its bounded thread settings.

```powershell
cmd /c npx tsx apps/server/src/bot-flop-leaf-benchmark.ts capture
cmd /c npx tsx apps/server/src/bot-flop-leaf-benchmark.ts plain 0 30
cmd /c npx tsx apps/server/src/bot-flop-leaf-benchmark.ts h32 0 10
```

Each benchmark saves raw per-decision results after every completed sample. Use
`<variant> <first-index> <count>` to resume without overlap, and `summarize` to recompute
quantiles, coverage, shared-spot summaries and paired teacher TV. Summarization rejects
overlapping batches, fixture hash changes and action-order changes. The runner has a
13-minute between-decision batch guard; batches must also be kept small enough that a
single final decision cannot cross the user's 15-minute process limit.

Final code verification passed: seven Vitest suites, 97 tests; server TypeScript;
Biome on all eleven touched TS files. Tests additionally cover last-K boundaries,
gadget iteration resets, immutable previous residual results, exact all-in bypass,
unchanged all-late strategies and carried records, and absent-option v9go construction.

```powershell
$env:RIVER_VALUE_THREADS='1'
$env:UV_THREADPOOL_SIZE='1'
cmd /c npx vitest run apps/server/src/bot-river-solver.test.ts apps/server/src/bot-turn-river-leaves.test.ts apps/server/src/bot-flop-turn-leaves.test.ts apps/server/src/bot-turn-policy.test.ts apps/server/src/bot-v9g-policy.test.ts apps/server/src/bot-turn-residual.test.ts apps/server/src/bot-flop-leaf-benchmark.test.ts --maxWorkers=1 --no-file-parallelism
cmd /c npx tsc -p apps/server --noEmit
cmd /c npx biome check apps/server/src/bot-river-solver.ts apps/server/src/bot-turn-river-leaves.ts apps/server/src/bot-flop-turn-leaves.ts apps/server/src/bot-turn-policy.ts apps/server/src/bot-v9g-policy.ts apps/server/src/bot-flop-leaf-benchmark.ts apps/server/src/bot-turn-residual.ts apps/server/src/bot-turn-residual.test.ts apps/server/src/bot-v9g-policy.test.ts apps/server/src/bot-flop-turn-leaves.test.ts apps/server/src/bot-flop-leaf-benchmark.test.ts
```

## Results

Raw decisions and the machine-readable `summary.json` are in
`art/out/d8-flop-decisions/`. The summary records `complete: false`, full measured
coverage, and a separate `commonSummary` for the six shared observations. The host was
an AMD Ryzen 7 2700X. All batches used WASM and the expected bounded participant counts;
all 77 actors' holdings were present in range (no nearest-holding stand-ins).

Calls and queries below are per-decision medians. Shares are ratios of summed wall
times, not averages of percentages. Seconds are rounded to three decimals.

### Plain

| Coverage | N | p50 s | p95 s | Leaf calls | Board queries | NN forwards | Leaf share |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| All measured | 30 | 5.082 | 5.327 | 409 | 20,041 | 409 | 29.01% |
| Shared prefix | 6 | 5.117 | 5.367 | 409 | 20,041 | 409 | 29.09% |

### h32

| Coverage | N | p50 s | p95 s | Leaf calls | Board queries | NN forwards | Leaf share |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| All measured | 10 | 27.462 | 29.106 | 20,090 | 20,090 | 40,180 | 86.21% |
| Shared prefix | 6 | 27.353 | 29.106 | 20,090 | 20,090 | 40,180 | 85.94% |

### h32x2

| Coverage | N | p50 s | p95 s | Leaf calls | Board queries | NN forwards | Leaf share |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| All measured | 10 | 31.526 | 49.514 | 20,090 | 20,090 | 40,180 | 88.99% |
| Shared prefix | 6 | 31.472 | 32.200 | 20,090 | 20,090 | 40,180 | 88.22% |

The shared prefix does not include the later h32x2 slowdown. The all-measured row
retains it; the smaller shared-prefix p95 is not a claim that the tail disappeared.

### Teacher (128x2)

| Coverage | N | p50 s | p95 s | Leaf calls | Board queries | NN forwards | Leaf share |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| All measured | 7 | 96.888 | 102.523 | 20,090 | 20,090 | 40,180 | 95.18% |
| Shared prefix | 6 | 75.639 | 100.084 | 20,090 | 20,090 | 40,180 | 95.09% |

### Last-K teacher, plain early: six shared observations

| K | N | p50 s | p95 s | Teacher queries | Total NN forwards | Leaf share | Mean root TV |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 5 | 6 | 26.694 | 27.651 | 2,940 | 6,229 | 78.19% | 0.105279 |
| 10 | 6 | 39.406 | 40.689 | 5,390 | 11,079 | 86.29% | 0.091728 |
| 20 | 6 | 66.180 | 67.964 | 10,290 | 20,779 | 91.88% | 0.058381 |

These are time measurements and held-hand strategy movement only. They do not establish
accuracy or exploitability. For context on exactly the same six spots, plain versus
teacher root TV is 0.112319, h32 is 0.059294, and h32x2 is 0.053385.

The seventh K=5 and K=10 observations remain in the raw files and full summary. Across
all seven, K=5 p50/p95 are 26.694/27.651 seconds and mean TV is 0.090327; K=10 p50/p95
are 39.569/40.689 seconds and mean TV is 0.078713. K=20 was stopped at six completed
observations to preserve the run budget, without interrupting a running decision.

### Eight-second deadline

Only plain fits these measured initial flop decision bodies with margin: p95 margin
2.673 seconds, worst-observed margin 2.633 seconds, zero failures in 30 observations.
Every completed student, teacher and last-K sample exceeded eight seconds. This is not
an end-to-end wrapper or off-tree-widening deadline guarantee. The expensive policies
cannot meet the deadline even before those additional costs.

### Executed benchmark commands and exit codes

Prefix every argument row below with
`cmd /c npx tsx apps/server/src/bot-flop-leaf-benchmark.ts`.

| Arguments | Exit | Coverage |
| --- | ---: | --- |
| `capture` | 0 | Frozen 30 observations |
| `plain 0 1` | 0 | Initial pilot; superseded by full plain batch |
| `teacher 0 1` | 0 | Original unpruned pilot, preserved separately |
| `teacher 0 1` | 0 | Exact output-pruned teacher, retained as spot zero |
| `plain 0 30` | 0 | 0-29 |
| `h32 0 10` | 0 | 0-9 |
| `h32x2 0 9` | 0 | 0-8 |
| `h32x2 9 1` | 0 | 9 |
| `teacher 1 3` | 0 | 1-3 |
| `teacher 4 3` | 0 | 4-6 |
| `teacher-k5 0 7` | 0 | 0-6 |
| `teacher-k10 0 7` | 0 | 0-6 |
| `teacher-k20 0 6` | 0 | 0-5 |
| `summarize` | 0 | Recomputed full and shared summaries |

Both Vitest passes exited 0 (96 then 97 tests; the second includes the final all-in
regression). All server TypeScript checks exited 0. Biome formatting and the final
non-mutating check exited 0. The final Biome check used `BIOME_MAX_THREADS=2` and
`RAYON_NUM_THREADS=2`. Later benchmark launches disabled the tsx cache and placed npm's
cache under the experiment output directory. Initial discovery exited 1 because `rg`
was unavailable; PowerShell discovery succeeded instead.

Measured decision bodies total 2,261.756 seconds. Non-table pilots add 127.977 seconds;
the two Vitest runs add 132.940 seconds. Adding a 120-second allowance for CLI startup,
TypeScript, Biome, discovery and summary work gives approximately 44.045 minutes of
run-budget accounting. This allowance is not a CPU-time measurement. The longest
benchmark batch body was 400.287 seconds, comfortably below the 15-minute process cap
including startup. No further expensive run was started.

To finish the requested matrix under a new run budget, continue h32/h32x2 from index
10, teacher/K=5/K=10 from index 7, and K=20 from index 6. Existing observations and
completed batches should remain frozen. Use small non-overlapping batches and rerun
`summarize`; completion requires 30 observations for every variant.

Most sampled trees have five non-all-in terminal branches: 40 iterations times two
traversals times five branches times 49 turn cards gives 19,600 residual-adapter queries.
Final root promise reads add another 490, giving 20,090 queries. Plain handles the same
integration in roughly 410 batches before its zero-opponent and exact-cache savings.
The last-K schedule reduces the expensive iteration queries but retains those final
promise reads. Per-call microbenchmarks alone omit this multiplication of work.

Runs were sequential rather than a randomized, interleaved timing experiment. Late
h32x2 samples and repeated teacher samples slowed down materially. All completed
samples are retained. These observations establish deadline failures for expensive
leaves, but small timing differences between models should not be read as controlled
performance comparisons.

# Live safe bot readiness: 2026-10-25

Implementation is opt-in and no deployment or git operation was performed.
Configuration and artifact packaging are in [live-safe-bot.md](live-safe-bot.md).

## Measured workload

100 seeded heads-up hands, one active table at a time, v9go versus
`pokerGuardPolicy` (v8z's pre-river base), 40/100/200/400bb session depths,
alternating chairs, two solver-worker slots and an 8000 ms decision budget.
Workers use single-threaded WASM inference. There is no OS processor-affinity
or container CPU quota in this measurement.

Host: Windows x64, Node v24.13.0, AMD Ryzen 7 2700X, 16 logical CPUs. Four separate
25-hand processes kept each run below the owner's ten-minute process limit.
Accepted batch durations: 158.88, 159.00, 167.69, 164.71 seconds; sum 650.28 s.
Each batch restarts the pool, so this is not a continuous 100-hand RSS soak.

An initial unsegmented run was interrupted (exit 1) to keep work bounded. A
pre-fix 50-74 batch exposed unnecessary guard fallback while a worker retired;
it was replaced by a successful rerun after the spare-worker routing fix.
Neither discarded run contributes samples below.

| Street | Decisions | p50 ms | p95 ms | p99 ms | Max ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Preflop | 97 | 0.7 | 5.3 | 565.5 | 565.5 |
| Flop | 57 | 6363.4 | 7999.3 | 8009.5 | 8009.5 |
| Turn | 39 | 3622.7 | 3814.1 | 3866.1 | 3866.1 |
| River | 32 | 5700.6 | 6372.6 | 8002.5 | 8002.5 |

225 decisions: 219 safe decisions, **4 time-budget fallbacks**, and **2 later
decisions kept on v8z because that hand's carry was disabled**. All six used
v8z. Guard fallbacks, model errors, solver errors and worker errors: zero.
Twelve worker starts include eight initial starts and four timeout replacements.
The 8009.5 ms maximum illustrates Node timer/scheduling jitter; it is not a
real-time operating-system guarantee.

RSS sampled every 250 ms plus hand boundaries: **531,124,224 bytes (506.5 MiB)**
peak; largest increase over loaded RSS: **338.3 MiB**. Peak retained carry:
**14,439,240 bytes (13.8 MiB), three entries**. Every accepted batch ended with
zero active hands, chains, entries and retained carry bytes. RSS can remain
above startup after release because of bounded runtime caches and GC retention.

Source/tsx pool cold-start wall times: **479-719 ms**. Network load/backend
initialization per worker: **24.6-38.6 ms**, including replacement workers.
All networks selected WASM. Raw samples and separate RSS timelines are in
[`out/bot-live-readiness-100x2.json`](../../../out/bot-live-readiness-100x2.json).

Compiled JavaScript smoke: two v9go hands, three legal decisions including a
6.57 s flop solve, 288 ms pool startup, no fallbacks, zero final carry records.
The optional v9gp compiled smoke played two preflop decisions, loaded both packs
and all networks, and finished without fallback or retained records. It reached
no postflop decision and is not a v9gp performance benchmark.

## Validation and commands

All accepted batches, merge, build, compiled smokes and final checks exited 0.
The targeted suite passed **151 tests across 7 files**. Coverage includes flag-off
selection, strict two-seat routing, timer fallback/counting, a genuinely blocked
worker, spare-worker recovery, actual solver exceptions, resource limits,
raw-sample aggregation, WASM/TS fallback, and live release across showdown,
fold and all-in hands.

```powershell
cmd /c npx vitest run apps/server/src/bot-live-safe apps/server/src/bot-live-readiness apps/server/src/bot-service apps/server/src/bot-thinker apps/server/src/bot-value-simd apps/server/src/transport --maxWorkers=1 --no-file-parallelism
cmd /c npx tsc -p apps/server --noEmit
cmd /c npx tsc -p apps/server/tsconfig.build.json
cmd /c npx biome check apps/server/src/bot-live-safe.ts apps/server/src/bot-live-safe-worker.ts apps/server/src/bot-live-safe.test.ts apps/server/src/bot-live-safe-worker.test.ts apps/server/src/bot-live-readiness.ts apps/server/src/bot-live-readiness.test.ts apps/server/src/bot-thinker.ts apps/server/src/main.ts apps/server/src/transport.ts apps/server/src/transport.test.ts
```

For the measurements each PowerShell invocation set these four variables first:

```powershell
$env:RIVER_TURN_NETWORK='<models>/turnend-6/river-buckets-128'
$env:RIVER_FLOP_NETWORK='<models>/flop2-ck50/river-buckets-128'
$env:RIVER_TURN_START_NETWORK='<models>/turnstart-c1-53k-e50/river-buckets-128'
$env:RIVER_RIVER_NETWORK='<models>/night1-buckets/river-buckets-128'
```

Run these as separate invocations to preserve the process-time bound:

```powershell
cmd /c npx tsx apps/server/src/bot-live-readiness.ts --hands 25 --first-hand 0 --threads 2 --budget-ms 8000 --out out/bot-live-readiness-00-24.json
cmd /c npx tsx apps/server/src/bot-live-readiness.ts --hands 25 --first-hand 25 --threads 2 --budget-ms 8000 --out out/bot-live-readiness-25-49.json
cmd /c npx tsx apps/server/src/bot-live-readiness.ts --hands 25 --first-hand 50 --threads 2 --budget-ms 8000 --out out/bot-live-readiness-50-74.json
cmd /c npx tsx apps/server/src/bot-live-readiness.ts --hands 25 --first-hand 75 --threads 2 --budget-ms 8000 --out out/bot-live-readiness-75-99.json
cmd /c npx tsx apps/server/src/bot-live-readiness.ts --merge out/bot-live-readiness-00-24.json out/bot-live-readiness-25-49.json out/bot-live-readiness-50-74.json out/bot-live-readiness-75-99.json --out out/bot-live-readiness-100x2.json
cmd /c node apps/server/dist/bot-live-readiness.js --hands 2 --threads 2 --budget-ms 8000 --out out/bot-live-readiness-compiled.json
cmd /c node apps/server/dist/bot-live-readiness.js --hands 2 --threads 2 --variant v9gp --budget-ms 8000 --out out/bot-live-readiness-v9gp-compiled.json
```

## Files and remaining limits

New: `src/bot-live-safe.ts`, `src/bot-live-safe-worker.ts`,
`src/bot-live-readiness.ts`, their three test files, and these two docs.
Updated: `src/main.ts`, `src/bot-thinker.ts`, `src/transport.ts`,
`src/transport.test.ts`. Local build output is in `dist`; raw run artifacts
are in the worktree's `out` directory.

Railway CPU speed, Linux/Node-version behavior, simultaneous tables, sustained
memory over more than 25 hands, and TypeScript inference latency remain
unmeasured. A saturated pool or overdue v8z river calculation can use the guard;
this remains counted even though none occurred in the accepted sample. Package
the 13.54 MiB network weights and metadata before enabling. A planning estimate
for two active tables is about 900 MiB bot/runtime RSS before web-server and GC
headroom; this extrapolation requires a real concurrent-table measurement.

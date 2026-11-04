# D8 implementation validation

All writes were confined to the worktree. No git command, commit, push, index
change or ref change was performed. Commit metadata was read directly from
refs. No external match or ML training was launched. At most two bounded
commands ran together, with one value/BLAS/libuv/Rust worker per command and
`--maxWorkers=1 --no-file-parallelism` for Vitest. The wrapper kills its own
process tree after 540 seconds; no validation run reached that limit.

## Commands and exits

Every command below ran through `node apps/server/benchmark/bounded-run.mjs`
with `cmd /c` as its command. File locations for historical inputs are supplied
externally; their basenames and content hashes are preserved in the results.

| Command after the wrapper | Final exit | Evidence |
| --- | ---: | --- |
| `cmd /c npx vitest run apps/server/src/bot-head-to-head apps/server/src/bot-slumbot apps/server/src/bot-preflop-tables apps/server/src/bot-service apps/server/src/bot-aivat --maxWorkers=1 --no-file-parallelism` | 0 | 77 tests, five files |
| `cmd /c npx tsc -p apps/server --noEmit` | 0 | Final server typecheck |
| `cmd /c npx biome check --vcs-enabled=false <the 21 files listed below>` | 0 | Checked 21 files, no fixes applied |
| `cmd /c npx tsx apps/server/src/bot-aivat-replay.ts apps/server/benchmark/results/slumbot-v9g.json <v9g-1-fixed.jsonl> <v9g-2-fixed.jsonl> <v9g-3-fixed.jsonl> <v9g-4-fixed.jsonl>` | 0 | 16,000 hands; no payout discrepancies; no exclusions |
| `cmd /c npx tsx apps/server/src/bot-aivat-replay.ts apps/server/benchmark/results/duplicate-night9.json <piece-0.json> <piece-4.json> ... <piece-44.json>` | 0 | Twelve pieces, 4,800 pairs, 48 session clusters |
| `cmd /c npx tsx apps/server/src/bot-head-to-head.ts v8z v8z d8-aa 2 apps/server/benchmark/results/duplicate-aa.json 0 2` | 0 | Four A/A pairs, 22 decisions, four exact rows; complete sidecar |

Intermediate checks exposed three TypeScript narrowing errors and an action
alias error in the new test. Those checks exited 1, the errors were corrected,
and the final checks above exited 0. Formatting used Biome's safe `--write`
before the final read-only check. No test mutation or unsafe lint fix was used.

## Changed implementation files and lint inputs

All TypeScript names below are under `apps/server/src/`:

```text
bot-aivat.ts
bot-aivat-chance.ts
bot-aivat-toy.ts
bot-aivat-replay.ts
bot-aivat.test.ts
bot-benchmark-provenance.ts
bot-service.ts
bot-river-policy.ts
bot-turn-policy.ts
bot-preflop-tables.ts
bot-session-benchmark.ts
bot-head-to-head.ts
bot-slumbot-run.ts
bot-slumbot-pool.ts
bot-compare-table.ts
bot-lbr-run.ts
bot-head-to-head-pool.ts
bot-compare-pool.ts
bot-lbr-pool.ts
```

The remaining lint inputs are `apps/server/benchmark/frozen-v1.json` and
`apps/server/benchmark/bounded-run.mjs`. Documentation is in the benchmark
README and REPORT. Numerical artifacts and their provenance sidecars are
under `results/`; source logs were read without copying or modifying them.

## What passed and what remains open

The exact enumeration gate passes: six deals, 18 paths, both expected payoffs
-1/120 chips, absolute floating-point difference 1.25e-16. Exact late-board
chance centering, probability validation, action alias merging and unchanged
action RNG consumption also pass their tests. Existing service, adapter,
preflop-table and duplicate tests pass.

The real-log precision gate does not pass. Chance-only SE improvement is
1.0877x over raw and 0.9362x over all-in valued. Historical action AIVAT is
unavailable because exact policy/strategy records are absent. The duplicate
pieces retain valued scores only. Rule fallbacks remain explicit missing
strategy coverage in new logs. D2's numeric gate still needs a source. These
limitations are recorded in the public report and are not test successes.

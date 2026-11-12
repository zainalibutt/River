# Opt-in live safe bot

The default is OFF. `main.ts` selects the original v8z thinker when
`BOT_RIVER_SOLVER=true`, otherwise the original quick policy. This selection
stays unchanged for every existing table, including Champion (display name
Nyx, internal identity `nell`) and multiway tables reduced to two by folds.

`BOT_LIVE_SAFE=true` additionally enables the **Midas 1v1** table (`botPreset:
"midas"`): exactly two seats and one bot, `bot:midas`. Only that bot at that
preset uses the live-safe worker pool, on every street. With the flag off the
server refuses the preset. `GET /api/bot-capabilities` reports the running
server's `midasAvailable` flag with `Cache-Control: no-store`; the menu hides
the action until it receives literal `true`. A thinking cue follows Midas's
active turn, beside the existing seat clock.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `BOT_LIVE_SAFE` | false | Literal `true` enables the wrapper. |
| `BOT_LIVE_SAFE_VARIANT` | v9gpw2 | `v9go`, `v9gp`, `v9gpw`, or `v9gpw2`. Unknown values use the default. |
| `BOT_LIVE_SAFE_BUDGET_MS` | 8000 | Integer 1-10000, including startup, baseline preparation and re-solves. Room turn-clock limits can shorten it. |
| `BOT_LIVE_SAFE_THREADS` | 2 | Pool size 1-4; one inference participant per worker, no nested workers. Parallelism is across tables. |
| `BOT_LIVE_SAFE_MAX_HANDS` | 8 | Tracked bot/room/hand identities, 1-64. Bot-v-bot can consume two per table. |
| `BOT_LIVE_SAFE_MAX_DECISIONS` | 64 | Safe decisions per tracked hand, 1-256. |
| `BOT_LIVE_SAFE_ANYTIME_MARGIN_MS` | 2000 | v9gpw2 only, 0-7999 (0 turns it off). Once the budget has this much left, each re-solve stops adding iterations and plays the average it has, never below the 1x count. On a loaded 16-thread desktop, 20 hands at an 8000 ms budget: plain 2x hit the budget once and handed 3 decisions to v8z; with the margin, 44 of 44 decisions were Midas, the flop at most 6.2 s, and 14 solves stopped early. |
| `BOT_LIVE_SAFE_HARD_MARGIN_MS` | 750 | Every variant, 0-9999 (0 turns it off). This long before the budget every solve stops, below its 1x count if it must, and plays the average it has instead of timing out. At a 4 s budget the old build timed out 6 times in 24 decisions; with the hard stop, 26 of 26 decisions were Midas. |
| `RIVER_VALUE_BACKEND` | auto | WASM SIMD with TypeScript fallback; `ts` forces TypeScript. Live workers treat `wasm` as auto. |
| `RIVER_TURN_NETWORK` | required | Turn-end export stem, no extension. |
| `RIVER_FLOP_NETWORK` | required | Flop-end export stem, no extension. |
| `RIVER_TURN_START_NETWORK` | required | Turn-start export stem, no extension. |
| `RIVER_RIVER_NETWORK` | required | River export stem, no extension. |
| `RIVER_PREFLOP_PACK` | v3 | Existing v9gp selector: v2/v3/v4. |
| `RIVER_PREFLOP_PRIVATE_DIR` | apps/server/models/private/preflop | Optional absolute root holding private pack version directories (for example `v3/100bb.json`). |

`v9go` resolves off-tree without preflop tables. The other variants use the
shared `V9GP_POLICY_OPTIONS` in `bot-v9g-policy.ts`: `v9gp` adds preflop tables,
`v9gpw` also enables warm starts, and `v9gpw2` additionally doubles resolve
iterations. These options apply inside each isolated worker's hand chain.

Invalid numeric settings use defaults. Keep `BOT_RIVER_SOLVER` at its existing
value; disable `BOT_LIVE_SAFE` and restart to restore the original selection.

## Artifacts

Package both `.bin` and `.json` for each stem below. Set the four network
variables to their absolute paths **inside the server image**. These exports
were read from a local models folder for measurement and are not bundled
in this worktree.

| Export directory / stem | Weights bytes | Metadata bytes |
| --- | ---: | ---: |
| `turnend-6/river-buckets-128` | 3,941,388 | 1,678 |
| `flop2-ck50/river-buckets-128` | 3,417,100 | 1,526 |
| `turnstart-c1-53k-e50/river-buckets-128` | 3,417,100 | 1,852 |
| `night1-buckets/river-buckets-128` | 3,417,100 | 1,513 |

Weights total **13.54 MiB**, plus 6,569 metadata bytes, copied per worker and
shared by its hand chains. The v9gp family also needs the private v3 pack at
`apps/server/models/private/preflop/v3/100bb.json` (3,144,582 bytes) and
`200bb.json` (3,153,891 bytes). The default loader resolves this location from
both `src` and `dist`; alternatively set `RIVER_PREFLOP_PRIVATE_DIR` to the root
containing `v3`. Keep the pack private and out of git. Other pack versions need
their corresponding files.
WASM bytes are embedded in the compiled code. No Python or native BLAS is needed.

## Budget, release and memory

The async `liveSafeBotPolicy()` uses the existing thinker port. Workers send a
v8z action first; a controller timer terminates overdue synchronous JS/WASM work.
Timeouts, solver errors and internal chain fallbacks are counted and use v8z.
That hand stays on v8z, including after worker replacement, so invalidated carry
is never reused. Fallback can use another free worker while the old one retires.

The room passes `min(cap, remaining turn * 0.7)` to the thinker, where the cap
is `BOT_LIVE_SAFE_BUDGET_MS` (at most 10,000 ms) at a Midas table and
`RIVER_THINK_CAP_MS` (9,000 ms) elsewhere; the worker controller also caps it at
`BOT_LIVE_SAFE_BUDGET_MS`. Only Midas tables clamp each
street's clock to at least `ceil((configured budget + 100 ms) / 0.7)` for poll
and scheduling headroom. Standard clocks already exceed this minimum. Other
tables' clock configuration is untouched.

There is no queue. If all workers are busy or v8z itself misses the deadline,
the quick guard supplies a legal move. It equals v8z before the river, using the
same RNG seed. Emergency river guard actions are counted as `guardFallbacks`.

Live `RoomHub.broadcast()` releases policy and thinker state on `handRecorded`
for showdown, fold, all-in and timeout settlement. Workers call
`releasePolicyHand()` and discard the chain. Hand/decision limits bound retained
state; v8z retains its existing capped 64-entry cache. Each worker has a 512 MiB
V8 old-generation limit, which does not cap typed arrays or total RSS.

The local 100-hand sample peaked at **507 MiB RSS** with one active table and a
warmed two-worker pool; retained carry peaked at **13.8 MiB**, then returned to
zero. Planning estimate: about **200 MiB fixed pool/runtime + 350 MiB per actively
solving heads-up table**, roughly 900 MiB for two, before web-server/GC headroom.
This extrapolation is not a measured concurrent-table limit.

## Readiness and rollout

See [the measured report and exact commands](live-safe-readiness.md). The CLI
accepts `--hands`, `--threads 1|2|4`, `--budget-ms`, `--variant`, `--seed`,
`--first-hand`, `--out`, and `--merge <batch files>`. It reports per-street
latency, fallback reasons, cold start and RSS sampled every 250 ms. Each run
stops at nine minutes; the 100-hand measurement used four separate 25-hand runs.
Merge recomputes percentiles from raw decisions and preserves process boundaries.
This is a runtime/legality test against `pokerGuardPolicy`, not a strength test.

Watch `bot-live-safe` events and minute-level `bot-live-safe-summary` counters:
`time_budget`, `hand_disabled`, `worker_busy`, `model_error`, `worker_error`,
`chain_fallback:*`, guard fallbacks, worker restarts, active records and RSS.
Also watch CPU and turn-clock headroom. Model errors should be zero.

The flag remains off by default. Package the artifacts and measure the actual Railway CPU
and concurrent-table load before enabling. The historical v9gp measurement has only a preflop smoke;
it does not establish live timing or strength for v9gpw/v9gpw2.
TypeScript inference passed fallback correctness tests but lacks a live timing
run. The policy family name does not establish whole-game exploitability safety
for learned leaves, finite iterations or off-tree handling.

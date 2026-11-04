# Heads-up preflop v3: opponent sizes

`v9gp` now loads v3 at 100/200 bb by default. V2 remains available through
`loadPreflopPack(depth, 'v2')`; pass those packs to `tablePreflopPolicy` to use them.
Other bot variants retain their existing preflop policies. No live match was run.

## Tree

All targets are total contributions in bb. Each pack has 94 decision nodes.

| Decision | Non-jam aggressive targets |
| --- | --- |
| Button unopened | 2, 2.5, 3 |
| BB after limp | 3, 4 |
| BB after 2 bb open | 7, 9, 15 |
| BB after 2.5 bb open | 8.75, 9, 11.25, 15 |
| BB after 3 bb open | 9, 10.5, 13.5, 15 |
| Button after a 3-bet to x | round(2.3*x, 2 decimals), 18, 24, lifted to legal minimum |
| After a 4-bet or limp isolation | none; further raises are jams |

The root also has fold/limp/jam; other decisions have the appropriate
fold/call or check, plus jam. Every jam has a fold/call response. Legal minimum
raises, effective stack caps, and duplicate merging apply before labels are made.
For example, after 2/15 the minimum 4-bet is 28: 18 and 24 merge into 28,
leaving 28 and 34.5. Calling closes preflop except for the initial limp.

The 3.5x/4.5x relative 3-bets are supplemented by observed Slumbot totals.
Across the six available logs, Slumbot opened to 2 bb 10,957 times and isolated
limps to 3 bb 2,482 times. Its non-jam 3-bets were 9 bb (229) and 15 bb (137),
against our historical 3.57/3.65 bb opens. Its 4-bets were 18 bb (133) and
24 bb (53), against 6.45/6.6 bb. These observations determined sizes only;
realisation coefficients were not fitted. Occasional 81/135 bb 5-bets remain
off-tree and can lead to the existing unsupported-sequence fallback.

## Solve and frequencies

The v2 hand-dependent realisation config and 8,192-sample equity cache are
unchanged. Config SHA-256:
`6f7fdf0cf481c939f560cf5c761a4c23bc7b4fe48ed07631b291bad7c98affed`.
Equity SHA-256:
`088c145280ed4a7b7ad303a4838430abd17aaf9924536f45dafdad852763b8cb`.

| Depth | Iterations | Solve seconds | NashConv bb/hand | Exploitability bb/hand | bb/100 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 100 | 800 | 28.39 | 0.00192207 | 0.000961036 | 0.09610 |
| 200 | 1,100 | 38.46 | 0.00196490 | 0.000982450 | 0.09825 |

Exploitability is half the sum of unilateral deviation gains against the
exported average strategy in this finite, general-sum continuation surrogate.
Class and physical-combo best responses agree within 1e-8 bb; certificate and
reach frequencies are independently recomputed in tests from the equity cache.
This is not a certificate for full poker or a prediction of Slumbot win rate.
The v2 continuation priors and Monte Carlo equity uncertainty still apply.

Frequencies below are percentages, conditioned on both reaches and legal deals.
The JSON packs contain all 169 classes at every node; text dumps cover every node.

| Button action | 100 bb | 200 bb |
| --- | ---: | ---: |
| Fold | 15.30 | 13.89 |
| Limp | 29.60 | 30.23 |
| Open 2 | 29.06 | 33.34 |
| Open 2.5 | 7.70 | 8.77 |
| Open 3 | 18.35 | 13.77 |
| Jam | <0.00001 | <0.00001 |

| BB situation | 100 bb fold / call / all raises | 200 bb fold / call / all raises |
| --- | --- | --- |
| vs 2 | 19.61 / 57.97 / 22.42 | 20.03 / 58.46 / 21.51 |
| vs 2.5 | 30.30 / 51.96 / 17.74 | 31.10 / 51.63 / 17.27 |
| vs 3 | 35.87 / 49.25 / 14.88 | 37.13 / 48.06 / 14.81 |

BB vs 2 uses 7/9/15/jam at 22.0758/0.3417/0.0030/0.000013% (100 bb),
and 17.1709/4.3340/0.0036/0.000036% (200 bb).
Against limps, check/raise-3/raise-4/jam is
48.06/21.70/29.29/0.95% at 100 bb and 49.53/21.75/28.08/0.64% at 200 bb.

## Historical translation replay

[translation.json](translation.json) includes per-file source hashes, all actions,
raises only, Slumbot/client sides, client decision prefixes, and observed sizes.
Inputs were the six completed logs in a local Slumbot log folder (not in the repository);
the error JSONL is excluded. They contain v8z/v9g, not the reported v9gp match.

Replay reconstructs legal River observations and ACPC actions, then calls the
production `tracePreflop` with each pack. It preserves the Slumbot adapter's
fresh `slumbot` room/hand identity and actual recorded public actions. No bot
policy is sampled. The pseudo-harmonic mapper is unchanged: it brackets each
raise by the live legal targets in pot shares and uses a public-prefix seed.
Every 2 bb button open is now exact.

In these tables E/T/U means exact / translated / unsupported action counts.
Exact is local to the already mapped prefix. Unsupported includes later moves
after a translated abstraction terminal. Rates use all actions as denominator.
Passive actions are counted, so the raises-only figures in JSON have different rates.

| Log | Hands | v2 E/T/U | v3 E/T/U | Translated rate v2 -> v3 |
| --- | ---: | --- | --- | --- |
| rotation-2.jsonl | 6,924 | 8568/5395/35 | 12489/1474/35 | 38.54% -> 10.53% |
| rotation.jsonl | 1,352 | 1700/1083/4 | 2478/305/4 | 38.86% -> 10.94% |
| v9g-1-fixed.jsonl | 4,000 | 4984/3073/11 | 7239/818/11 | 38.09% -> 10.14% |
| v9g-2-fixed.jsonl | 4,000 | 4990/3158/26 | 7295/853/26 | 38.63% -> 10.44% |
| v9g-3-fixed.jsonl | 4,000 | 4950/3145/11 | 7214/881/11 | 38.80% -> 10.87% |
| v9g-4-fixed.jsonl | 4,000 | 4923/3104/12 | 7162/865/12 | 38.61% -> 10.76% |

Slumbot-only action counts and the fraction of our decisions whose preceding
history contains any translated action:

| Log | Slumbot v2 E/T/U | Slumbot v3 E/T/U | Client decision prefix translated v2 -> v3 |
| --- | --- | --- | --- |
| rotation-2 | 2578/3935/18 | 6499/14/18 | 53.57% -> 2.17% |
| rotation | 534/778/2 | 1312/0/2 | 53.97% -> 2.58% |
| v9g-1-fixed | 1508/2257/6 | 3763/2/6 | 53.39% -> 1.98% |
| v9g-2-fixed | 1481/2315/14 | 3786/10/14 | 54.08% -> 2.80% |
| v9g-3-fixed | 1531/2268/6 | 3795/4/6 | 53.45% -> 1.95% |
| v9g-4-fixed | 1512/2241/6 | 3751/2/6 | 53.15% -> 2.17% |

Most remaining translations are our old 3.57/3.65 opens and 6.45/6.6 3-bets.
These historical replay counts do not predict the action distribution of a new
v3 match. Slumbot's rare non-jam 5-bets and longer sequences remain a limitation.

## Reproduction and checks

Run from the worktree root. Set `UV_THREADPOOL_SIZE=1` and
`NODE_OPTIONS=--v8-pool-size=1`; Vitest runs with one worker and no file parallelism.
All outputs are inside the worktree. No git command, commit, or push is involved.

```text
cmd /c npx tsx apps/server/src/bot-preflop-solve-run.ts --depth 100 --tree v3 --seconds 120 --target 0.001
cmd /c npx tsx apps/server/src/bot-preflop-solve-run.ts --depth 200 --tree v3 --seconds 120 --target 0.001
cmd /c npx tsx apps/server/src/bot-preflop-translation-audit.ts <six completed JSONL paths>
cmd /c npx vitest run apps/server/src/bot-preflop apps/server/src/bot-v9g-policy.test.ts --maxWorkers=1 --no-file-parallelism
cmd /c npx tsc -p apps/server --noEmit
cmd /c node apps/server/tools/check-preflop-mutations.mjs
cmd /c npx biome check <the changed TypeScript files and mutation runner>
```

Solves, replay, focused tests (47), and typecheck exit 0. The initial test run
failed on stale v2 shape expectations, decimal chip conversion in test histories,
and the expanded sampling test's old timeout. Those were fixed before the passing
run. The initial replay needed the completed hand recorder after terminal folds;
that path is now covered by the replay tests.

The mutation runner exits 0 with all 8 mutations killed (each mutant suite
exits 1): reversed regret update, reversed equity winner, ignored card removal,
removed stack cap, corrupted best response, halved reported exploitability,
zero-sum certificate, and realisation incorrectly applied to all-ins.
Its old all-in mutation anchor was updated to match the current payoff code.
The existing hand-dependent-vs-flat realisation regression also passes.
The final scoped Biome check exits 0 with 10 files checked and no fixes.

Changed files:

- `src/bot-preflop-solve-tree.ts`: v3 default tree, explicit v2 tree option.
- `src/bot-preflop-solve-output.ts`: v3 labels, all open headlines and node grids.
- `src/bot-preflop-solve-run.ts`: `--tree v2|v3`, v3 default output directory.
- `src/bot-preflop-tables.ts`: default v3 loading and version-keyed pack cache.
- `src/bot-preflop-translation-audit.ts`: public ACPC replay through the live mapper.
- `src/bot-preflop-solve.test.ts`, `src/bot-preflop-solve-realisation.test.ts`,
  `src/bot-preflop-tables.test.ts`, `src/bot-preflop-translation-audit.test.ts`:
  legality, all-node lookup/sampling, exact 2 bb mapping, pack certificates,
  legacy loading, reach products, and historical replay regression coverage.
- `tools/check-preflop-mutations.mjs`: repaired all-in mutation anchor.
- `preflop/v3/{100,200}bb.{json,txt}`, `preflop/v3/translation.json`,
  `preflop/v3/mutations.json`, this README: generated evidence and documentation.
- `preflop/README.md`, `preflop/v2/README.md`: links and current default behavior.

Paths above are relative to `apps/server/`. V1/v2 JSON and text packs were not
rewritten. The exact final lint command was:

```text
cmd /c npx biome check apps/server/src/bot-preflop-solve-tree.ts apps/server/src/bot-preflop-solve-output.ts apps/server/src/bot-preflop-solve-run.ts apps/server/src/bot-preflop-tables.ts apps/server/src/bot-preflop-solve.test.ts apps/server/src/bot-preflop-solve-realisation.test.ts apps/server/src/bot-preflop-tables.test.ts apps/server/src/bot-preflop-translation-audit.ts apps/server/src/bot-preflop-translation-audit.test.ts apps/server/tools/check-preflop-mutations.mjs
```

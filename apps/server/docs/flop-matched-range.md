# Offline matched betting range diagnostic (test A)

Run from the worktree root with the same network and preflop environment as the
original production replay. Nothing contacts Slumbot or trains a network.

```powershell
npx.cmd tsx apps/server/src/bot-flop-matched-range.ts --spots dump-a.jsonl dump-b.jsonl --index index.jsonl --solver solver-dumps --logs log-a.jsonl log-b.jsonl --mode both --out matched-both.jsonl --shard 1/1
```

Replace the input names with your files. `--spots` and `--logs` take one or more
JSONL files. The solver directory contains `spot-01.json`, `spot-02.json`, etc.,
using the index row's `n`, padded to at least two digits. The output's parent
directory must exist, and output must be inside the current working directory.
It is overwritten at startup, then receives one JSON line per completed spot.
`--shard k/K` is one-based and selects by index row position, before any solves.
Logs and dump rows join by basename plus hand number; ambiguous matches fail.
Only indexed spots run. An indexed bet must be an exact-size off-tree flop bet
after OOP checks, with history `kb<chips>`; index `bet` is in big blinds.

Repeat with `--mode none --out matched-none.jsonl` and
`--mode ip --out matched-ip.jsonl`. `--lock` is an alias for `--mode`.

| Mode | OOP root | IP after check | Gadget in exact-size re-solve |
| --- | --- | --- | --- |
| `none` | Free | Free | Off |
| `ip` | Production frozen strategy | TexasSolver bet lock | Off |
| `both` (default) | TexasSolver check lock | TexasSolver bet lock | Off |

`none` literally applies no fixed strategies. Production's off-tree widening
normally freezes OOP's already played root, so `none` also releases that freeze.
Its parity reference is the same widened game solved with gadget off and no
locks. The initial blueprint and earlier observations still replay as production.

For `both`, non-check root mass follows the production frozen root row; a zero
residual row puts the remainder on the first non-check action. At IP's `k` node,
the nearest TexasSolver `BET x` (distance in bb; action order breaks ties) supplies
the exact observed bet probability. Remaining actions use matching TexasSolver
CHECK, other BET and ALLIN probabilities, or the gadget-off bot strategy when
unmatched, then normalize to the remaining mass. The selected Texas BET is
excluded from residual source labels. Zero residual weights use the first other
bot action. A preliminary gadget-off solve with the production root frozen
supplies IP's fallback strategy. The final solve uses production's exact widened
tree, iteration count and leaf construction; only root and `k` can be locked.

Missing combos first try suit permutations preserving the board as a set, then
the arithmetic mean of present, unblocked combos of the same pair/suited/offsuit
hand class. Missing class support fails instead of inventing a strategy.

Each output includes `n`, `file`, `hand`, `board`, `mode`, `botFold`, `botRaise`,
`actions`, `strategy` rows (`combo`, raw OOP decision `reach`, `probabilities`),
`oopDecisionMass`, full `ipBetReach`, per-player mapping `counts`, summed
`isomorphismMappedCombos`/`classMappedCombos`, and elapsed `ms` including replay.
Combo indices use the dump's 1,326-combo order. Fold and raise rates weight by
OOP decision reach; both are null when that reach has zero mass. Mapping counts
count combo lookups separately at the OOP and IP nodes.

The diagnostic verifies rebuilt observations through the replay machinery and
compares root ranges, pot, stacks, tree settings, board, history and public action
line with the supplied dump. Network weights are not in the dump, so the caller
must supply the original environment. All verification fixtures use synthetic
ranges, logs and networks; they do not establish a real-spot poker result.

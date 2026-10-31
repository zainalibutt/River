# Standalone street parity

Run from the repository root (PowerShell uses `npx.cmd`):

```sh
npx tsx apps/server/src/bot-street-parity.ts --make-spec --dumps apps/server/benchmark/flop-root.jsonl --count 10 --seed parity-1 --street river --pot 10 --stack 30 --iterations 40 --out apps/server/benchmark/river-spec.jsonl
npx tsx apps/server/src/bot-street-parity.ts --spec apps/server/benchmark/river-spec.jsonl --out apps/server/benchmark/river-parity.jsonl --iterations-multiplier 10 --texas-dir apps/server/benchmark/texas-river --threads 8
```

Use `--street turn` to generate turn games. Turn solves require
`RIVER_RIVER_NETWORK`, the usual river-network export stem without `.bin`.
The standalone turn path uses v9g's `perRiverShowdown` and the production
`solveRiver` core, with DCFR's default alpha=1.5, beta=0, gamma=2. It does not
load the unused flop, turn-end or turn-start networks. River solves use exact
showdowns. Neither path supplies a gadget, promises, carry record, fixed
strategy, reads or opponent model. No networks are trained or modified.

`--make-spec` accepts multiple files after `--dumps`. Each must start with a
`river-flop-root-v1` header followed by spot rows with `board` and `root.ranges`.
Selection is seeded and without replacement across the concatenated spots.
Additional board cards are sampled without replacement from cards absent from
the flop. Each player's class averages include zero-weight combos and exclude
all cards of the final board; blocked combos are zero. This changes the original
dump ranges deliberately. Output `n` starts at zero. Iterations default to 40;
`--iterations` overrides this in generation mode. Pot and effective stack behind
are supplied in bb, independent of the dump's chip units.

Specs are JSONL, one game per row:

```text
{n, street: "flop"|"turn"|"river", board: [card strings], pot, stack, ranges: [oop1326, ip1326], betSize, iterations}
```

`betSize` is a share of the pot in (0, 1], used by both players on every street;
the Texas export writes it as a whole percentage. Two flop-only switches bring
the standalone game closer to production: `--flop-leaf residual` adds the
`RIVER_TURN_RESIDUAL` turn-start leaf as v9g configures it, and `--raises sized`
lets the bot raise to the bet size as well as all-in. The Texas export stays
all-in raises only, so `--raises sized` is not a like-for-like comparison.

`n` must be a unique nonnegative safe integer. Ranges must have 1326 finite,
nonnegative weights in lexicographic `(a,b)` order with `a < b`; card key is
`suit*13 + rank`, suits `shdc`, ranks `23456789TJQKA`. Both ranges need positive
unblocked mass and at least one compatible joint deal. Positive and zero
unblocked members of a class must agree (relative tolerance 1e-10). Spec solving
fails on nonuniform ranges, even without Texas export. Blocked entries are
ignored. The iteration multiplier must be positive and produce a safe integer
iteration count for every row.

The opt-in tree menu is check, bet 66% pot, all-in; facing a bet, fold, call,
all-in raise; facing an all-in, fold, call. Bets at least 67% of the stack behind
collapse to all-in, with duplicates removed. Fractional-bb sizes retain 15
significant digits instead of production's whole-chip rounding. Default tree
settings in production are unchanged.

Each result row contains `n`, `street`, `board`, actual scaled `iterations`,
solve `ms`, `nodes`, and `facingBet`. Nodes are OOP root (`""`), IP after check
(`"k"`), and OOP facing IP's sized bet (`"kb<bb>"`). If the threshold collapses
the sized bet, the last history is `"ka"`. Each node supplies `player`, `actions`
and `strategy`: `{combo, probabilities}` with probabilities aligned to `actions`.
Labels are `k` check, `f` fold, `c` call, `a` all-in, `b<bb>` total street bet.
Only positive-weight unblocked combos are emitted, in dump combo order.

`facingBet` reports `history`, raw `reachWeight`, and normalized `fold`, `call`,
`allIn`, weighted only by `OOP root weight * OOP root check probability`.
It does not multiply by IP's betting reach. Zero OOP check reach yields null
frequencies. Facing an all-in, the all-in raise probability is zero.

With `--texas-dir`, each game produces `<n>-<street>.txt`; TexasSolver's
`dump_result` points to `<n>-<street>.json`. Run each input in a fresh TexasSolver
process **with that directory as its working directory**, so paths remain
portable. The tool writes inputs but does not execute TexasSolver. Both players
get `bet,66` and `allin` on all remaining streets; no raise or donk sizes are
emitted. Threads default to 8. Texas iteration/accuracy controls are fixed at
1000 / 0.3 and are independent of the bot's iterations.

TexasSolver's class parser drops weights <=0.005. Export divides each player's
positive class weights by that player's minimum positive class weight, making
the minimum 1 while preserving all relative weights; values above 1 are accepted
by its parser. Export fails if this scaling overflows float32. No classes are
silently truncated.

## TexasSolver compatibility caveat

The bot implements the explicit sizing and inclusive threshold rule above.
The generated commands follow TexasSolver's
[sample input](https://github.com/bupticybee/TexasSolver/blob/master/resources/text/commandline_sample_input.txt).
Stock upstream [GameTree.cpp](https://github.com/bupticybee/TexasSolver/blob/master/src/GameTree.cpp)
also rounds bets, uses a strict threshold against initial commitments, restricts
short all-in raises, and uses a separate donk menu after an OOP call on the turn.
Consequently these commands alone do **not** prove an identical tree with every
unmodified TexasSolver build, particularly for fractional bb or shallow stacks.
Check that build's resulting action sizes and river menu before interpreting a
gap as solver/network error. This tool does not patch or run TexasSolver.
The weight scaling accounts for the cutoff in
[PrivateRangeConverter.cpp](https://github.com/bupticybee/TexasSolver/blob/master/src/tools/PrivateRangeConverter.cpp).

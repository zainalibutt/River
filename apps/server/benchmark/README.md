# Frozen poker benchmark, D8 v1

`frozen-v1.json` is the versioned definition. Hash it, the source tree, model
exports and preflop packs before collecting a result. Changing any of them
creates a new configuration. Do not tune on confirmation outcomes or stop a
match when an interval first looks favorable. Results measured before this
definition existed are not confirmation on these seeds.
The reference's four model exports and the v3 preflop packs are identified by
verified SHA-256 hashes in the definition. Runner hashes must match them for
that configuration; model filenames alone do not establish a match.

The three primary styles are value, camouflaged and reverse-sizing. They were
untouched for the original comparison; they have since been observed and cannot
be described as newly unseen opponents in future work. Balanced, overbluff and
the familiar ordinary/scripted tables are diagnostics. The benchmark fixes
30,000 paired hands per primary style, 30,000 duplicate pairs, 300,000 shark
hands, three shark2-fast seeds, and a 16,000-hand Slumbot screen followed by a
predeclared 48,000-hand confirmation. Slumbot seeds control our action RNG;
they do not control the service's cards. Use identical reference/candidate
seeds and session ranges for paired local comparisons.

## AIVAT method and frozen values

This implements the singleton-partition specialization of
[Burch et al., AAAI 2018](https://poker.cs.ualberta.ca/publications/aaai18-burch-aivat.pdf).
Imaginary-observation averaging is the identity here. It does not implement
the paper's more powerful hidden-holding aggregation or claim its published
variance reduction. For every supported own decision at history h, add

`sum_a pi(a|h) Q(h,a) - Q(h,a_observed)`

to the raw chip payoff. Opponent strategy probabilities are not required.
The solver supplies its actual row at its sampling site, including any final
bucket rounding remainder. Preflop table rows use their actual normalization.
The recorder merges probabilities after the same action legalisation used by
play, including abstract raises that become the same all-in. It records the
observation, alternatives, exact probabilities, frozen values and selected
action. It never re-solves or consumes extra action RNG draws. Flop, turn,
river and table-preflop samplers are supported, including selected exploitation
rows. Rule-policy fallbacks currently have no exact distribution hook; they
receive zero correction and an explicit `strategy-unavailable` record. This
is partial action coverage, not a fabricated pure strategy.

`pot-share-uniform-32-v1` is the frozen action heuristic: estimate hero's
showdown share using 32 deterministic uniform opponent/runout samples seeded
only by the cards already visible at the node. For each non-fold alternative,
`Q = share * (current pot + own new contribution) - own total contribution`.
For a fold, `Q = -own contribution already paid`. This is intentionally a
cheap checkdown heuristic; it does not predict an opponent's response to a
raise. No value network, coefficient, or outcome is fitted on evaluation
hands. Approximate Q affects variance, not the mean of an exactly centered
action control.

Late-board chance controls use exact showdown equity against both actual
holdings: `pot_before_deal * (equity_before - equity_after)`. Only turn and
river deals while betting is open qualify. Both equity sums are enumerable,
so there is no preflop Monte Carlo error in the AIVAT unbiasedness claim.
No correction is selected by showdown, winner, or fold outcome. Offline
Slumbot chance correction is disabled for the entire input set if any hand's
opponent holding is missing. Betting-closed runouts are excluded. The separate
existing all-in-valued estimator uses exact postflop equity and 4,000 seeded
preflop samples, so its preflop values are approximate.

Conditioned on any reached full game history, the expectation of the action
control is `sum pi Q - sum pi Q = 0`. Exact late-board equity is a martingale
over the legal remaining deck, giving the same identity for chance. Summing
the corrections over finitely many decisions therefore preserves expected
payoff, whatever the opponent does. Duplicate subtraction and averaging are
linear, so the same proof applies before session clustering. The enumerable
three-card poker test visits all six ordered deals and 18 action paths with
their exact policy probabilities, including an unknown opponent's fold/call
choices. A separate test averages over every legal river card.

## Estimates and qualification

Always publish raw, all-in-valued and AIVAT on the same observations. Use
session clusters for duplicate/style/shark results. Preserve each duplicate
pair before aggregation. Use run clusters for Slumbot with between-hand
memory; independent hand clusters are used for the no-memory run. Report
Student-t intervals and SEs, not the spread of already pooled shard means.
The 2x target means both `SE(raw)/SE(AIVAT) >= 2` and
`SE(all-in-valued)/SE(AIVAT) >= 2`; it is a measured gate, never a guarantee.
Zero-variance A/A data cannot establish a reduction ratio.

The B6 gates are encoded numerically in the JSON: pooled style gain at least
+15 bb/100 with a positive 95% lower bound, positive point estimates on every
primary style, paired shark extra-winnings one-sided 95% upper bound below
+5 bb/100, adaptation on at least 5% of eligible roots per street, mean
adapted-root action TV at least 0.02, zero budget overdrafts, and p95 decision
latency at most 3 times v9g. These are the B6 v2 acceptance gates, superseding
the earlier +20 practice-table proposal. A match gate is not a whole-game
exploitability certificate. D2 is explicitly unresolved because no numeric
definition was located; it cannot be marked passed. Wide intervals,
incomplete provenance, failures, unsupported strategy coverage or payout
disagreements prevent qualification. Do not exclude failures silently.

## Provenance and runners

The duplicate, compare-table, LBR/shark and Slumbot collection runners write
`<out>.provenance.json` before play. They finalize it with completed hands and
failure counts, and preserve an incomplete status on abnormal exit. Records
include the schema/version, benchmark JSON hash, commit read directly from
refs without invoking git, source-content hash (including uncommitted edits),
model JSON/bin hashes, preflop pack version and hashes, allowlisted runtime
environment, policy names, seed strings, planned hands and run settings.
The executed engine build and dependency lockfile are hashed separately from
the TypeScript source. Pooling CLIs print provenance JSON to stdout, with
unknown original run identities/failures explicitly marked as unknown.
No hostnames, absolute artifact locations, credentials or unrestricted env
dumps enter the record. Null commit/model hashes are explicit missing data,
not a qualification. An abrupt OS kill can leave `running`; treat it as
incomplete. Slumbot JSONL rows also retain per-decision records and a source
fingerprint. Keep the sidecar, hand log and error log together. Never append
two independently started Slumbot runs into the same hand log.

The duplicate runner additionally stores both constituent hand records and
raw/valued/AIVAT pair scores. Compare-table keeps candidate and baseline
hands, with AIVAT only when both runs contain it. Cached legacy baselines
therefore cannot silently acquire AIVAT. Nine-seat evaluations remain raw
and valued diagnostics; heads-up chance logic is never applied to them.

Historical v9g logs do not contain strategy probabilities or policy/model
fingerprints. The replay tool validates payouts and measures supported chance
corrections, but labels action AIVAT unavailable. Querying a different present
policy does not repair those missing fingerprints. Duplicate pieces with
scores alone similarly cannot recover absent controls. Replay summaries hash
their input bytes and reject mixed policy pairs and overlapping sessions.

## Bounded commands

Run from the worktree root. The wrapper enforces one value/BLAS/libuv worker,
one Rust worker, hidden child windows, and a 540-second process-tree timeout.
Run at most two such commands concurrently. A full frozen campaign must be
split into small session ranges whose pieces fit the time limit; these
commands are templates, not permission to launch an overnight campaign.

```powershell
node apps/server/benchmark/bounded-run.mjs cmd /c npx vitest run apps/server/src/bot-aivat --maxWorkers=1 --no-file-parallelism
node apps/server/benchmark/bounded-run.mjs cmd /c npx tsc -p apps/server --noEmit
node apps/server/benchmark/bounded-run.mjs cmd /c npx biome check <changed-files>
node apps/server/benchmark/bounded-run.mjs cmd /c npx tsx apps/server/src/bot-aivat-replay.ts summary.json <logs.jsonl-or-duplicate-pieces.json>
node apps/server/benchmark/bounded-run.mjs cmd /c npx tsx apps/server/src/bot-head-to-head.ts v8z v8z d8-aa 2 aa.json 0 2
```

Slumbot collection: `bot-slumbot-run.ts <policy> 2000 <seed> <out.jsonl>
rotation`; the policy, models and preflop pack must already be locked.
Comparison: `bot-compare-table.ts <table> d8-style-v1 <piece-sessions> v9g
<candidate> <out.json> <first-session> rotation`.
Shark: `bot-lbr-run.ts <policy> <seed> <piece-sessions> <out.json> 100 rotation
--first-session=<first-session>`; add `--shark2 --shark2-fast` for shark2-fast.
Every piece retains the full seed and original session numbers; do not
substitute a new seed to make a slow piece easier.

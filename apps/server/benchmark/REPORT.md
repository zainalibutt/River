# Poker re-solving: method and evaluation record

Status: retrospective write-up skeleton and frozen evaluation protocol.
No result in this report establishes global exploitability, production
safety, or superiority to professional players. Rates are bb/100.

## Research question

Can safe continual re-solving retain the strength of the earlier read-driven
policy while resisting an adaptive local opponent, and can a known-strategy
estimator make external comparisons more precise?

## Method

The v9g chain carries opponent counterfactual-value promises between streets.
Finite iterations, learned continuation values, restricted betting trees,
preflop rules and off-tree recovery limit the scope of its safety argument.
v9go adds off-tree re-solving. Preflop v2/v3/v4 variants use separate exported
packs and must be identified by content hashes, not just the name v9gp.

The frozen benchmark uses paired local deals, seat-swapped duplicate matches,
a local shark and shark2-fast, and Slumbot as an external opponent. The three
primary styles are value, camouflaged and reverse-sizing. Familiar scripts
are diagnostics. These styles were held out for the historical comparison;
future evaluations require fresh locked seeds and must acknowledge prior
exposure to their behavior.

AIVAT v1 uses exact own-action probabilities and a frozen deterministic
pot-share heuristic, with singleton history partitions. AIVAT v2 uses the
frozen flop, turn-start, and river value-network exports with solver ranges
conditioned on the public path. Both versions use exact legalised action
probabilities; the frozen spec records their recipes and hashes. Exact
turn/river chance controls are added only with both holdings available for
every hand.
The implementation and conditional-expectation argument are in the companion
README. Hidden-holding imaginary-observation aggregation is future work.
Raw payoff is the primary strength endpoint; valued and AIVAT results are
reported alongside it on identical observations and clusters.

## Evaluation protocol and pass marks

The versioned JSON fixes policies, seeds, table sets, workloads, units,
estimators, B6 acceptance gates and artifact provenance. D2's numeric source
remains TODO; no D2 pass may be inferred. Slumbot's server controls deals;
our seed only fixes our action stream. Missing/failed hands, payout mismatch,
partial strategy coverage, incomplete artifacts and wide intervals must be
reported. A test of a toy game is evidence about the estimator, not proof of
correct policy probabilities in historical logs.

## Experiments and existing measurements

### Safe chain and the local shark

The shark won +140.1 (95% interval 108 to 172) against v8z, -34.9 (-73.1 to
+3.4) against v9g, and -56.9 against v9go. Negative shark winnings mean the
focal policy won. These are supplied historical measurements. TODO: attach
hash-identified shards, sample sizes, paired differences and v9go's interval.
A weak local response is a lower-bound probe of exploitability, not an upper
bound; its failure to win does not certify safety against other opponents.

TODO: a directly measured duplicate v9g-versus-v8z result with confidence
interval and complete provenance. Do not substitute differences between their
separate shark matches for a direct match result.

### Speed

Reported turn-decision time fell from 53 seconds to approximately 3 seconds.
TODO: fixed-model uncached p50/p95/p99 timing, sample size, queueing conditions
and timeout/fallback rates. A reported typical time does not establish the
frozen p95 latency gate.

### Off-tree recovery

v9go gained +14.8 (3.8 to 25.9) against v9g across the historical unseen
styles. Its Slumbot result was +2.0 raw and -7.3 all-in valued. Its shark
result was -56.9 from the shark's perspective. TODO: shard identities,
per-style results, sample counts, fallback/carry-failure rates, and paired
shark interval. Exact action mapping, chip origins and preserved promises
remain essential failure modes; an attractive aggregate rate cannot validate
those mappings by itself.

### Slumbot and preflop packs

| Variant | Hands | Raw bb/100 | All-in valued bb/100 | Interpretation / failure mode |
| --- | ---: | ---: | ---: | --- |
| v9g | 16,000 | -25.5 | TODO | Baseline external deficit; missing historical policy fingerprints |
| v9go | TODO, within reported 16k-48k range | +2.0 | -7.3 | Off-tree improvement; raw/valued difference remains noisy |
| v9gp, v2 pack | TODO, within reported 16k-48k range | -14.1 | TODO | Did not establish an external improvement over v9go |
| v9gp3, v3 pack | 48,000 | -7.6 | TODO | Larger sample remains below zero at the point estimate |
| v9gp4, v4 pack | 16,000 | -41.6 | TODO | Large regression; reject favorable-only reporting |

These figures were supplied with the task. TODO: confidence intervals, failed
hand counts, replay disagreement counts, pack hashes and predeclared paired
comparisons where applicable. Slumbot deals are not duplicate paired samples.
Pack continuation assumptions, off-tree translation and fallback paths can
change play; a stronger abstract preflop solve need not improve the full game.

### Exploitation attempts

The recorded B6 v2 design input reports that v9gh's read-triggered hybrid
gained +41.1 (28.9 to 53.4) over v9g across 30,000 paired hands on the three
primary styles: value +30.5, camouflaged +43.0, reverse-sizing +49.9. The shark
won +109.5 (66.5 to 152.5) from the hybrid versus -34.9 from v9g. The recorded
paired point difference was about +144 extra shark winnings: the veto failed.
These values are design-input evidence, not rerun measurements in this work.

The same input reports v9gy at 0.0 improvement, with two adaptations in about
3,500 eligible river roots. v9gx's inherited-cap variant did not fire because
the baseline already violated the inherited limits, by up to about 1,700
chips in the reported cases. Binding per-holding caps can suppress useful
adaptation; relaxing them requires an explicit budget and certification.

Existing implementation reports describe v9gz river-only and v9gz2 turn/river
budgeted exploitation. The v9gz2 default 20-hand smoke accepted 6/9 proposed
turn roots and 4/8 proposed river roots, with reported mean action TV per
eligible decision of 0.0000190 and 0.0002686 respectively, and zero reported
maximum overdraft. These engineering smokes do not demonstrate the B6 mean
adapted-root TV target of 0.02 and are not strength evidence.
TODO: frozen large-sample style/shark matches,
gate-qualified adaptation and latency. Small local certificates do not imply
an absolute whole-game exploitability bound.

### Estimator validation and real-log precision

Exact enumeration covers all six deals and 18 action paths. Raw and AIVAT
expectations are both -1/120 chips, differing by 1.25e-16 from floating-point
rounding. Raw variance is 1.71493056 and AIVAT variance is 0.77193056. The exact
bias test passes; this toy result is not a real-log precision claim.

The reanalysis validates payouts on all 16,000 v9g Slumbot hands. No hands were
dropped. Both private holdings are available on every hand, including folds.
With no between-hand memory, the estimates use 16,000 independent hand
clusters. SEs and 95% intervals below are in bb/100.

| Estimator | Mean | SE | 95% interval |
| --- | ---: | ---: | --- |
| Raw | -25.4883 | 14.8452 | -54.5865 to +3.6100 |
| All-in valued | -22.9484 | 12.7778 | -47.9943 to +2.0975 |
| Exact late-board chance controls only | -27.3615 | 13.6483 | -54.1137 to -0.6094 |
| Action AIVAT v1 | unavailable | unavailable | unavailable |
| Action AIVAT v2 | unavailable | unavailable | unavailable |

The chance-only SE improvement is **1.0877x versus raw**, and **0.9362x versus
all-in valued**, so it is less precise than the latter. The requested **2x SE
target is not achieved**. This run replays the four fixed v9g logs (16,000
hands, 16,000 independent hand clusters); payout validation passed for every
hand. The recorded rows contain no historical action distributions or v2
tracked ranges. Therefore the requested v1 and v2 action-AIVAT means and SEs
are unavailable, and chance-only is reported separately rather than
misidentified as either version. Re-querying today's policy would not recover
the historical probabilities. Original collection failures remain unknown;
zero failures here means zero failures of replay, not proof of failure-free
collection. The run artifact and input hashes are in
`results/slumbot-v9g-v2.json` and its provenance sidecar.

The v2 implementation is frozen as `d8-frozen-v2` in `frozen-v2.json`; v1
remains available as `frozen-v1.json` and the default heuristic. The v2 spec
pins `flop2-ck50`, `turnstart-c1-53k-e50`, and `night1-buckets` exports by
JSON and binary SHA-256, as well as the recipe and source files. The
enumerable toy remains unbiased (18 paths; expectation difference
1.25e-16 chips), and a bounded inference smoke passed on all three streets
using a local models folder (`results/aivat-v2-smoke.json`). That smoke
checks wiring and centering, not precision or strength. A 16k v9go sample was
not run because the share the fleet share
returned access denied in this environment.

Twelve historical v9b-versus-v8z duplicate pieces contain 4,800 pairs across
48 sessions. Their pooled valued result is +2.7168 (-15.2601 to +20.6938), SE
8.9360. They retain neither raw pair scores nor decision controls, so raw and
AIVAT SEs and a variance ratio cannot be reconstructed. The unavailable fields
are null in the artifact rather than guessed. New runners retain these data.
These are older variants, not a direct v9g-versus-v8z result.

A new local v8z A/A smoke stored four duplicate pairs and 22 own decisions:
four exact solver distributions and 18 explicitly unsupported rule decisions.
Raw and AIVAT pair scores were both zero. This checks recording and symmetry;
zero variance cannot establish a precision ratio or full action coverage.

Input-content hashes, exact numerical summaries and provenance are retained
in `results/slumbot-v9g.json` and `results/duplicate-night9.json` with sidecars.
The target requires new qualifying decision records and an independently
frozen stronger heuristic or imaginary-observation aggregation if the current
one remains too noisy. No additional live matches were launched for this work.

## Failure modes and reproducibility

Policy re-query must reproduce the original configuration and strategy state;
matching a version label is insufficient. Outcome-dependent missing cards,
discarded failed hands, replay mismatches, legalisation mismatches, future
information in Q, fitted correction coefficients, reused sessions and
incorrect cluster units can all invalidate an otherwise plausible estimate.
New records retain exact sampler rows and pre-decision observations so these
claims can be audited. Frozen Q need not be accurate for unbiasedness, but an
inaccurate Q can increase variance. The 32-sample checkdown heuristic may be
too weak to reach the precision target.

## Source ledger

- Task-supplied measured facts: shark, Slumbot, unseen-style and speed figures.
- Recorded B6 v2 design input: hybrid and zero-slack attempts and their gates.
- Existing turn-certificate implementation report: v9gz2 smoke measurements.
- Replay artifacts from this work: 16,000 Slumbot hands and 4,800 duplicate pairs,
  with input hashes, uncertainty and explicit unavailable-estimator fields.
- [Burch et al. (2018), AIVAT](https://ojs.aaai.org/index.php/AAAI/article/view/11481):
  estimator methodology; this report claims no transfer of its empirical gains.

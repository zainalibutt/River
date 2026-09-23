# Experimental shadow package and nine-seat canary

Status: synthetic-only, server-side experiment. Ordinary River startup still does not create an action shadow, load these models, or observe real players. The shadow predicts actions; it does not choose bot actions.

## Reproducible artifact

`npx tsx apps/server/src/bot-learning-shadow-package-run-v3.ts` rebuilds the v3 candidate from the frozen v2 artifact, reruns the offline online-forecast gate, and writes `apps/server/models/opponent-action-v3.experimental.json` only if the gate passes. An existing artifact with different contents is refused instead of overwritten. The artifact contains the candidate, exact selected tuning, training and online campaign definitions, synthetic provenance, gate checks, and SHA-256 compatibility fingerprints for both candidate and frozen model. The loader validates those fields and the ordered feature schema. These fingerprints detect mismatched or accidentally altered local files; they are not signatures or proof of provenance against a malicious editor.

The saved frozen-model fingerprint is `703a78877d2bfbd8970b0837bc1393684abce1ed83ddaf04378b52e6bcf2098d`; candidate fingerprint is `a7a9801b57ac34c34042dc2c15badd48af6ac6c13c45df2db4befd01a96ece6a`. The selected gate needs four prior observations, advantage margin three, learning rate 0.2, decay 0.98 and maximum candidate weight 0.9. This pass corrected the injectable shadow's old eight-observation default to match the gate's four. V3 was rejected as a static replacement; this artifact is eligible only for the fallback-protected online shadow experiment.

A second full package run reproduced the same model fingerprints, passed the gate again, and confirmed the existing-artifact no-overwrite check.

## Local synthetic run

`npx tsx apps/server/src/bot-learning-shadow-canary-run-v3.ts` loads and validates that exact pair of artifacts. It plays 100 distinct nine-seat synthetic hands, preserving stable shadow actor identity across hands, and drains forecast work between hands. The benchmark has no network sockets or real people. Its accepted-action callback supplies the game's pre-action observation after authoritative acceptance; the same shadow feature builder and scoring queue are used as in the injectable transport seam.

| Measure | Result |
| --- | ---: |
| Accepted actions / forecasts | 2,398 / 2,398 |
| Adapted forecasts | 423 |
| Dropped / failed / pending at finish | 0 / 0 / 0 |
| Peak pending (limit 128) | 65 |
| Feature capture p95 | 0.049 ms |
| Forecast inference p95 | 0.054 ms |
| Total local run | 861 ms |

Timing is a single local-machine sample for synthetic callback processing. It excludes the transport's `viewFor` and `observationFor` preparation, WebSocket traffic, other server load, and production hardware variability. It is not a service-level latency guarantee. Unit tests separately force a full queue and verify that only shadow work drops.

A second canary repeated the 2,398 forecasts, 423 adaptations, peak queue of 65, and zero drops/failures. Its capture and inference p95 values were 0.027 ms and 0.048 ms; wall time was 671 ms. The variation is another reason not to treat these local timings as a rollout threshold.

## Next gate

Run an end-to-end nine-seat RoomHub/WebSocket canary with representative request cadence, measure accepted-action command latency with shadow off and on, verify no client leakage or chip changes, and define a conservative rollback switch. Before enabling for real players, document the privacy/consent policy and operator approval. Neither this artifact nor these metrics authorize a live rollout or learned bot decisions.

# Bot action shadow: server-only experimental boundary

Status: implemented as an injectable `RoomHub` option; **off in ordinary server startup**. No production model, environment flag, database write, bot-policy switch, or client protocol field was added. This is not approval to study real players.

## What the seam does

For an explicit human `act` command, the room hub captures a pre-action observation, derives the same ordered public numeric features and legal fold/check/call/raise buckets used by the offline schema-two campaign, and keeps the prepared input in process memory. The action must pass the authoritative room submit and emit `acted` before the shadow updates. The existing request-id replay cache runs before capture, so a retry is not learned twice. Timeout actions, bot turns, rejected commands, and social actions do not train this shadow.

Accepted labels update an actor's causal count/rate history synchronously. Forecast scoring is scheduled after the game command path through a bounded queue (128 pending), one item per event-loop beat. A full queue drops forecast work, not poker actions. Errors are reported without changing the room result. In-process statistics expose only aggregate forecast count, adaptation count, drops, failures, mean log loss, and capture/inference p95 over a bounded 256-sample timing window. No raw cards, player names, predictions, features, or per-actor statistics are logged or persisted by the shadow. Departure, kick, or expired reconnect grace clears that actor's history, model evidence, and queued forecasts. A reconnection inside grace retains the table-session read.

The forecaster still starts each actor on the frozen model and weights the candidate only after that actor's prior accepted actions provide enough evidence. This predicts opponent action; it does **not** pick a bot move or claim expert poker play. The available v3 candidate and gate are synthetic-only (see `34-bot-online-forecast-gate.md`).

## Proven and pending

- Automated table tests exercise real in-process forecasting, accepted versus rejected actions, duplicate request IDs, fail-open capture errors, non-leakage to both clients, queue bounds, and actor forgetting. The full suite and typecheck pass at this checkpoint.
- A synthetic nine-seat model-loading and queue canary has passed; see `36-bot-shadow-canary.md`. There is still no end-to-end transport load result or production latency threshold. A local callback p95 is not a deployment benchmark.
- Actual live activation is deliberately absent. Before that, choose and document a consent/privacy policy for real-person action analysis, freeze and validate both model artifacts, run a representative nine-seat latency/queue canary, and add an explicit operator rollback switch. Re-run the held-out gate if the model, feature order, or training distribution changes.

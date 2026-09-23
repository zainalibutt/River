# Bot opponent-model contract

This packet begins River's adaptive-memory phase without claiming machine learning or wiring persistence. It defines the public evidence, decay and confidence calculations that later server storage and bot policies may use.

## Ownership and identity

The eventual persistence key is `(bot personality ID, human player ID, model schema version)`. A named bot owns its own read of a human; bots do not share private memories. Anonymous population values are cold-start priors, not another bot's observations. Guests may receive session-only modelling until River has a stable identity for them.

The pure engine module has no identity store. Its caller supplies one opponent's previous state and one completed-hand evidence item. The server and future persistence layer own exact-once processing and the key. A durable implementation must use a stable observation ID containing the room and settled hand identity before retries or multiple server instances are allowed to update storage.

## Legal evidence

`opponentEvidenceFromHand` reads only the completed public hand record:

- whether the player voluntarily called, raised or went all-in before the flop;
- whether the player raised before the flop;
- aggressive actions versus passive calls;
- additional aggressive chips divided by the pot immediately before that action, when exact numeric facts exist;
- whether the player reached a public showdown.

An all-in is aggressive only when its resulting street commitment exceeds the previous highest commitment. An all-in call is passive. Old records without numeric facts do not invent an exact sizing ratio.

The evidence contains no hole cards, folded-card guesses, bluff/value labels, owner-only skill labels, shuffle data, seed material, dialogue sentiment or another bot's memory. A later revealed-card feature must use cards actually exposed at showdown and must remain separate from unrevealed folds.

## State, priors and decay

`OpponentModelStateV1` stores decayed effective counts rather than a permanent label. Its first summary is pulled toward configurable population priors for VPIP, preflop raise frequency, aggression, showdown frequency and aggressive sizing. Confidence rises smoothly with effective hand count and remains below one.

Evidence loses half its weight after the configured 30-day half-life. A new observation is added after old evidence decays. This lets a player's recent behaviour matter without making one unusual session permanent. The default prior weight is eight hands and the confidence scale is twenty hands; both are tuning values, not poker truths.

`sampleCount` is an effective, possibly fractional hand count after decay. It is not a count of rows in storage.

## Current implementation boundary

The pure module and tests now exist. They can extract legal hand evidence, smooth it against priors, increase confidence over repeated hands and decay old observations. The live `RoomHub` keeps one in-memory model map per named bot, applies a settled hand once using `(room ID, hand number, commit)` as its session idempotency key, and supplies copied summaries only to that bot's server-side decision observation. Client snapshots and social events do not contain model fields.

OG now makes a bounded use of a confident read only when the remembered opponent is also the current hand's last aggressor. A high-aggression, low-showdown opponent can lower an OG's marginal call threshold by at most 0.05; a low-aggression, high-showdown opponent can raise it by at most 0.05. The adjustment begins only above 0.25 confidence and scales with confidence. It does not assign a hand, bluff label or certainty to the opponent.

The fixed multi-hand gates now prove that a mature read changes gradually when recent behaviour reverses, one observation cannot erase a long history, confidence remains below certainty, low-confidence summaries have no policy effect, and the opponent adjustment remains OG-only with a hard 0.05 threshold cap.

The next implementation packet must define durable storage, cross-session loading and exact-once writes before retaining data beyond one room lifetime. Durable persistence, database migration and learned prediction remain explicit non-goals for this packet. Table controls exist as a separate room-creation contract and expose neither model state nor confidence.

## Opt-in persistence seam

The subsequent storage seam defines a service-role-only `bot_opponent_observations` table and a server adapter. A row is keyed by bot personality, stable human player ID, model version and completed-hand key. The database primary key prevents duplicate accepted hands; the adapter uses conflict-ignore inserts so a retry cannot increase a count. Rows contain the public evidence above, not cards or a guessed bluff/value label. Anonymous sessions must never be written to this table.

Loading is an ordered replay through the same pure decay/update function used in a room. The adapter refuses more than 2,048 rows rather than silently dropping older evidence; retention or checkpointing must be designed before that limit is reached.

`RoomHub` now accepts the adapter and loads a signed-in, seated human's read for each named bot before the first hand using that pair. Only verified non-anonymous room members are written. A completed hand updates in-room memory immediately and schedules one database insert per bot/human pair; the server's shutdown path waits for pending inserts. An insert gets two delayed retries with the same hand key so a lost response after a successful commit cannot double-count. A final failure is reported to the server error sink, while play continues with session memory. A new room in the same process waits for its player's pending inserts before loading. Hard-kill loss during an unfinished background insert and cross-server races remain limitations.

Production activation is explicitly gated by `BOT_OPPONENT_PERSISTENCE=true`; the default remains session-only. The migration has not been applied to the linked cloud database and the flag has not been enabled there. Cross-hub, lost-response and storage-failure tests prove the opt-in path in process. On 23 September, a separate unlinked local Supabase stack applied the River baseline and all migrations; `bot-opponent-store.local.test.ts` then passed against its actual Auth and REST endpoints, proving one saved observation after a duplicate request, per-bot isolation and rejection of player-role reads. No live ML inference is claimed.

The local API canary now also proves authenticated and anonymous clients cannot insert observations, while the service role can append but cannot update an existing row. The test only accepts a loopback URL and remains skipped in the ordinary suite unless local canary credentials are supplied.

The earlier bot canary needed a test-only baseline because River's former active migration folder could not bootstrap an empty database. On 23 September, a reconciliation pass recovered the actual remote historical SQL and rebuilt an eleven-file active migration chain. A fresh unlinked Supabase reset passed from that chain. The former local timestamp variants are preserved under `supabase/migration-archive/pre-20260923/`; the bot-observation migration is preserved under `supabase/pending/` so the history repair could not deploy it accidentally.

Before that folder repair, `supabase migration list --linked` showed six remote-only versions, ten local-only versions and one match. After Zain approved a production repair window, a manual backup and live preflight passed. The two already-live 5K economy and cosmetics versions were recorded in remote history; a clean dry run listed only explicit inventory grants and the forward `RESTRICT` ledger contract; those two migrations were applied. A final list showed eleven local/remote matches and a final dry run was up to date. The bot table and persistence flag remain untouched.

A post-repair read-only check confirmed the bot table is absent, the linked player key is a non-null UUID, both ledger-related foreign keys validate as `ON DELETE RESTRICT`, ledger refs are non-null and length-checked, and the economy/signup objects remain present. Zain chose to reconcile the wider drift first. The bot-table SQL, its new migration version and the server flag remain separate gates; the ignored `docs/private/bot-persistence-rollout.md` records the superseded scoped option and owner decision. No bot-table write or flag change occurred.

## Acceptance gates

- A player absent from a hand produces no evidence.
- A preflop raise records VPIP and PFR; an all-in call is not classified as a raise.
- Missing sizing fields produce no invented sizing sample.
- One extreme hand remains low confidence and close to the population prior.
- Repeated consistent hands increase confidence but never produce certainty.
- One half-life halves prior effective evidence before the new hand is added.
- The existing hidden-information, policy legality, benchmark determinism and full test suites remain green.
- A second hand exposes a one-hand human summary exactly once from the observing bot's own map; the client protocol receives no model fields and bots do not share mutable model state.
- A mature read changes gradually under a sustained reversal and confidence never reaches certainty.
- Opponent summaries cannot adjust Rookie or Novice decisions, and the OG call-threshold adjustment is capped at 0.05.

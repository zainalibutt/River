# Bot policy contract

This contract freezes the boundary for River's first bot-intelligence packet. It does not claim that the current rule policy is strong poker, and it does not authorise model training. The purpose is to make every current and future policy legal, replayable, comparable and replaceable.

## Invariants

1. The authoritative server remains the only component that may submit a bot action.
2. A policy receives no information that the acting seat could not legally know.
3. The server reduces policy output to an enabled legal action before submission.
4. The current deterministic rule policy is always available as the fallback.
5. A seeded rule policy produces the same decision envelope for the same observation, personality, tilt and policy version.
6. Skill, style, experience and tilt remain separate inputs. A display name is never a skill signal in the player protocol.
7. Decision traces stay server-side and must not contain another player's hole cards, deck order, shuffle secrets or owner-only labels.

## Version-one observation

`BotObservationV1` is a readonly value assembled from the bot's private `RoomView` at decision time.

It contains:

- `version: 1`;
- room and hand identifiers suitable for tracing but not poker reasoning;
- acting player ID and seat;
- street, acting bot hole cards and public board;
- dealer seat and derived position when available;
- pot, side-pot summaries, current bet, minimum raise target and amount to call;
- the acting stack, amount committed this street and amount committed this hand;
- public state for every seat: seat number, player ID, stack, street and hand commitments, folded, all-in and away state;
- ordered public action history for the current hand when available;
- enabled legal candidates with all exact server bounds needed to validate them;
- table size, blinds and effective stack when available;
- opponent summaries containing only legally accumulated observations and an explicit confidence/sample count;
- bounded tilt state belonging to the acting bot.

The first implementation may mark unavailable fields as absent rather than inventing them. Observation versions are additive: changing a field's meaning requires a new version.

It never contains:

- another seat's hole cards, including cards visible only to the server at showdown before the public reveal event;
- undealt cards, future board cards or deck order;
- server seed material or shuffle state;
- another bot's private opponent memory;
- hidden skill/style labels for opponents;
- conclusions such as `bluff` when cards were not revealed.

## Legal action candidates

The stable policy vocabulary is:

- `fold`;
- `check`;
- `call`;
- `raiseTo`, carrying an exact total constrained by the observation's minimum and maximum;
- `allIn`.

Later learned policies may score sizing buckets such as half-pot, three-quarter-pot and pot, but the server converts a bucket to an exact `raiseTo` value and validates it. Policies do not submit arbitrary transport commands.

## Policy interface

The engine owns pure types and the deterministic rule policy. The server owns observation construction, policy selection, tracing and final legalisation.

The version-one shape is equivalent to:

```ts
interface BotPolicyContextV1 {
  observation: BotObservationV1
  profile: BotProfile
  personality: BotPersonality
  tilt: BotTiltState
  rng: Rng
}

interface BotDecisionEnvelope {
  policyId: string
  policyVersion: number
  observationVersion: 1
  decision: BotDecision
  fallbackReason: BotFallbackReason | null
}

interface BotPolicy {
  readonly id: string
  readonly version: number
  decide(context: BotPolicyContextV1): BotDecisionEnvelope
}
```

Phase 1 may keep `BotDecisionInput` as a compatibility projection inside the deterministic policy. No future caller may bypass `BotPolicy` and call `decideBotTurn` directly from the live server.

## Skill contract

Phase 1 must make skill observably consequential without pretending to implement advanced poker:

- Rookie uses the existing coarse strength and personality thresholds, has the largest deterministic evaluation noise, and does not use opponent summaries.
- Novice uses the same legal features with lower noise and less frequent unpriced loose calls.
- OG has the lowest evaluation noise, never receives hidden information, and remains stochastic so identical public situations are not scripted.

The exact tuning remains config-driven. Phase 1's gate is separation and wiring, not proof of expert strength. Position, ranges, blockers, board texture and opponent exploitation belong to later strategy packets.

## Tilt contract

`BotTiltState` contains a clamped factor from zero to one plus an optional cause and update time. Phase 1 wires this state into the existing personality blend before profile construction.

Until event-driven tilt is implemented, the live default is zero and tests inject explicit factors. Later updates may react to public outcomes such as a revealed bad beat or a large lost pot. Tilt decays over time. `tiltResistance` limits the resulting style change; OG presets have high resistance but never absolute immunity.

Tilt may adjust aggression, tightness, bluff tendency, timing and dialogue. It may not change legal actions, observation boundaries, policy selection, persistence ownership or fallback behaviour.

## Decision trace

The server records or emits to an injected trace sink:

- room ID, hand number, actor ID and seat;
- policy ID and policy version;
- observation version;
- selected policy decision and final submitted action;
- whether legalisation changed the decision;
- fallback reason;
- a deterministic decision key or seed reference, not shuffle seed material;
- decision latency when measured outside the pure policy.

The default sink may be a no-op. A trace must be safe to retain server-side and must not be added to `RoomView`, `ServerMessage` or client logs.

## Fallback order

1. Use the selected policy when it returns a supported decision in time.
2. On policy error, timeout, invalid envelope or unsupported observation, run the deterministic rule policy once.
3. Legalise the resulting decision against the current private view.
4. If the view changed before submission, rebuild the observation and decide once more through the same policy selection path.
5. If no decision can be produced, use the safest enabled action in order: check, fold, call, all-in. Never create an invalid raise.

Phase 1 is in-process and synchronous, so timeout handling is an interface requirement rather than a new runtime timer.

## Persistent-memory boundary

Persistence is not implemented in Phase 1. Its future key is `(bot personality ID, human player ID, observation schema version)`. The named bot owns its memory; another bot cannot read it. Guests without a stable account may have session-only memory. Population priors must be anonymous and contain no private hand reconstruction.

Only public actions and publicly revealed cards update memory. Stats carry sample count, confidence and decay metadata. The policy consumes a summary, not raw cross-session hand histories.

## Evaluation gates

Phase 1 exits only when:

- the live server calls a `BotPolicy` rather than `decideBotTurn` directly;
- the observation builder is tested to include the actor's cards and exclude every other seat's cards;
- every policy result is legalised and the deterministic fallback is tested;
- seeded replay is deterministic for policy and observation version;
- Rookie, Novice and OG produce measurably distinct distributions in fixed scenario tests;
- injected tilt changes bounded tendencies, zero tilt preserves the base personality, and OG changes less than a low-resistance bot;
- traces include versions and outcomes but are not present in client protocol messages;
- existing server whole-hand, hidden-information and bot timing tests remain green;
- `npm test`, `npm run typecheck` and `npm run lint` pass by exit code.

## Phase 1 write scope

Allowed production files:

- `packages/engine/src/bots.ts`;
- `packages/engine/src/bot-personality.ts` only if a type needs extending;
- `packages/engine/src/index.ts` only if a new module is introduced;
- `apps/server/src/bot-service.ts`;
- `apps/server/src/transport.ts` only at the policy call and trace-injection seam.

Allowed tests are the beside-code tests for those files plus a new focused engine policy test if required. Table topology, UI, persistence, dialogue content, training code and strategy expansion are explicit non-goals.

## Eight-seat boundary

Eight-max is both the accepted product target and the current engine/server limit. The venue's ninth visual slot is the dealer position, not a ninth player. Phase 1 does not change table topology.

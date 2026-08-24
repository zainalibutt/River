# 12 — Multiplayer and account UX contract

Packet 3C. Written against the room protocol as actually implemented at `d6a3543` — `apps/server/src/protocol.ts`, `auth.ts`, `ledger.ts` — not against an imagined one. Codex implements from this.

Behavioural source of truth remains `docs/behaviour-reference.md`. Where this document adds flows the reference does not have (text chat, invite codes), they are River decisions recorded in `01-thesis.md`.

## Scope

Six flows Codex named as blocked: **invite, waiting, reconnecting, kicked, expired-link, account-upgrade.** Plus the identity model they all sit on.

## What already exists

| Capability | Where | Status |
|---|---|---|
| `join` / `leave` / `sit` / `stand` / `rebuy` | `RoomCommand` | implemented |
| `disconnect` / `reconnect` | `RoomCommand`, `RoomEvent` | implemented |
| `disconnected` per seat | `RoomSeatView` | implemented |
| Away auto-play | `awayPlayed` event, `AwayPolicy = 'check-or-fold'` | implemented |
| `rejected` with a message | `RoomEvent` | implemented |
| JWKS token verification | `createSupabaseTokenVerifier` | implemented |
| Append-only chip ledger | `SupabaseLedger` | implemented |

## Protocol additions required

**These do not exist and the UX below depends on them.** Named here so Codex adds them deliberately rather than improvising.

| Addition | Shape | Why |
|---|---|---|
| Invite codes | `RoomConfig.inviteCode: string`, `RoomCommand.join` gains `inviteCode?: string` | Spec commits to private invite-code tables before public matchmaking. Nothing in the protocol carries a code today |
| Kick | `RoomCommand` gains `{ kind: 'kick'; byPlayerId: string; targetPlayerId: string; reason: KickReason }`, `RoomEvent` gains `{ kind: 'kicked'; playerId: string; reason: KickReason }` | No removal path exists at all |
| Host identity | `RoomConfig.hostPlayerId: string` | Kick needs an authority. First joiner is host; host migrates on leave |
| Reconnect grace | `RoomConfig.reconnectGraceMs: number` | The UX below needs a defined window, and it must be config-driven per the standing bounds |
| Identity continuity | `RoomEvent` gains `{ kind: 'identityUpgraded'; playerId: string }` | Anonymous-to-permanent upgrade must be visible at the table without changing `playerId` |

`KickReason` is `'host' | 'idle' | 'duplicate-session'`.

## Identity model

Per `docs/spec.md`: every visitor gets an anonymous Supabase session on load. Upgrading to a permanent account links an email magic link and **keeps the same player row** — same `playerId`, same bankroll, streaks and cosmetics. No migration, no re-seat.

```text
page load
  -> anonymous session issued
  -> playerId minted, players row created by trigger
  -> guest can play immediately, zero friction

upgrade (any time, including mid-hand)
  -> magic link sent
  -> link opened, identity linked
  -> SAME playerId, SAME seat, SAME stack
  -> identityUpgraded event, quiet confirmation
```

**The upgrade must never interrupt play.** No modal, no forced reload, no seat loss. If a player upgrades while it is their turn, the turn timer continues untouched.

## Flow: invite

Private tables first; public matchmaking is later.

| State | UX |
|---|---|
| Host creates table | Invite code generated and shown large, with a copy affordance and a shareable URL containing the code |
| Guest opens invite URL | Code prefilled; guest lands directly on the waiting state |
| Guest enters code manually | Single field, case-insensitive, whitespace-trimmed. Errors inline, never a modal |
| Code invalid | `rejected` with a mapped message: `That code does not match a table.` |
| Code valid, table full | `rejected`: `That table is full.` Offer to wait as a spectator |
| Code expired | See expired-link below |

Codes are short, unambiguous and readable aloud — exclude visually confusable characters. Six characters from a 32-character alphabet omitting `0/O`, `1/I/L`.

## Flow: waiting

Between joining and the first hand. This is the state most likely to feel dead, so it carries the room.

| Element | Behaviour |
|---|---|
| Seat ring | All seats rendered. Occupied seats show name and stack; empty seats are open wells with a `SIT` affordance |
| Self | Highlighted. If standing, a persistent prompt to take a seat |
| Start condition | Two or more seated players with chips. Until then, a quiet line: `Waiting for one more player.` |
| Host control | `DEAL` becomes available to the host when the start condition is met. It is never automatic on the first hand |
| Invite affordance | Code remains visible and copyable while fewer than two players are seated |
| Chat | Available immediately. The waiting state is when a friend group actually talks |
| Camera | Orbit fully enabled. Venue is the entertainment while waiting |

Subsequent hands auto-start on the `between` countdown. Only the first deal needs the host.

## Flow: disconnect and reconnect

The protocol already models this; the UX must not treat it as an error.

| Actor | State | UX |
|---|---|---|
| Others see you | `disconnected: true` on your seat | Seat plate at 55% opacity, `RECONNECTING` tag, subtle pulse. **Cards stay in front of you.** Stack unchanged |
| Others see you, your turn | `awayPlayed` fires per `AwayPolicy` | Action resolves as check or fold, tagged `AWAY` rather than presented as a normal action |
| You, dropped | connection lost | Table stays fully rendered and readable. A single non-blocking bar across the top of the action area: `Reconnecting...`. **Never blank the table, never a modal, never a reload prompt** |
| You, restored | `reconnected` | Bar turns positive for 600ms then clears. Full `RoomView` resync. If it is your turn, the RAM activates with the remaining time |
| Grace expires | `reconnectGraceMs` elapsed | Seat is stood, chips returned to bankroll through the ledger, seat becomes an open well |

Reconnect resync must be a **full view replacement**, never an event replay. The step queue is presentation state and is discarded and rebuilt from the fresh `RoomView`.

## Flow: kicked

| Case | UX for the kicked player | UX for the table |
|---|---|---|
| `host` | Returned to the lobby with a plain line: `The host removed you from the table.` No blame, no detail | `left` treatment. A quiet notice naming who was removed |
| `idle` | `You were removed for inactivity.` Rejoin affordance available immediately if a seat is free | Same |
| `duplicate-session` | `This table is open in another window.` The **other** session is the one kicked | No table-level notice — this is a self-inflicted case and not the table's business |

A kick during a live hand folds the player's hand first, then removes them. Chips return to bankroll through the ledger. **A kick may never remove chips from the ledger's authority** — the removal is a seat operation, the chips are a ledger operation, and they are separate.

Host-initiated kick requires a hold-to-confirm, per `06-interaction.md`. It is destructive and irreversible.

## Flow: expired link

Two distinct expiries that must not be conflated.

| Expiry | Cause | UX |
|---|---|---|
| **Invite code** | Table closed, or code rotated | `That invite has expired.` with a prompt to ask the host for a new one. No retry loop |
| **Magic link** | Supabase link past its window | `That sign-in link has expired.` with a single affordance to send a fresh one. **The anonymous session is untouched** — the player is still logged in as a guest and still has their chips |

The second is the one most likely to be got wrong. An expired upgrade link is not a logout. Never destroy the anonymous session on a failed upgrade.

## Flow: account upgrade

| Step | UX |
|---|---|
| Entry point | Persistent but quiet — a `Save your progress` affordance in the menu cluster. Never a nag, never interrupting a hand |
| Email entry | Single field. This is the only place River collects anything personal |
| Link sent | `Check your email.` The player continues playing. No blocking state |
| Link opened, same device | Silent success. `identityUpgraded` fires, quiet confirmation, no reload |
| Link opened, different device | Session linked. The original device also upgrades on next resync |
| Failure | Anonymous session preserved. Error is inline and retryable |

**The bankroll never moves during an upgrade.** Same player row, same ledger history. If any implementation finds itself transferring chips between rows, the identity model has been misunderstood.

## Non-negotiables

1. **Never blank the table.** Every state in this document renders the felt, the seat ring and the venue. A player looking at the screen always sees a poker table.
2. **No modals for network states.** Disconnect, reconnect, expiry and upgrade are all inline. Modals are reserved for destructive confirmations.
3. **Chips move only through the ledger.** Seat operations and chip operations are separate authorities. Standing, kicking, disconnecting and upgrading are seat or identity events; the ledger is the only thing that moves value.
4. **Hidden information holds through every transition.** Reconnect resync, kick, stand and upgrade all go through `viewFor(playerId)`. No path may return another player's hole cards.
5. **Config-driven.** Grace windows, code length, idle thresholds and kick reasons come from config, never constants.

## Acceptance criteria

- [ ] Invite code round-trips: create, share URL, join, and join-by-typed-code
- [ ] Invalid, full and expired codes each produce their distinct mapped message
- [ ] Waiting state renders with one seated player and offers the invite code
- [ ] Host `DEAL` appears only at two-plus seated players; later hands auto-start
- [ ] Disconnect shows `RECONNECTING` to others with cards and stack intact
- [ ] Away policy resolves the disconnected player's turn and tags it `AWAY`
- [x] Reconnect performs a full view resync, not an event replay — `transport.test.ts`, three cases including a resync mid-hand
- [ ] Grace expiry stands the player and returns chips through the ledger
- [ ] All three kick reasons render their distinct copy
- [ ] Kick during a live hand folds first, then removes
- [ ] Expired magic link leaves the anonymous session and chips intact
- [ ] Upgrade preserves `playerId`, seat, stack and ledger history
- [ ] Upgrade mid-turn does not affect the turn timer
- [ ] No state in this document blanks the table or opens a modal
- [x] Adversarial test: no transition path leaks another player's `hole` — `hidden-information.test.ts`, nine cases asserting after every transition, with a vacuity check

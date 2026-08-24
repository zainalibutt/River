# 16 — Phase 4 contract: timers, fairness, economy, social

Written against the engine and server as implemented at `df14421`. Codex implements from this once 2E lands; DeepSeek owns the deterministic economy state machine.

Phase 4 is where River stops being a poker program and becomes trustable. One item in it is a genuine security defect, so it leads.

---

# 1. Fairness — the shuffle is currently predictable

## The defect

`apps/server/src/room.ts:334`

```ts
const handSeed = `${this.config.seed}|h${this.handNumber}`
this.currentCommit = commitSeed(handSeed)
new DrawPile(shuffle(makeDeck(), mulberry32(seedFromString(`${handSeed}|deck`))))
```

**Every hand in a room derives from one seed fixed at room creation.** Hand N's deck is a pure function of `roomSeed` and `N`.

Consequences:

| Issue | Severity |
|---|---|
| Anyone who learns `roomSeed` can compute **every past and future deck** in that room | critical |
| The server knows `roomSeed` before the first hand, so it knows every deck in advance | critical |
| A commit proves the server did not change its mind *after* committing. It proves nothing about *choosing* the seed | high |
| `inviteCodeFor(seed)` at `room.ts:74` derives the public invite code from the same secret | high |

The third point is the one the spec's "provably fair" claim actually rests on, and it does not hold. The current scheme is a commitment to a value the server chose freely and can grind offline before committing.

## Required construction

Per hand, not per room. Client entropy mixed in.

```text
hand N begins
  server generates serverSeed_N  <- fresh 32 bytes, per hand, never derived
  server publishes commit_N = SHA256(serverSeed_N)
  -> commit is public BEFORE any client seed is known

each seated client submits clientSeed_i  (32 bytes, client-generated)
  -> clients may change their seed between hands
  -> a client that submits nothing gets a server-supplied default, recorded as such

deck entropy = SHA256(serverSeed_N || clientSeed_1 || ... || clientSeed_k)
  -> concatenated in seat order, which is public and fixed before the deal
deck = fisherYates(makeDeck(), csprngFrom(deckEntropy))

hand ends
  server reveals serverSeed_N
  anyone recomputes SHA256(serverSeed_N) and checks it equals commit_N
  anyone recomputes the deck from the revealed seed and the public client seeds
```

The server commits before it can see the client seeds, so it cannot grind for a favourable deck. A client cannot steer the outcome either, because it does not know `serverSeed_N` when it chooses its own.

## Binding requirements

1. **`serverSeed` is fresh per hand.** Never derived from a room seed, never reused, never a counter.
2. **The invite code must not be a function of any seed.** Generate it independently.
3. **Shuffle uses a CSPRNG, not `mulberry32`.** `mulberry32` is a 32-bit-state PRNG — its entire output space is 2^32 decks, against 52! possible orderings. Seed a proper stream from the SHA-256 digest.
4. **Fisher-Yates must be modulo-bias free.** Rejection-sample the range rather than `% n`.
5. **The reveal must reach the client.** `RoomView` exposes `commit` but no seed. Add `revealedSeed: string | null`, populated only after the hand settles. This closes the gap recorded in `04-anatomy.md` — the verify panel currently cannot verify anything.
6. **Client seeds are public after the hand** and included in the verify payload.

## Verify panel

`04-anatomy.md` specifies a commit-hash pill opening a panel. It becomes functional here:

| State | Panel shows |
|---|---|
| Hand live | commit hash, your client seed, "the deck was fixed before the deal" |
| Hand settled | commit, revealed server seed, all client seats' seeds, recomputed hash, **match indicator** |
| Mismatch | loud failure. This must never happen and must be unmissable if it does |

## Acceptance

- [ ] Two hands in one room produce independent decks with no shared derivation
- [ ] Knowing hand N's revealed seed gives no information about hand N+1
- [ ] The invite code cannot be used to derive any seed
- [ ] A recorded hand can be fully recomputed from published values
- [ ] Deck distribution over 10^6 shuffles shows no positional bias
- [ ] The verify panel recomputes and matches, live, in the client

---

# 2. Timers

Per-street budgets, from the behaviour reference. Config-driven.

| Street | Budget |
|---|---|
| Pre-flop | 15s |
| Flop | 20s |
| Turn | 20s |
| River | 25s |

| Rule | Behaviour |
|---|---|
| Local presentation | RAM actionable immediately, **no countdown**. Urgency ring appears at **50% remaining** |
| Remote presentation | Timer above the active opponent's seat, world-space |
| Timeout | Automatic check if legal, otherwise fold |
| Authority | **The server owns the clock.** The client displays a deadline it is given and never runs its own |
| Animation | No animation may extend or delay a turn. Presentation never gates the state machine |
| Disconnect | Away policy takes over per `AwayPolicy`, already implemented |

`RoomView` needs `turnDeadlineMs: number | null` alongside `legal`. Gap 1 in `08-handoff-2c.md` reserved space for this; it is now due.

---

# 3. Economy

All values live in `private.economy_config`, already created in the schema with `signup_bankroll` at 100,000. Every value below joins it — **no economy number is a code constant.**

| Grant | Value | Rule |
|---|---|---|
| Signup bankroll | 100,000 | once, on account creation. Already implemented |
| Bust rescue | top up to 25,000 | when broke; capped claims per day |
| Daily login | flat grant + streak | day 7 largest, roughly 100,000. **Flat plus streak, never percentage-compounding** |

Percentage compounding was rejected in the spec: 15%/day turns 10k into ~400k in six weeks and warps every table.

## Ledger rules

The append-only `chip_ledger` is the only thing that moves value.

1. **Every grant, buy-in, rebuy, cash-out and award is a ledger row.** No balance is ever mutated directly.
2. **Writes are server-only.** `service_role` never leaves the server; RLS locks player rows.
3. **Idempotency.** Every write carries a key so a retry cannot double-grant. This is the defect class that turns a rescue grant into infinite chips.
4. **Seat operations are not chip operations.** Standing, kicking, disconnecting and upgrading are seat or identity events; only the ledger moves value. Recorded in `12-multiplayer-ux.md` and repeated because it is the rule most likely to be violated under time pressure.
5. **No purchase path exists.** Chips are unbuyable and uncashoutable. No code path may create one, decoratively or otherwise.

## Table items

Props beside each seat with three roles: visual identity, ambient interaction, and a REP boost. **Purchasable with chips** — this is the chip sink the spec wanted. They never affect poker odds.

---

# 4. Social

Four separate systems. They share a panel, not state.

| System | Behaviour |
|---|---|
| **Emotes** | 3D avatar animations, tier 3 per `07-motion.md`. Throttled. Disallowed during your own decision window by default. Poker-critical animation always interrupts |
| **Avatar VO** | Short automatic reaction vocalisations, chosen from a voice set |
| **Voice chat** | Discord, never us. A speaking indicator is the only River surface |
| **Text chat** | Typed side panel. A **River divergence** — the reference has no typed chat |

Text chat requirements:

- Shortcut keys inert while the input has focus. `F`, `C`, `R`, `A` must not fire mid-sentence
- Chat never steals focus from the RAM during your turn
- Live region announces new messages `polite`, never `assertive`
- Rate limited, same as emotes

Emote set, per Zain: wave, laugh, facepalm, fist-pump, throat-slit, chip trick, dance, confetti, table knock, plus snide and quirky voice quips.

---

# 5. REP

Separate from bankroll and from any ranked rating. They may sit near each other and must not share state.

```ts
type RepBreakdown = {
  baseRep: number
  buyInScale: number
  tableItemBonus: number
  eventBonus: number
  challengeBonus: number
  otherBonus: number
  totalRep: number
}
```

A displayed `120%` is an **earning-rate modifier**, not level progress. The UI derives it from active modifiers rather than storing it.

REP surfaces as lightweight floating feedback at end of hand. **Never a modal, never blocking the next deal.**

---

# Ownership

| Area | Owner |
|---|---|
| Fairness rework, timers, ledger integration | Codex |
| Economy state machine, grant rules, config plumbing | DeepSeek |
| Verify panel, chat and emote UX, REP presentation | Claude specifies, Codex implements |
| Security review of the fairness construction | **Codex reviews Claude's design.** The art track has had no external review and this must not repeat on something that matters this much |

# Exit

Every hand verifiable from published values, per-street pacing live, grants flowing through an idempotent ledger, chat and emotes usable at TV distance, and REP visible without hijacking the table.

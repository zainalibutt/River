# 19 — Acceptance review, Packet 4F (fairness)

Commit `d1fc23f`. Reviewed by Claude against `16-phase4-contract.md` section 1.

**Verdict: ACCEPTED.** The security defect is closed and the construction is
sound. 160 tests pass, up from 137.

## The defect is gone

`room.ts:334` previously derived every deck from one room seed fixed at room
creation, and the invite code from that same secret. Neither survives.

| Requirement | Status |
|---|---|
| `serverSeed` fresh per hand, never derived | `freshFairnessSeed(randomBytes)` per hand, `node:crypto` default |
| Commit published before any client seed is known | commit computed at 358, `phase = 'seeding'` at 359, `submitSeed` gated on that phase |
| Invite code independent of any seed | `newInviteCode(randomSource)` |
| CSPRNG, not `mulberry32` | SHA-256 counter stream, `SHA256(entropy \|\| uint32be(i))` |
| Modulo-bias free | rejection sampling — for n=52, limit 208, values 208-255 redrawn |
| Reveal reaches the client | `revealedSeed` on the view, set only after settle |
| Client seeds public after the hand | gated on `revealedSeed !== null` |
| `mulberry32` retained for solo and tests | untouched, all prior tests green |

## Two attacks that were checked and are closed

**Last-submitter grinding.** If client seeds were visible as they arrived, the
final submitter could grind their own seed against the others to steer the
deck. The view exposes `clientSeeds` only once `revealedSeed` is non-null, so
no seed is visible during collection.

**Client-forced finalization.** `finalizeSeeds` would let one player close the
window early and force everyone else to a server default. It is not in the
client message union — the client union carries `submitSeed` only, and
finalization is dispatched server-side by a timer on `seedCollectionMs`.

The unrevealed seed was traced through every reference. `pendingServerSeed` and
`currentServerSeed` never reach a view or an event; the sole wire path reads
`revealedSeed` behind the settle guard.

## Verified by test, not by reading

`fairness.test.ts` covers commit-before-seeds with an exactly reproducible hand,
independent per-hand seeds, defaulted client entropy, invite-code independence,
and **no positional bias across one million shuffles**. That last one is the
acceptance item most likely to be waved through, and it was not.

## One thing to watch — not a defect

`seedCollectionMs` defaults to 1,500ms, so every hand now opens with a seed
collection window before the deal. The window closes early once all active
seats have submitted, so in practice it costs a round trip rather than the full
1.5s. But a table where one player's client is slow pays the full delay before
every deal, and `07-motion.md` holds that presentation never gates the state
machine. This is the state machine gating itself, legitimately, for a security
property that is worth it.

Worth measuring against real latency once venues are live. If it reads as a
stall, the fix is a shorter window plus an optimistic default, not removing the
client entropy.

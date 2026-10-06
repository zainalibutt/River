# Fairness

River claims its deals are fair, so it has to let players check that claim
rather than ask them to trust it. Every hand is dealt from a deck that neither
the server nor any single player could have chosen, and every hand can be
recomputed in the browser once it is over.

## How a hand is dealt

1. **Commit.** When a hand starts, the server draws a fresh 32-byte seed and
   publishes only its SHA-256 hash. From that moment the server's seed is
   fixed: changing it would change the hash everyone has already seen.
2. **Collect.** Each seated player's client sends its own 32-byte seed during a
   short collection window. A seat that does not send one in time is given a
   server-generated seed, and the record marks it as defaulted.
3. **Combine.** The deck's entropy is the SHA-256 of the server seed followed by
   the players' seeds in seat order. No participant knows the others' seeds
   when committing their own, so none of them can steer the result.
4. **Shuffle.** A SHA-256 counter-mode stream drives a Fisher-Yates shuffle of
   the standard deck. Indices are drawn by rejection sampling, so there is no
   modulo bias.
5. **Reveal.** After the hand, the server publishes its seed and every client
   seed. The browser recomputes the commitment and the deck entropy and
   reports a match or a mismatch.

The code is short enough to read in one sitting:
[`apps/server/src/fairness.ts`](../apps/server/src/fairness.ts) builds the deck
and [`apps/web/src/lib/verify.ts`](../apps/web/src/lib/verify.ts) checks it in
the browser, independently of the server's code.

## Hidden information

The server is the only place every hole card exists. Each player's view of a
table is built per player, and only that player's own cards are sent to them
until a showdown makes others public.
[`apps/server/src/hidden-information.test.ts`](../apps/server/src/hidden-information.test.ts)
walks the room's transitions and fails if any message to one player carries
another player's cards.

## What this does not prove

- A seat with a defaulted seed relies on the server's randomness for that
  seat's contribution. The record says when that happened.
- Fair dealing does not prevent collusion between players at the same table.
- Verification shows the deck was the committed one. It does not show the
  server applied the betting rules correctly; that is what the engine's tests
  are for.

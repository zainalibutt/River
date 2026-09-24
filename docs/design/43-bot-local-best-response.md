# How exploitable the OG is: a heads-up local best response

The earlier evaluation measured the OG against opponents with fixed styles. None of them could tell how much a player who knew the OG's strategy would win from it, which is the number that matters once the OG bluffs. `apps/server/src/bot-lbr.ts` is an offline probe that answers that heads-up: it knows the focal policy but never sees its cards, and whatever it wins is a lower bound on the focal policy's exploitability. It follows the local best response method from the poker research literature, with the preflop fold-or-call simplification that method commonly uses.

## What it does

- **Range.** At the start of each hand the probe lists the focal seat's possible holdings, the cards it cannot see, and keeps a uniform sample of 220 of them. After every focal move it multiplies each holding's weight by how often the focal policy makes a move of that kind (fold, check or call, bet or raise) from that exact state with that holding, found by asking the policy itself on four seeded random streams (`bot-lbr-range.ts`). A small smoothing keeps a holding the samples happened to miss from vanishing.
- **Equity.** Its showdown share against each holding over six random boards to come, exact on the river, with the fast evaluator.
- **Choice.** Before the flop it only folds, checks or calls. After it, it also weighs a pot-sized bet or raise and an all-in. For those it rebuilds the state the focal seat would face by reopening the hand from its seed and replaying the public actions, then asks the focal policy how often each holding folds. A call is valued against the whole range, a bet against the holdings that would not fold, and every option as if both players only checked or called afterwards.
- **No peeking.** The replayed state carries the focal seat's real cards only as the frame each candidate holding is swapped into; a test replaces the focal's real cards and requires identical play, and a deliberately planted leak turns that test red.

`bot-lbr-run.ts` plays one focal policy against the probe over heads-up sessions at River's usual stack mix, with the focal seat's own opponent memory live as in any session; `bot-lbr-pool.ts` pools parallel shards, splits by position and depth, and pairs focal policies dealt the same seeds hand for hand.

## All-in valuation

Deep stacks and a probe that moves all in make single hands swing by hundreds of big blinds. `apps/server/src/bot-allin-equity.ts` values a hand whose betting closed before the river with two seats left at the focal seat's showdown share over every board still to come, counted exactly after the flop and from 4,000 sampled boards before it, instead of the board that was dealt. No decision remains once the betting closes, so on average this equals the dealt result. `runSessions` reports it as `adjustedChips` when asked (`allInAdjustment`), and throws if its reading of the pot ever disagrees with what the table paid; breaking the stake count on purpose trips that check.

## Checks

- A seat that folds whenever it faces a bet loses exactly its blinds: the probe wins +75.0 big blinds per 100 hands, with no spread.
- A seat that always calls: +2,468 (+563 to +4,373) over 400 hands, and +2,257.9 over the full run below.
- The second run below, with all-in valuation on, reproduced every one of the first run's 22,400 hands exactly.
- All-in valuation adds no bias: adjusted minus raw is −69.8 (−243.5 to +103.9) against the always-call seat, −16.2 (−121.3 to +89.0) for v4, −1.5 (−4.1 to +1.2) for v5 and +21.4 (−23.0 to +65.8) for v6, while the spread of a single hand falls by a quarter to a third wherever all-ins are common.

## Results

Fourteen shards of four 100-hand sessions on fresh `lbr-b7b-*` seeds, 5,600 hands per focal policy, every policy dealt the same cards, stacks and chairs. Big blinds per 100 hands won by the probe, with all-in valuation, session-clustered 95% intervals:

| Focal policy | Probe wins |
| --- | ---: |
| always call | +2,188.1 (+2,024.1 to +2,352.1) |
| v4 | +486.3 (+398.8 to +573.8) |
| v5 | +101.1 (+91.2 to +111.1) |
| v6 (live) | +179.9 (+139.0 to +220.8) |

Paired on the same deals, v6 gives the probe 78.8 (35.7 to 121.8) more than v5 does.

Folding every hand loses 75 big blinds per 100, so both are more exploitable than that. Against v5 the probe moved all in on the flop almost every time, expecting close to the whole of v5's range to fold, and it was right. v6 bets far more often (the probe faced a v6 bet or raise about 1,100 times, against about 30 for v5), so its pots are bigger, but it still folds too often to large bets: the probe expected it to fold 71% of the time to a pot-sized flop bet and 87% to a flop shove. A pot-sized bet only has to work half the time, so at those frequencies every hand the probe held could bet profitably.

## Under the standard heads-up order

The results above were taken while River's engine had the big blind act first before the flop heads-up; `776fd91` gave that turn to the button, as standard rules do. Measured again the same way on fresh `lbr-std-*` seeds, all-in valued:

| Focal policy | Probe wins |
| --- | ---: |
| always fold | +75.0, no spread |
| v5 | +101.0 (+85.0 to +117.1) |
| v6 (live) | +215.9 (+165.3 to +266.6) |

v6 gives the probe 114.9 (67.7 to 162.2) more than v5 on the same deals, and the leak is the same one: an expected 71% of folds to a pot-sized flop bet and 87% to a flop shove. v6 still beats v5 on every heads-up held-out table under the standard order, on fresh `hu-std-*` seeds with 200 sessions each: pooled +96.7 (+88.5 to +104.8), the smallest margin +30.6 (+15.4 to +45.8) against the ordinary cast.

## Limits

- A lower bound only. The probe bets one size and an all-in, never raises before the flop, samples 220 holdings and values everything as if play went check-and-call afterwards; a full best response would win more.
- Heads-up only, at River's stack mix of 40 to 400 big blinds, so the numbers are not comparable with published figures at 200 big blinds.
- Doc 41's learned model is not measured and is shelved: it was built on v5, and at about 25 ms a decision the probe's questions put it near 39 seconds a hand.

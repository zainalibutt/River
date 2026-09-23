# Bot poker scenario gates

The executable starting corpus is `apps/server/src/bot-scenarios.test.ts`. It supplies ten fixed nine-seat situations to the same server action path that live bots use. The actor sees only its own cards. Every scenario runs 32 fixed random seeds for Rookie, Novice and OG. The fixtures test decisions at one point in a hand; they are not complete recorded hands or a substitute for the seeded whole-hand benchmark.

## Gates that pass now

- Every returned action is enabled, and a raise stays within the server's minimum and the actor's stack.
- Card fixtures contain no duplicate cards.
- In 64 fixed seeds, OG never folds pocket aces before the flop and bets the ace-high nut flush on the river at least half the time.
- OG calls the cheap turn flush draw and folds the expensive one in 64 fixed seeds. This uses the direct call price and nine clean flush outs with one card to come.
- On the paired-board version of that cheap turn draw, OG no longer applies the nine-clean-outs shortcut; its call frequency falls in the fixed sample.
- In 200 fixed seeds, OG continues with jack-nine suited on the button at least 15 percentage points more often than from early position.
- With the same marginal two-pair hand and price, OG folds more often after the public record shows the same opponent making large bets on successive streets. A set still never folds in the 64-seed strong-hand check.

These are safety and basic hand-recognition checks. They do not establish that OG is an expert poker player.

## Strategy gates for the next rule-policy packet

The table below mixes passing rules with remaining desired directions. Percentages are proposed thresholds over at least 200 fixed seeds with one fixed, neutral personality per skill. Use the exact fixture data in the executable corpus, then revise a threshold only after reviewing the poker context and recorded decisions. Check legal action and hidden-information boundaries for every future policy as well.

| Scenario | What a player sees | Proposed OG gate |
| --- | --- | --- |
| `premium_aces_preflop` | Pocket aces, nine players, unopened beyond the big blind | Continue every time; raise or go all-in at least 75% of seeds. |
| `seven_deuce_facing_raise` | Seven-deuce offsuit, early position, facing a raise to 3,000 into a 4,500 pot | Fold at least 85% of seeds. Occasional bluffing is permitted. |
| `cheap_turn_flush_draw` | Ace-high spade draw with one card to come; 300 to call into a 3,300 pot | Passes now: call in the fixed OG sample when the nine spade outs are treated as clean. |
| `expensive_turn_flush_draw` | Same cards, 6,000 to call into a 9,000 pot | Passes now: fold in the fixed OG sample without a specific opponent read or sufficient future payout. |
| `paired_board_turn_flush_draw` | Same cheap draw and call price, but the public board contains a pair | Passes now: lower call frequency than the unpaired version. A pair can make flush outs unsafe against a full house. |
| `nut_flush_river` | Ace-high flush, no bet to call | Never fold; make a value bet or raise at least 70% of seeds. Checking sometimes remains legitimate. |
| `king_high_flush_river` | King-high flush, facing 1,500 into a 4,500 pot | Continue at least 85% of seeds; the possible ace-high flush alone is not a reason to panic-fold. |
| `missed_draw_river` | Missed spade draw with ace high, facing 3,000 into a 6,000 pot | Usually fold without a read that the opponent bluffs often; target at least 70% folds. |
| `marginal_open_early` and `marginal_open_button` | Same jack-nine suited hand, with only dealer position changed | Passes now: continue on the button at least 15 percentage points more often than early position. |
| focused sustained-pressure fixture | Same two-pair river decision and price, with and without one opponent betting at least 65% of the prior pot on successive streets | Passes now: the public history increases OG's fold frequency, while a set still continues. This is bounded uncertainty, not a claim about hidden cards. |

The turn draw has nine nominal spade outs among 46 unseen cards, about 19.6% to hit on the river. In the cheap case, the immediate call price is 300 / (3,300 + 300), about 8.3%. In the expensive case it is 6,000 / (9,000 + 6,000), 40%. Those numbers assume clean outs and do not include future betting, opponent ranges or reverse implied odds. A strong policy should reason about those missing factors; the fixture deliberately starts with no opponent history.

`nut flush` means the best possible flush given the public cards. `Button` is the dealer position and usually acts late after the flop. `Air` means a hand without a made pair or better, though ace high can still win against a bluff. A `calling station` is a player who calls too often; a `nit` plays unusually tight. These terms help describe behaviour, but names and table chat should not reveal the hidden owner-only skill label.

## How to use the gates

1. Run the scenario corpus after every poker-policy change. New policies must pass the current safety gates.
2. Record action frequencies per scenario, skill and policy version. Do not turn the proposed strategy thresholds green based on a few hand examples.
3. Compare a candidate against the deterministic baseline with `runPairedBotBenchmark` across rotating chairs and many seeds. Its 95% interval is a normal approximation; hands from the same strategic environment may still be correlated. Review the hand traces when a number looks surprising.
4. Add confidence-weighted cross-hand opponent reads before treating bluff-catching or exploitation as expert-quality gates. The current fixture contains only public actions from one hand.

Poker references used for the scenario assumptions: [pot odds and draw equity](https://www.pokerstars.com/poker/learn/lesson/pot-odds/), [position](https://www.pokerstars.com/poker/learn/strategies/what-is-positional-awareness-and-how-to-master-it/), [hand rankings and the nut flush](https://www.pokerstars.com/poker/learn/lesson/poker-hand-rankings/), and [starting hands](https://www.pokerstars.com/poker/learn/lesson/poker-starting-hands/).

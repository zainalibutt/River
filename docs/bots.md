# The bots

River fills empty seats with bots so that a friend group can always get a game. They have ordinary names, and nothing on the table says which of them is strong. This is how they went from rule-of-thumb players to a bot that solves the river and is measured against a perfect counter-strategy and an outside benchmark, with the parts that did not work left in.

It covers two phases. The rule bots arrived in August, followed by a safety contract around them, scenario gates and a set of forecasting experiments, which landed on 24 September. From that day the work turned to measuring whole games and to machine learning. Every number below comes from a recorded run.

---

## The short version

```mermaid
flowchart LR
    A["Rule bots<br/>23–26 Aug"] --> B["Safety contract<br/>and gates"]
    B --> C["Forecasting<br/>experiments"]
    C --> D["Handover<br/>24 Sep"]
    D --> E["v5<br/>stops spewing"]
    E --> F["v6<br/>equity and bluffs"]
    F --> G["Shark test<br/>finds a leak"]
    G --> H["v7<br/>tried, rejected"]
    H --> I["v8z<br/>solves the river,<br/>reads on top"]
    I --> J["Next: value<br/>networks"]
```

| Version | What changed | What it measured |
| --- | --- | --- |
| v4, inherited | Rule-based OG | Lost to every test style heads-up, by 76 to 101 big blinds per 100 hands |
| v5 | No bluff-raising with any two cards; a proper preflop ranking | +122.3 over v4 |
| v6, live | Hands judged by equity against the ranges opponents' actions suggest; balanced heads-up bluffing | +127.0 over v5 |
| v6 under the shark | A player who knows exactly how the bot plays | Gives up 215.9 per 100 hands heads-up |
| v6 against Slumbot | A strong public heads-up bot | −27.5 over 5,000 hands (−70.4 to +15.3) |
| v7 | Defend against big bets | Rejected twice: no less exploitable |
| v8z, passed 29 Sep | Solves every two-player river from both players' ranges, and bends the solution towards what each opponent does | +24.5 over v6 across twelve fresh tables; the shark wins 45.2 less |

Big blinds per 100 hands (bb/100) is the usual poker win rate. +100 means winning a big blind a hand.

---

## What a bot is

A bot is a policy the server asks for a move whenever a bot seat is to act. The policy sees what a player in that seat could legally know: its own two cards, the board, the pot, the stacks, the moves made so far this hand, and statistics about opponents built only from what the table has shown. It never sees another player's cards or the cards still to come.

```mermaid
flowchart TD
    R["Room on the server<br/>owns every chip"] -->|"what this seat may know"| O["Observation"]
    P["Personality<br/>skill, style, experience, tilt"] --> D
    O --> D["Policy<br/>rules, then equity after the flop"]
    D --> G["Poker guard<br/>blocks obvious blunders"]
    G --> L["Legaliser<br/>turns the decision into a legal move"]
    L --> R
    D -. "error or invalid output" .-> F["Deterministic fallback"]
    F --> L
```

Four rules have held since the first contract: only the server submits a bot's move; a policy gets nothing its seat could not legally know; the server reduces every decision to a legal move; and a deterministic rule policy is always there as a fallback.

Characters differ along separate axes. Skill comes in three tiers: rookie, novice and OG, the strongest. Style decides how loose or aggressive a character is, experience how well it plays its style, and tilt is a bounded swing after bad beats. A table can be Casual, Mixed, Tough or Random, and Random is the default.

---

## Part one: rules, a contract and a forecasting experiment

### Rule bots

The first bots arrived with the solo session on 23 August. They were checklist players: how strong is my hand, what is the price, what does my personality say. Personalities and tilt followed on 24 August, bots taking empty seats on 26 August, then table talk and pacing, so that a bot takes longer over a hard decision than an easy one.

### The contract and the gates

Before anyone tried to make the bots stronger, the boundary was fixed in writing: the policy contract, a corpus of fixed scenarios every policy must pass, a public record of the current hand's moves, and an opponent-memory contract saying what a bot may remember about a person and how that memory decays. The scenarios are concrete: an OG never folds pocket aces before the flop, and it bets the nut flush on the river at least half the time.

### Forecasting what a player will do

The first machine-learning track did not try to play poker. It tried to predict a player's next move: fold, check, call or raise, from the public state just before it. That is a four-class classifier over twenty public features, trained with plain gradient descent and tested on hands it never saw.

| Model, on held-out simulated players | Accuracy | Log loss, lower is better |
| --- | ---: | ---: |
| Learned | 75.06% | 0.5602 |
| Statistical baseline | 70.24% | 0.5672 |

Later versions added each player's own history, tried blending in live per-player rates, which made things worse, broadened the training cast and regressed on ordinary players, then switched models per player only when the evidence supported it. A server-side seam can watch real play, but it is off by default and was never pointed at real people.

The forecasts never chose a bot's move. The track's most useful output was its honesty: several negative results, recorded as such.

### Playing better, and the lesson of the river

The play-quality pass found real errors. The preflop score gave pairs such a large bonus that a small pair could outrank ace-king suited. A flush-draw shortcut treated some made hands as mere draws.

It also produced the deepest lesson of the first phase. A candidate that computed exact river equity against each opponent's starting range changed three folds into calls over 2,400 held-out hands, and all three lost. The document says why: **equity against someone's starting range is not equity after they have chosen to bet this river.** A bet changes the range. Everything in part two works around that sentence.

---

## Starting part two

On 24 September the bot work restarted from a clear brief: a convincing nine-seat table with optional bots, the default strength random and the names ordinary. Skill, style, experience and tilt were to stay separate. The OG should be very strong using only legal public information, every bot move should be checked by the server, and bots should adapt to what players show without jumping to confident wrong reads. "Learning during play" was defined narrowly: small, confidence-weighted statistics about opponents, not a network retraining itself mid-game.

The build was red when this phase started. The last commit depended on a file that had never been committed, so continuous integration failed on the main branch. The first commit of the new phase added it.

---

## Part two: measuring whole games

### An instrument first

A single hand of poker says almost nothing. A good decision loses often and a bad one wins often. So the first pass built an instrument before touching the bot.

- **Paired sessions.** The old and new versions play the same cards from the same seats with the same stacks, so luck mostly cancels, as in duplicate bridge.
- **Real conditions.** Stacks from 40 to 400 big blinds, chairs rotating, several OG characters, whole sessions of 60 to 100 hands.
- **Honest error bars.** Hands within a session are not independent, so the intervals are clustered by session.
- **Held-out opponents.** Five synthetic styles the bot is never tuned against (value, balanced, overbluff, camouflaged and reverse-sizing) plus River's ordinary cast.

The instrument had to prove it could see something before it measured anything. A version against itself reads zero. A planted leak, folding premium hands to any bet, moved the result by −185.6 bb/100 (−241.8 to −129.4).

The first real measurement was sobering. The live OG lost to every held-out style heads-up:

| Heads-up, the inherited OG | bb/100 | 95% interval |
| --- | ---: | ---: |
| value | −80.3 | −98.5 to −62.1 |
| balanced | −101.0 | −121.9 to −80.0 |
| overbluff | −86.4 | −114.7 to −58.1 |
| camouflaged | −75.8 | −97.8 to −53.8 |
| reverse-sizing | −86.0 | −109.5 to −62.4 |
| ordinary cast | −13.9 | −30.5 to +2.7 |

Premium starting hands won. Weak hands, three quarters of all deals, lost heavily.

Every change since has gone through the same path:

```mermaid
flowchart LR
    L["Find a leak"] --> F["Write the fix<br/>as a poker idea"]
    F --> S["Scenario tests<br/>specific hands"]
    S --> D["Development runs<br/>tuning allowed"]
    D --> G["Write the pass mark<br/>before looking"]
    G --> C["Confirm on<br/>fresh cards"]
    C -->|pass| V["Becomes the live version"]
    C -->|fail| X["Recorded and dropped"]
```

The pass mark is written down before any fresh cards are dealt. It is too easy to move the goalposts after seeing a result otherwise.

### Version 5: stop spewing

The inherited OG would raise as a bluff with any two cards when facing a bet, and ranked starting hands badly. Each fix was measured on its own before being bundled:

| Change, against v4 | bb/100 | Kept? |
| --- | ---: | --- |
| No bluff-raise with any two cards | +64.7 (+52.3 to +77.1) | yes |
| Ranked preflop score | +48.2 (+29.1 to +67.3) | yes |
| Bluff-raise only with a draw or a playable hand | −19.4 (−28.4 to −10.4) | no |
| Bluff when checked to heads-up | +1.1 (0.0 to +2.2) | no |

On fresh cards the bundle beat v4 by **+122.3 bb/100 (+102.9 to +141.6)** pooled over twelve tables. The any-two-cards raise was not worthless everywhere. It won chips from players who fold too much and lost far more to aggressive ones.

v5 overcorrected, though. It never bluffed, and it judged a made hand so crudely that it folded top pair to a half-pot bet three times in four.

### Reads, and memory across sessions

Reads are the bot's equivalent of a heads-up display: counts of what each opponent does, with a confidence interval, so three hands of data cannot convince it of anything. Against a pressure player, bluff-catching on the read was worth +61.4. Over all twelve tables the read did not clear its pooled pass mark (the lower bound came out at −0.006), because one session rarely gives enough evidence.

Letting the memory carry across sessions, as a regular meets the same people on different days, fixed that. Over chains of six meetings the reads paid on fresh cards: **+6.9 (+4.4 to +9.5)** pooled. Storing that memory in the database went live on 25 September, once I had approved the production change.

### A first learned model

The first model that chooses moves replayed decisions from simulated sessions, tried each option many times from the same spot, and learned which was worth most. It is a small neural network, 22 inputs and one hidden layer, trained on those simulated outcomes. It beat v5 by +44.4 (+36.0 to +52.8) on fresh cards and cleared its pass mark.

It was then shelved. It improved on v5, which v6 replaced before anyone decided to wire it in, and at about 25 ms a decision it was too slow to test against the shark below.

### Version 6: think in equity

v6 changes only what an OG does after the flop. It asks: given what this player's betting says they hold, what is my share of this pot? It bets for value when ahead, calls when the price is right, and bluffs heads-up at close to the rate that makes a call break even. A character's bluffing tendency tilts that rate within bounds, so characters differ without any of them spewing. A new hand evaluator made the equity maths 25 to 30 times faster with identical results.

Scenario tests caught two bugs before the run that mattered. At a full table a value threshold had crept above certainty, so the nut flush never bet the river. A semi-bluff raise ignored its price. On fresh cards v6 beat v5 by **+127.0 bb/100 (+117.2 to +136.7)** pooled, and every one of the twelve tables stayed above zero.

### Can it be exploited?

Beating fixed styles is not the same as being hard to beat. None of the test styles adapts, and none bets big with nothing. So the next pass built opponents that learn.

The first was a *value detector*: once a bettor's shown river bets have all been strong, it folds everything but strong hands to that player and bets into their checks. It cost v5, which never bluffs, −53.7 bb/100 and cost v6 only −11.8. Balanced bluffing was working.

The second was **the shark**, a local best response. It knows the OG's strategy exactly but never sees its cards. It tracks what the OG could be holding by asking, for every possible hand, "would the OG have made the move it just made with this?" Then it picks fold, call, a pot-sized bet or all-in by expected chips. Whatever it wins is a floor on how exploitable the OG is. It passed its known cases first: against a seat that always folds it wins exactly the blinds, 75.0 per 100 hands, and against a seat that always calls it wins over 2,000.

| Heads-up, what the shark wins | bb/100 | |
| --- | ---: | --- |
| v4 | 486.3 | `████████████████████` |
| v6 | 215.9 | `█████████` |
| v5 | 101.0 | `████` |
| a seat that folds every hand | 75.0 | `███` |
| a perfect strategy | 0 | |

v4's figure was taken before the rules fix described below. The rest were measured under standard rules, 5,600 hands each on the same deals, with each all-in valued at its equity.

The shark found v6's hole at once. Asking v6's strategy about every hand it could hold, the shark reckoned it folds about 71% of the time to a pot-sized bet on the flop and 87% to a flop shove. A pot-sized bet only has to work half the time, so the shark bets every hand. v6 is still far better than v5 against normal players, but v5 folded so early it rarely had chips in the pot to lose.

Two tools came out of this pass. The first is **all-in valuation**: when both players are all in before the river, the result is credited at each player's equity instead of the cards that fell. That removes the luck of the run-out without changing the average, and cuts the noise of a single hand by a quarter to a third. The second is a heads-up rules bug, below.

### Two bugs in the rules

The shark's tallies were odd. In every hand where it was the big blind, its first decision before the flop was whether to check, with nothing yet to call: the big blind was acting before the button. River's engine had the big blind act first before the flop whenever exactly two players were dealt in. In standard heads-up poker the button posts the small blind and acts first before the flop. An engine test from the earliest phase had pinned the wrong order in place.

After review the order was fixed, the tests rewritten to check the same rules the standard way, and the spec now states it. Old hand records still replay, because replay walks the recorded moves in order. Everything heads-up was measured again, and v6 still beat v5 on every heads-up table: **+96.7 (+88.5 to +104.8)** pooled.

The Slumbot matches below found the second. When a player went all in for less than a full raise, River handed the extra chips back instead of asking the players who had already acted to call them or fold. Standard rules make them match it, though they may not re-raise. River's replay of one Slumbot hand ended at our short all-in, before Slumbot's call. An early engine test had pinned this too. After review it was fixed the standard way, and the spec states the rule. The simulated runs in this document were taken before this fix, with stacks from 40 to 400 big blinds, where a short all-in can happen, and they have not been repeated.

### Version 7: tried twice, rejected

The obvious fix for v6's leak is to call more against big bets. I chose "hard to exploit first": give up some chips against players who never bluff, in exchange for a bot that cannot be run over.

- **Round one** assumed the bettor bluffs at the balanced rate, which is the pot odds on offer, so any hand that beats a bluff became a call. Against the test styles that won +21.2 bb/100. Against the shark it was a disaster: the shark stopped bluffing and value-bet into it, and won 448.0 instead of 184.0 on the same deals.
- **Round two** called with pure bluff-catchers only at the minimum defence frequency for the bet size, half the time against a pot bet and a quarter against a shove three times the pot. The shark won 207.1 against v6's 184.0, no better, and v7 did worse than v6 against one of the development styles.

The right amount to defend depends on the bot's whole range at that moment: how many bluff-catchers it holds compared with strong hands and air. A rule that looks at one hand at a time cannot know that. It is the same wall the first phase hit on the river, from the other side, and it is why the next step is a solver. v7 is kept on a side branch and never went live.

### Against Slumbot

The shark is our own instrument. For an outside yardstick, the live OG now plays [Slumbot](https://slumbot.com), a well-known heads-up bot with a public API, at 200 big blinds deep. Each of our decisions rebuilds the hand at a River table with our real cards and the revealed board, so the OG decides exactly as it would in a River room. Only our own moves are sent. Every logged hand is replayed afterwards with both players' real cards, and River must pay out the same chips Slumbot did.

Over 5,000 hands v6 lost **27.5 bb/100 (−70.4 to +15.3)**, or **37.5 (−76.0 to +1.1)** with the ten all-ins before the river valued at their equity. River paid out exactly what Slumbot did on all 5,000 hands. So v6 most likely loses to Slumbot, by somewhere between nothing and three quarters of a big blind a hand, and more hands would narrow that. Slumbot plays its own fixed strategy rather than hunting for a leak, which is why it wins far less than the shark does.

---

## Part three: solving the river

### A solver, checked on a toy game first

A solver finds a balanced strategy by playing a game against itself. After each pass, every decision asks how much better each of its other options would have done, and leans towards the ones it regrets not choosing. Averaged over many passes, those regrets settle into a strategy that cannot be exploited. That is counterfactual regret minimisation, the method behind the research bots that beat professional players.

River's solver was proved first on Kuhn poker, a three-card game small enough to have a known answer, and it reached that answer. Then on the river: given two ranges, it solves for every holding at once, and on a spot with a textbook answer it bluffs exactly as often as the pot odds allow and calls exactly as often as the minimum defence frequency says. The open-source postflop solvers carry licences River cannot use, so it is River's own.

### The river, from the hand so far

At a river with two players left, the OG rebuilds the hand from the public moves and asks, for every pair of cards each player could hold, how likely they were to have played the hand this way. The answer comes from v6, used as a *blueprint*: how often would v6, with this character's personality, have made each of these moves with these cards? Then it solves that river on the spot, with bets of half the pot, the pot and all-in and up to two raises, and plays its own row of the solution. Before the river nothing changes: it plays v6.

The first version, v8, cut what the shark wins from 192.5 to 134.6 bb/100 on the same 5,600 hands, a gain of **58.0 (26.5 to 89.4)**. Most of it was the answer to river shoves: v6 called too often against a player who shoves for value.

### Harder to exploit, worse against the tables

The next version met the development tables and lost, by 285.9 bb/100 more than v6 against the pressure style alone. The pressure style raises three quarters of the pot whenever it can, whatever it holds. The solver had assumed its opponent played like v6, so after four streets of raises it gave that player only monsters, and folded two pair and flushes that v6 would call.

Two repairs fell short. Keeping a share of every opponent's range *card-blind*, allowing that anyone might be betting anything, fixed the range but not the result, because v6 did not just call these players down; it exploited them. Handing the extreme spots back to v6 evened the tables and gave away the entire gain against the shark. I kept the standard I had set: win at the tables and be harder to exploit. That needed reads.

### Reads on top

The engine now keeps, for every player, the statistics a regular would track: how often they bet a river when checked to, how often they fold or raise when bet into, and what they showed down after betting big. From those the OG builds a model of each opponent's river play. The solver then plays against the model with a trust that grows with the evidence, and leaves the rest of that opponent free to play perfectly. This is a *restricted Nash response*: exploit what the reads say, but never so far that a wrong read can be punished hard.

Three rounds on the development tables sharpened it. The first reads built too slowly: against the pressure player the OG lost the first 60 hands of each session and won the rest, so evidence now counts sooner. The last loss was the pot-odds chaser, who folds to any bet whose price passes a threshold, whatever it holds. A fold rate blind to bet size could not see that bigger bets win against that player, so the OG now reads how often each player folds to small, medium and large bets separately. On the same deals, that table's −13.9 became +6.5.

### The exam

With the development tables clean (+250.3 pooled, no table clearly lost), the pass mark was written down and fresh cards were dealt: twelve tables at 200 sessions each, and the shark on new deals.

| v8z against v6, fresh cards | bb/100 |
| --- | ---: |
| Pooled over twelve tables | **+24.5 (+18.4 to +30.6)** |
| Best table: heads-up, River's ordinary cast | +74.9 (+51.5 to +98.2) |
| Closest: heads-up value and reverse-sizing | +3.0 each, intervals across zero |
| Tables entirely below zero | none |
| What the shark wins from v6, and from v8z | 184.7, and 139.5 |
| How much less the shark wins from v8z | **45.2 (16.0 to 74.4)** |

All three conditions held. The shark's figure for v6 differs from the 215.9 above because every set of deals differs; versions are only ever compared on the same deals.

### Making it fit

A solver that thinks for twenty seconds cannot sit at a table. Four changes made it fast without changing a decision, each proven by replaying stored hands exactly: a memo for repeated equity questions, a solver compiled once per spot into reusable memory, lookup tables for the cards, and runs split into pieces that join exactly. A river decision now takes about two and a half seconds on one core. In a live room the solver runs on its own thread, so the table never waits for it: if it is late, the bot plays v6's move.

Memory caught up with it during the exam. Each cached solution kept a separate small array for every holding at every decision, ten workers at the ordinary table each grew past a gigabyte, and the machine running the confirmation ran out of memory and had to be restarted. Finished work survived, the run resumed, and solutions now keep one table per decision: the same numbers bit for bit, in well under half the memory.

---

## Decisions

| When | Decision | Why |
| --- | --- | --- |
| 24 Sep | Opponent memory in the database stays off until a production change is approved | Storing reads about real people is a product and privacy decision, not a bot tweak |
| 24 Sep | Hidden cards, future cards and outcome labels never reach a policy | A bot that peeks is worthless, and would pass every test that cannot see peeking |
| 24 Sep | Remember opponents across sessions, consolidated nightly | Bots can meet the same people dozens of times, and one session is too little evidence |
| 24 Sep | The OG aims to get as close to solver strength as possible | River is meant to feel like a real game against strong opponents |
| 24 Sep | A balanced bluffing base, tilted by personality | Characters should differ without any of them spewing chips |
| 24 Sep | Train offline in Python and PyTorch; the live server stays TypeScript | Training wants the Python ecosystem; the game server must stay one simple, typed codebase |
| 24 Sep | Benchmark against outside bots offline, sending only our own moves | An outside yardstick without sending anyone else's data |
| 24 Sep | Fix the heads-up betting order | Standard rules first; every heads-up number after it was re-measured |
| 25 Sep | Fix the short all-in rule | Standard rules again; found by replaying Slumbot hands at a River table |
| 24 Sep | Shelve the first learned model | Built on a version already replaced |
| 24 Sep | Hard to exploit before maximum profit | Close to solver strength was the stated target |
| 25 Sep | Reject v7 | Neither variant made the bot harder to exploit |
| 25 Sep | Store opponent memory in the database | Production change approved; it has been on since |
| 25 Sep | Write River's own solver | The open-source postflop solvers carry licences River cannot use |
| 26 Sep | Keep both standards: win at the tables and be harder to exploit | Handing big spots back to v6 fixed the tables but lost the whole gain against the shark |
| 27 Sep | Read fold rates by bet size before the exam | The last loss came from a player whose folding depends on the price |
| 29 Sep | v8z passes; switching it on waits for approval | Going live changes what real players meet |
| 29 Sep | v8z goes live with playriver.uk, and the champion sits at every bot table | Approved as part of the launch |

---

## Hold-ups and wrong turns

- **A red build at the restart.** A committed module imported a file that was never committed. It was the first thing fixed.
- **Test styles too tight heads-up.** The first synthetic opponents folded too much when only two were dealt in. Their preflop thresholds were re-derived from the share of hands each style should play.
- **An evaluator too slow to use.** Equity over thousands of simulated boards took too long with the reference hand evaluator. A bitmask evaluator with identical ordering made it 25 to 30 times faster.
- **Pass marks set too tight.** An early confirmation failed on interval width rather than a real loss. Every pass now declares its follow-up run in advance, for a table that is positive but not yet clear.
- **Two bugs caught by scenario tests before they cost a run:** the nut flush that never bet the river at a full table, and a semi-bluff raise that ignored its price.
- **A three-hour wait for a twenty-minute run.** One policy under test cost thirty times more per decision than the others, and the whole batch waited on it. Every policy is now timed on ten hands before a batch starts, and the most important one runs first.
- **Two rules bugs,** above: the heads-up betting order and the short all-in. Both had been wrong since the first engine and pinned by its own tests.
- **A stale build.** The first test run after the short all-in fix failed 115 tests: the server tests use the built engine package, which had not been rebuilt. The rebuild now goes with every engine change.
- **A crash half an hour in.** The first Slumbot run stopped at hand 1,447 when Slumbot refused a bet. Going all in against an all-in only calls it, and the adapter had sent it as a bet. It now sends a call, and a failing hand is logged and skipped instead of ending the run.
- **v7,** above. Two rounds, both rejected.
- **Styles that ignore their cards.** The first river solver assumed every opponent played like v6, and against styles that bet whatever they hold it folded two pair and flushes. A card-blind share and reads fixed it; handing those spots back to v6 did not.
- **Reads that learned too slowly, and fold rates blind to bet size,** above. Each cost one more round on the development tables, and neither touched the fresh cards.
- **A machine out of memory.** Ten solver workers each grew past a gigabyte, and the development machine had to be restarted hours into the confirmation. The run resumed with its finished pieces, and stored solutions now take well under half the memory with identical numbers.

---

## Where it stands

- The live OG is v8z, since the launch on 29 September: v6 up to the river, and the river solved with reads on top. v6 is 127 bb/100 better than v5 across the twelve test tables, and v5 was 122 better than the version that lost to every style. It does not bluff into two or more opponents.
- v8z passed its confirmation on 29 September: +24.5 bb/100 over v6 across twelve fresh tables, and the shark wins 45.2 less from it. It went live with the launch the same day, behind a switch, with the solver on its own thread, and the champion plays it at every bot table.
- A player who knows exactly how it plays can still take about 1.4 big blinds a hand from v8z heads-up, against about 1.85 from v6 on the same deals, mostly by betting big on the flop and turn, which v8z still plays by v6's rules. Folding every hand would lose 0.75.
- Against Slumbot, an outside heads-up bot, v6 most likely loses a little, between nothing and three quarters of a big blind a hand over 5,000 hands: -27.5 bb/100 (-70.4 to +15.3).
- v8z played Slumbot on 30 September, 5,000 hands at a time, with every payout matching Slumbot's. Across the OG cast without reads it came to -10.7 bb/100 (-58.2 to +36.7), close to even and ahead of v6, though the ranges overlap. The champion with her reads came to -58.3 (-109.2 to -7.5), about -43 once all-ins before the river are valued at their odds, and almost all of it in the big blind, after calling rather than by folding. Reads that bend play towards an opponent's habits may cost something against an opponent with none to exploit; that is the next thing to measure.
- Her reads were then priced on the same deals: the champion with her memory of opponents against the same champion without it, heads-up. Across the six heads-up tables the memory earned 81.5 bb/100 (62.6 to 100.5), ahead on every table, and the shark won 8.9 less from her with it (-24.1 to +6.4), so the reads stay. Without them she did no better against Slumbot, -64.6 (-107.7 to -21.5) over another 5,000 hands, so the reads are not why she loses to it.
- Heads-up, her button folded 28% of hands on its first move, because the rules priced the rest of the big blind like any other bet. Two wider buttons, folding 14.5% and 8.7%, were measured against it on the same deals on 30 September. The heads-up tables liked them, +8.0 (0.2 to 15.7) and +13.7 (4.2 to 23.1) bb/100, but the shark won clearly more from both, +24.6 (0.7 to 48.5) and +47.6 (18.0 to 77.1) with all-ins valued, by betting into the flops the extra hands reach, where she folds too often. The button stays as it is until the flop is solved.
- The bots' memory of opponents has been stored in the database since 25 September. The statistics v8z reads from are kept in memory only, waiting on a production decision.
- All of this is measured against simulated opponents. Real people will differ, and the shark's figure is a floor, since a smarter shark would win more.

## What comes next

- **v8z in production.** Watch its think time and memory on the production server.
- **Value networks.** No bot can solve a whole hand while it is being played. A neural network trained in PyTorch on a GPU learns, from millions of solved spots, what any spot is worth, so the live bot can solve the flop and turn as well, where the shark now wins most. A wider heads-up button waits on it. DeepStack, one of the research bots that beat professional players, combined a solver with networks like these.
- **More seats.** Preflop play for two to nine players, then pots with three or more players, where even the best bots rely on approximations.
- **Outside results.** More hands against Slumbot to narrow the interval, and other public benchmarks where their terms allow.

---

## If you know supervised learning

The closest thing to this in my own work is [an age-group classifier](https://github.com/zainalibutt/age-group-detection): four age groups, three pipelines, from HOG features with an SVM up to a ResNet18 fine-tuned in PyTorch. The same ideas carry over, with one big difference.

| | Age-group classifier | River's bots |
| --- | --- | --- |
| The question | Which age group is this face? | Which move is best here? |
| Labels | Every training image has the right answer | Nobody knows the right move; its value shows only through play, against a particular opponent |
| Hand-made features | HOG gradients | Pot odds, position, equity against a range |
| A classic model on those features | SVM, MLP | The rule policy (hand-written) and the first learned model (a small MLP on 22 features) |
| A deep model | ResNet18 in PyTorch | Value networks, next |
| Train, validation, test | Split images | Development seeds for tuning, fresh seeds for the confirmation run |
| Leakage | Test images seen in training | Hidden cards reaching a policy; a test proves the shark cannot peek |
| Overfitting | Tuning until the validation set looks good | Tuning until the test styles look good; hence the pass mark written before fresh cards |
| The trade-off | ResNet18 gains 6 points of accuracy for about 1,000 times the inference time | The first learned model was too slow to evaluate; a bot has a time budget per decision |
| The score | Accuracy and F1 | bb/100 with an interval, and what the shark wins |

The forecasting experiments in part one are the most like the age-group project: a classifier with four classes, trained on labelled examples. Playing well is different, because the label is the thing being searched for. That is why the plan moves from supervised learning towards self-play.

---

## Words used here

- **bb/100**: big blinds won per 100 hands.
- **Equity**: your share of the pot if the hand were played out from here.
- **Range**: the set of hands a player could hold, given what they have done.
- **Bluff-catcher**: a hand that beats bluffs and loses to value bets.
- **Minimum defence frequency**: how often you must continue against a bet so that a bluff with any two cards stops making money.
- **Exploitability**: how much a perfect counter-strategy would win from you.
- **Local best response (the shark)**: a counter-strategy that looks one decision ahead. What it wins is a lower bound on exploitability.
- **Solver**: a program that finds a balanced, unexploitable strategy for a simplified game.
- **Counterfactual regret minimisation (CFR)**: the self-play method solvers use. Each decision leans towards the options it regrets not choosing.
- **Blueprint**: the strategy assumed for how the hand was played so far, used to work out both players' ranges at the river.
- **Restricted Nash response**: a strategy that exploits a model of an opponent while guarding against the model being wrong.
- **OG, novice, rookie**: River's three skill tiers.

## Where the evidence lives

- The live policy: `packages/engine/src/bots.ts`, `packages/engine/src/bot-equity-core.ts`, `apps/server/src/bot-poker-guard.ts`.
- The instrument: `apps/server/src/bot-session-benchmark.ts`, `apps/server/src/bot-session-evaluation.ts`.
- The shark and all-in valuation: `apps/server/src/bot-lbr.ts`, `apps/server/src/bot-allin-equity.ts`.
- Slumbot: `apps/server/src/bot-slumbot.ts`.
- The river solver: `apps/server/src/bot-cfr.ts`, `apps/server/src/bot-river-solver.ts`, `apps/server/src/bot-river-policy.ts`, `apps/server/src/bot-public-replay.ts`, and `apps/server/src/bot-thinker.ts` for the live thread.
- The statistics behind the reads: `packages/engine/src/opponent-stats.ts`.

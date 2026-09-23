# Bot public context: board and current-hand actions

This packet defines the next bounded strategy input for River's rule bots. The live bot currently receives its own cards, the public board, pot, legal actions, stacks and dealer seat. It can adjust for preflop position and compare a simple flush draw with the direct call price. It does not receive the actions already taken in the current hand. It also treats a flush draw's nine nominal outs as clean even when a paired board or a stronger possible flush makes that unsafe.

The aim is to make an OG notice public evidence before it acts. An action is evidence about possible hands, never proof of a particular hand. Board texture is a description of visible cards, not a claim about who is ahead.

## Authoritative action source

`Room.apply` already records accepted player, timeout and away actions in `HandRecorder`. The recorder stores the current hand privately until settlement, then creates the completed `HandRecord`. The implementation should expose a copied view of those current actions to the server's bot path through the existing recorder. Do not maintain a second action list in `RoomHub` or put the live action list into every client's `RoomView`.

Extend the existing `HandAction` record with optional, public numeric facts captured when the action is accepted:

- `amountCommitted`: chips moved from that actor's stack by this action, including calls and all-ins; zero for check or fold;
- `potBefore`: the authoritative pot just before this action;
- `streetBetAfter`: the actor's total commitment on this street after the action, captured before any street reset.

Keep these fields optional for older completed records and existing fixtures. `Room.apply` can capture `potBefore` and the actor's stack and street bet around `BettingHand`'s accepted action, then pass the facts to `HandRecorder.record`. Derive `streetBetAfter` from the prior street bet plus chips committed, because `BettingHand` can reset street bets before its action method returns. Failed actions must not appear. `HandRecorder.currentActions()` should return a deep copy only while a hand is open, in exact action order, and should return no actions after settlement or before a new hand. A new hand starts a new sequence.

The current `Room` gives `RoomHub` this server-only snapshot. `RoomHub.scheduleBotTurn` passes it as an optional `actionFor` input on both the initial decision and any redecision after the view changes. The headless bot benchmark passes the same snapshot, so measured decisions use the live input. The observation builder copies only the public fields into an optional `BotObservationV1.actions` list. An omitted list means the source was unavailable; an empty list means the hand has started but nobody has acted. This is an additive observation field, which the existing version-one contract permits.

Only accepted actions from the current hand belong here. The list contains seat, street, action kind, committed amount, pot before, and street total. It contains no hole cards, shuffle data, seed material, private opponent memory, invented bluff/value labels, or future events. Policy code receives a copy it cannot use to mutate the recorder. If an action's numeric facts are absent in an old record, the bot must not infer a precise bet size from them.

## Board features

Derive board features from the public cards in a pure engine function. Do not store a second mutable copy of the board or a subjective `wet` flag. The initial features are:

- board card count and distinct ranks;
- rank multiplicities: unpaired, one pair, two pair, three of a kind or four of a kind;
- highest count of one suit on the public board;
- highest count of distinct board ranks in any five-rank straight window, including ace-low.

The actor's own hole cards remain separate inputs. A monotone board, a paired board, or a board with four cards toward a straight raises *possible* danger. It does not say the opponent has a flush, full house or straight. A four-flush in the actor's known cards is not automatically nine clean outs: paired boards and higher flush possibilities require discounting or explicit uncertainty. Do not replace the current deterministic fallback or legal-action validation.

## First strategy use

For this next implementation packet, the OG may use the new features in two narrow places:

1. On a paired or monotone board, avoid the present unconditional `9 / 46` clean-out rule for a turn flush draw. Use a conservative discounted estimate or fall back to the ordinary policy until a tested equity calculation exists. A cheap draw can still be worth continuing; a dangerous board cannot guarantee it.
2. Give the OG a public account of who bet or raised on each street and by how much. Derive simple facts such as the last aggressor, number of raises this street, and whether a player bet across successive streets. Treat these as context for later range work. No action sequence alone may make a bot certain that a player is bluffing or holding the nuts.

The first action-history pass is about truthful input and a small observable decision difference. A full range engine, cross-session player memory, bluff classifier and learned policy belong to later packets. Policy version must advance when a strategy change is accepted, so trace comparisons remain interpretable.

Implementation checkpoint: the authoritative recorder now supplies copied in-progress actions, exact public amounts, and a server-only bot observation. The headless benchmark passes the same list. `boardTexture` provides the pure board features. Rule policy version 4 declines the nine-clean-outs shortcut on paired or monotone boards and derives the last aggressor, raises this street, last bet-to-pot ratio, and consecutive aggressive streets from public actions. Under a bet of at least 65% of the prior pot, OG applies a small bounded caution adjustment to marginal calls, with further bounded adjustments for successive-street pressure and reraising. A session-only opponent model can make a second confidence-scaled adjustment when that aggressor's public history is sufficiently consistent; it never assigns a hidden hand or bluff label. The scenario gate shows more folds with marginal two pair but no folds with a set. Persistent memory, range inference and learned prediction remain open.

## Acceptance cases

- A legal call, raise and all-in each record the exact additional chips, pot before and street total. Check and fold record zero. A rejected action records nothing.
- Bot observations show actions in order for the current hand, including accepted timeout and away actions. Reconnect and a new hand do not duplicate or carry over old actions. A policy attempt to mutate an action or its metadata cannot alter the recorder.
- Current actions never expose another player's hidden cards, seed material, opponent labels or owner-only memory. Client snapshots stay unchanged.
- The same seed, room state and policy version replay to the same actions in the headless benchmark. The server submits only legal actions, with deterministic fallback on invalid policy output.
- Board fixtures distinguish `Ah 8c 3s` (unpaired, three suits), `Jh Th 4s` (two hearts and connected ranks), `Ks Kd 2h` (paired), and `As 2d 3c 4h` (ace-low straight window). Paired, monotone and connected flags should be validated from cards, not from hand-category guesses.
- A fixed scenario with the same draw and price on an unpaired versus paired board must show the OG no longer granting identical nine clean outs without qualification. A second fixture should show that an opponent's large river bet is represented as a possible strong hand *or* bluff, never a hidden-card fact.

Poker basis: [board texture and sizing](https://www.pokerstars.com/poker/learn/lesson/bet-sizing/), [ranges inferred from action](https://www.pokerstars.com/poker/learn/strategies/how-to-think-about-hand-ranges-in-poker/), and [dry versus draw-heavy boards](https://www.pokerstars.com/poker/learn/strategies/the-game-theory-of-board-texture-part-1-low-dry-flops/). These explain the strategy intent; River's exact thresholds must be checked in its own scenarios and paired benchmark.

## Terra High implementation packet

Allowed files: `packages/engine/src/bots.ts`, `packages/engine/src/hand-history.ts`, beside-code tests for both, `apps/server/src/hand-recorder.ts`, `apps/server/src/room.ts`, `apps/server/src/bot-service.ts`, `apps/server/src/transport.ts`, `apps/server/src/bot-benchmark.ts`, and focused beside-code tests. Update this document and `docs/design/24-bot-poker-scenarios.md` only when observed behaviour changes. Preserve every unrelated art or UI change in the shared worktree.

Exit: the acceptance cases above pass through the authoritative room and bot policy path; `npm test`, `npm run typecheck`, and scoped Biome pass by exit code. If a repository-wide gate fails outside these files, report the exact file without changing it. Stop after this packet and route the next decision to Sol Medium for poker behaviour review.

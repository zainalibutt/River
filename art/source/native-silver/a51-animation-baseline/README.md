# A51 accepted animation baseline

Zain accepted this animation set on 16 September 2026. It is the source for
later suit, crease, material and character-polish work.

The master contains all 27 retained actions. Its accepted review set is:

- `IDLE_thinking_readable`, frames 0-120;
- `CHECK_tap`, frames 0-36;
- `PEEK_card`, frames 0-48, with the corrected paired-card actions;
- `CHIP_toss`, frames 0-30, with the restrained palm-push actions;
- `ALLIN_standup`, frames 0-90, with the bilateral shove, chair retreat and
  arms-down standing finish.

`a51-animation-master.blend` opens in the thinking idle with proof collections
hidden and all actions protected by fake users. `build_reviews.py` creates
action-specific review copies under the ignored `art/out/` tree without
altering the master.

The master was copied from the locally verified A51 consolidation after all six
review files had been reopened. All 27 action signatures matched the accepted
A50 state. The redundant action-specific `.blend` files remain local because
they duplicate the same animation data.

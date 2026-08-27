-- Nobody should be locked out of the game by sitting down once.
--
-- Two numbers made that possible, and they were only visible once somebody
-- actually played:
--
--   signup_bankroll was 100,000 and the default buy-in is also 100,000, so a
--   new player's first time sitting down spent every chip they owned. Standing
--   up returns the stack, but until then the balance is nil, and any table that
--   ends without a clean cash-out - a closed browser, a restarted server -
--   leaves them on zero with nothing to buy back in with.
--
--   rescue_floor, the safety net for exactly that situation, topped a player up
--   to 25,000. The minimum buy-in at this stake is 50,000. So the mechanism
--   whose entire purpose is getting a broke player back into a seat handed them
--   half of what a seat costs, and could never once have worked.
--
-- 150,000 leaves a full buy-in on the table and 50,000 - one minimum buy-in -
-- still in the bank. The rescue floor now matches the minimum buy-in, which is
-- the smallest value that actually seats somebody.

update private.economy_config set value = 150000 where key = 'signup_bankroll';
update private.economy_config set value = 50000 where key = 'rescue_floor';

insert into private.economy_config (key, value)
values ('signup_bankroll', 150000), ('rescue_floor', 50000)
on conflict (key) do nothing;

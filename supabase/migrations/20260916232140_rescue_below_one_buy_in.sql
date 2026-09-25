-- A bust rescue paid out only below 1,000 chips, while the smallest seat at the
-- only stake, 250/500, costs 50,000. A bankroll anywhere between the two could
-- neither sit down nor be rescued, and claiming the daily 10,000 from zero put a
-- player straight into that gap.
--
-- The threshold now matches the minimum buy-in, the figure the rescue floor
-- already tops a player up to: anyone who cannot afford a seat can be rescued,
-- and the rescue buys exactly one.

update private.economy_config set value = 50000 where key = 'rescue_threshold';

insert into private.economy_config (key, value)
values ('rescue_threshold', 50000)
on conflict (key) do nothing;



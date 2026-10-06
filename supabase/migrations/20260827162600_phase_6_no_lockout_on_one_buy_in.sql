update private.economy_config set value = 150000 where key = 'signup_bankroll';
update private.economy_config set value = 50000 where key = 'rescue_floor';

insert into private.economy_config (key, value)
values ('signup_bankroll', 150000), ('rescue_floor', 50000)
on conflict (key) do nothing;



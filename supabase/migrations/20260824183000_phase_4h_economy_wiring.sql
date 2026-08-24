create view public.economy_config as
select
  key,
  value
from private.economy_config;

create view public.economy_daily_streak_bonus as
select
  calendar_day,
  bonus
from private.economy_daily_streak_bonus;

revoke all on table public.economy_config from anon, authenticated;
revoke all on table public.economy_daily_streak_bonus from anon, authenticated;

grant select on table public.economy_config to service_role;
grant select on table public.economy_daily_streak_bonus to service_role;
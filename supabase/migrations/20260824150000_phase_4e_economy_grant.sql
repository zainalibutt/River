insert into private.economy_config (key, value)
values
  ('rescue_floor', 25000),
  ('rescue_threshold', 1000),
  ('rescue_daily_cap', 3),
  ('daily_base', 10000)
on conflict (key) do nothing;

create table if not exists private.economy_daily_streak_bonus (
  calendar_day smallint primary key,
  bonus bigint not null check (bonus >= 0)
);

revoke all on table private.economy_daily_streak_bonus from public, anon, authenticated;

insert into private.economy_daily_streak_bonus (calendar_day, bonus)
values
  (1, 0),
  (2, 5000),
  (3, 10000),
  (4, 20000),
  (5, 30000),
  (6, 45000),
  (7, 90000)
on conflict (calendar_day) do nothing;
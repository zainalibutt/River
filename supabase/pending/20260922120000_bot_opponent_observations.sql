create table public.bot_opponent_observations (
  bot_id text not null check (char_length(bot_id) between 1 and 64),
  player_id uuid not null references public.players (id) on delete restrict,
  model_version smallint not null check (model_version = 1),
  hand_key text not null check (char_length(hand_key) between 1 and 160),
  observed_at timestamptz not null,
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object'),
  primary key (bot_id, player_id, model_version, hand_key)
);

create index bot_opponent_observations_replay_idx
  on public.bot_opponent_observations (bot_id, player_id, model_version, observed_at desc, hand_key desc);

alter table public.bot_opponent_observations enable row level security;
revoke all on table public.bot_opponent_observations from anon, authenticated;
grant select, insert on table public.bot_opponent_observations to service_role;


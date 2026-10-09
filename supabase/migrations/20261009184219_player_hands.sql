-- A player's private record of the hands they played. The game server writes one row per
-- seated person per settled hand with the service role; a player can read their own rows
-- and nobody else's. A row holds that player's own two cards and never another player's:
-- the hand record itself carries no hole cards. The newest 2,000 hands per player are kept.

create table public.player_hands (
  player_id uuid not null references public.players (id) on delete cascade,
  hand_id text not null check (char_length(hand_id) between 1 and 200),
  played_at timestamptz not null default now(),
  room_kind text not null check (room_kind in ('bots', 'private')),
  big_blind integer not null check (big_blind > 0),
  net_chips bigint not null,
  showed boolean not null,
  record jsonb not null check (jsonb_typeof(record) = 'object'),
  own_hole jsonb check (own_hole is null or jsonb_typeof(own_hole) = 'array'),
  opponents text[] not null default '{}',
  primary key (player_id, hand_id)
);

create index player_hands_recent_idx on public.player_hands (player_id, played_at desc);

alter table public.player_hands enable row level security;
revoke all on table public.player_hands from anon, authenticated;
grant select on table public.player_hands to authenticated;
grant select, insert, delete on table public.player_hands to service_role;

create policy "a player reads their own hands"
  on public.player_hands
  for select
  to authenticated
  using ((select auth.uid()) = player_id);

-- Keeps each player's record to its newest 2,000 hands as rows arrive.
create or replace function private.trim_player_hands()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.player_hands
  where player_id = new.player_id
    and hand_id in (
      select hand_id
      from public.player_hands
      where player_id = new.player_id
      order by played_at desc, hand_id desc
      offset 2000
    );
  return null;
end;
$$;

revoke all on function private.trim_player_hands() from public, anon, authenticated;

create trigger player_hands_trim
  after insert on public.player_hands
  for each row
  execute function private.trim_player_hands();

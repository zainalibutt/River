create table public.players (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Player',
  created_at timestamptz not null default now()
);

create table public.chip_ledger (
  id bigint generated always as identity primary key,
  player_id uuid not null references public.players (id) on delete cascade,
  delta bigint not null,
  reason text not null check (char_length(reason) between 1 and 64),
  ref text,
  created_at timestamptz not null default now()
);

create index chip_ledger_player_idx on public.chip_ledger (player_id, id);

alter table public.players enable row level security;
alter table public.chip_ledger enable row level security;

create policy players_select_own on public.players
  for select using (auth.uid() = id);
create policy players_update_own on public.players
  for update using (auth.uid() = id)
  with check (auth.uid() = id);

create view public.player_balances
with (security_invoker = true) as
select
  player_id,
  sum(delta)::bigint as balance
from public.chip_ledger
group by player_id;

create schema if not exists private;

revoke all on schema private from public;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.players (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', 'Player')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

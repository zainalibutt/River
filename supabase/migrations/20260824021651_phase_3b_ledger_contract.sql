alter table public.players
  drop constraint if exists players_id_fkey,
  add constraint players_id_fkey foreign key (id) references auth.users (id) on delete restrict;

alter table public.chip_ledger
  drop constraint if exists chip_ledger_player_id_fkey,
  add constraint chip_ledger_player_id_fkey foreign key (player_id) references public.players (id) on delete restrict;

update public.chip_ledger
set ref = 'legacy:' || id::text
where ref is null;

alter table public.chip_ledger
  alter column ref set not null;

alter table public.chip_ledger
  add constraint chip_ledger_ref_length check (char_length(ref) between 1 and 128);

create unique index chip_ledger_player_ref_idx on public.chip_ledger (player_id, ref);

drop policy if exists players_select_own on public.players;
drop policy if exists players_update_own on public.players;

revoke all on table public.players from anon, authenticated;
revoke delete, truncate on table public.players from service_role;
grant select on table public.players to authenticated;
grant update (display_name) on table public.players to authenticated;

create policy players_select_own on public.players
  for select to authenticated using ((select auth.uid()) = id);
create policy players_update_own on public.players
  for update to authenticated using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

revoke all on table public.chip_ledger from anon, authenticated;
revoke update, delete, truncate on table public.chip_ledger from service_role;
grant select, insert on table public.chip_ledger to service_role;

revoke all on table public.player_balances from anon, authenticated;
grant select on table public.player_balances to service_role;

create schema if not exists private;
revoke all on schema private from public;

create table if not exists private.economy_config (
  key text primary key,
  value bigint not null check (value >= 0)
);

revoke all on table private.economy_config from public, anon, authenticated;

insert into private.economy_config (key, value)
values ('signup_bankroll', 100000)
on conflict (key) do nothing;

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
  insert into public.chip_ledger (player_id, delta, reason, ref)
  values (
    new.id,
    (select value from private.economy_config where key = 'signup_bankroll'),
    'signup',
    'signup'
  )
  on conflict (player_id, ref) do nothing;
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public;

insert into public.chip_ledger (player_id, delta, reason, ref)
select
  players.id,
  (select value from private.economy_config where key = 'signup_bankroll'),
  'signup',
  'signup'
from public.players
where not exists (
  select 1 from public.chip_ledger where chip_ledger.player_id = players.id
);

create or replace function public.apply_ledger_entry(
  p_player_id uuid,
  p_delta bigint,
  p_reason text,
  p_ref text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_balance bigint;
  existing_delta bigint;
  existing_reason text;
  existing_found boolean;
begin
  if p_delta = 0 then
    raise exception 'ledger delta cannot be zero';
  end if;
  if char_length(p_reason) not between 1 and 64 then
    raise exception 'ledger reason must be between 1 and 64 characters';
  end if;
  if char_length(p_ref) not between 1 and 128 then
    raise exception 'ledger ref must be between 1 and 128 characters';
  end if;

  perform 1 from public.players where id = p_player_id for update;
  if not found then
    raise exception 'unknown player';
  end if;

  select delta, reason
  into existing_delta, existing_reason
  from public.chip_ledger
  where player_id = p_player_id and ref = p_ref;
  existing_found := found;

  select coalesce(sum(delta), 0)::bigint
  into current_balance
  from public.chip_ledger
  where player_id = p_player_id;

  if existing_found then
    if existing_delta <> p_delta or existing_reason <> p_reason then
      raise exception 'ledger ref reused with different entry';
    end if;
    return current_balance;
  end if;

  if current_balance + p_delta < 0 then
    raise exception 'insufficient balance';
  end if;

  insert into public.chip_ledger (player_id, delta, reason, ref)
  values (p_player_id, p_delta, p_reason, p_ref);

  return current_balance + p_delta;
end;
$$;

revoke all on function public.apply_ledger_entry(uuid, bigint, text, text) from public, anon, authenticated;
grant execute on function public.apply_ledger_entry(uuid, bigint, text, text) to service_role;

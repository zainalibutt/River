-- Erasing a player on request, without breaking the chip ledger.
--
-- The privacy page promises to delete an account and what is linked to it,
-- but the ledger is append-only and every player row is held by it, so no
-- account with a single chip entry could be deleted at all. Erasure now keeps
-- the ledger and the player id it is kept under, and removes everything else:
-- the sign-in account, the display name, the hand records, friends, blocks,
-- invites, bot keys, items, cosmetics, bot memory and seatings. What is left is
-- a row of chip movements under an id nothing links to a person any more.
--
-- Run it as the service role, one player at a time, on a request:
--   select public.erase_player('<player id>');

alter table public.players add column if not exists erased_at timestamptz;

-- The account goes and its player id stays, so the player row can no longer
-- require an account. The guard below takes over what the restriction did:
-- an account is never deleted with its player still intact.
alter table public.players drop constraint if exists players_id_fkey;

create or replace function private.guard_account_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.players where id = old.id and erased_at is null) then
    raise exception 'erase the player with public.erase_player before deleting the account';
  end if;
  return old;
end;
$$;

revoke all on function private.guard_account_deletion() from public;

drop trigger if exists auth_users_erase_first on auth.users;
create trigger auth_users_erase_first
  before delete on auth.users
  for each row execute function private.guard_account_deletion();

create or replace function public.erase_player(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The same lock every ledger entry takes, so nothing lands mid-erasure.
  perform 1 from public.players where id = p_player_id for update;
  if not found then
    raise exception 'unknown player';
  end if;
  -- A seat still open holds chips a table has not paid back yet.
  if exists (
    select 1 from public.table_seatings where player_id = p_player_id and closed_at is null
  ) then
    raise exception 'the player still has an open seat; erase once it has settled';
  end if;

  delete from public.player_hands where player_id = p_player_id;
  delete from public.friend_requests where from_player = p_player_id or to_player = p_player_id;
  delete from public.friendships where player_a = p_player_id or player_b = p_player_id;
  delete from public.player_blocks where blocker = p_player_id or blocked = p_player_id;
  delete from public.table_invites where from_player = p_player_id or to_player = p_player_id;
  delete from public.bot_api_keys where player_id = p_player_id;
  delete from public.player_table_items where player_id = p_player_id;
  delete from public.player_cosmetics where player_id = p_player_id;
  delete from public.bot_opponent_observations where player_id = p_player_id;
  delete from public.bot_opponent_checkpoints where player_id = p_player_id;
  delete from public.table_seatings where player_id = p_player_id;

  -- A name of the shape every name has, and free, that says nothing.
  update public.players
  set
    display_name = 'Erased_' || substr(md5(gen_random_uuid()::text), 1, 12),
    name_claimed_at = null,
    erased_at = now()
  where id = p_player_id;

  delete from auth.users where id = p_player_id;
end;
$$;

revoke all on function public.erase_player(uuid) from public, anon, authenticated;
grant execute on function public.erase_player(uuid) to service_role;

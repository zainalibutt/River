-- An erased player moves no more chips.
--
-- Erasure deletes the sign-in account, but a token it issued stays valid until
-- it expires, up to an hour, and a socket already open stays open. Without
-- this, either could still buy in or spend against the erased player. Hand
-- records a table writes in that hour are cleared by running erase_player
-- again once it has passed; it is safe to run more than once.
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
  erased timestamptz;
begin
  if p_delta = 0 then
    raise exception 'ledger delta must be non-zero';
  end if;

  select erased_at into erased from public.players where id = p_player_id for update;
  if not found then
    raise exception 'unknown player';
  end if;
  if erased is not null then
    raise exception 'erased player';
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

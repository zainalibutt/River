-- One player's ledger entries, one at a time.
--
-- apply_ledger_entry read the balance as a sum and then inserted, with nothing
-- held between the two. Two entries for one player under different refs - a
-- buy-in and a shop purchase landing together, say - could both read the same
-- balance, both pass the check, and both commit, taking the bankroll below
-- zero. Each entry now locks its player's row first, so the read, the check and
-- the insert happen with every other entry for that player waiting behind them.
-- Different players never wait on each other.
--
-- The lock comes before the replay check as well, so two calls racing with the
-- same ref settle into one entry and one replay, never two of either.
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
    raise exception 'ledger delta must be non-zero';
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

-- Kept for a server still running the previous build while this deploys: the
-- same lock, taken before its replay check, so that check and the entry agree.
create or replace function public.apply_ledger_entry_opening_seating(
  p_player_id uuid,
  p_delta bigint,
  p_reason text,
  p_ref text,
  p_seating_ref text,
  p_buy_in bigint,
  p_opened_at timestamptz
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  replay boolean;
  new_balance bigint;
begin
  perform 1 from public.players where id = p_player_id for update;

  select exists (
    select 1 from public.chip_ledger where player_id = p_player_id and ref = p_ref
  ) into replay;

  new_balance := public.apply_ledger_entry(p_player_id, p_delta, p_reason, p_ref);

  if not replay then
    insert into public.table_seatings (player_id, ref, buy_in, opened_at)
    values (p_player_id, p_seating_ref, p_buy_in, p_opened_at)
    on conflict (player_id, ref) do update
      set buy_in = excluded.buy_in, closed_at = null;
  end if;

  return new_balance;
end;
$$;

-- A buy-in or rebuy, saying whether it was new.
--
-- A seat's debit is named after the request that asked for it. The server
-- remembers its answers to requests for a while, but not for ever and not
-- across a restart, and a request it has forgotten used to come back from the
-- ledger as an entry already made: no chips taken, and the server, hearing a
-- balance and no error, seated the player anyway. Saying `replay` lets the
-- server refuse a request it has already carried out, whatever it remembers.
--
-- The seating, when one is given, is written as the opening function writes
-- it, in the same transaction, and only when the debit is new.
create or replace function public.apply_seat_debit(
  p_player_id uuid,
  p_delta bigint,
  p_reason text,
  p_ref text,
  p_seating_ref text default null,
  p_buy_in bigint default null,
  p_opened_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  replay boolean;
  new_balance bigint;
begin
  if p_delta >= 0 then
    raise exception 'a seat debit must be negative';
  end if;

  perform 1 from public.players where id = p_player_id for update;
  if not found then
    raise exception 'unknown player';
  end if;

  select exists (
    select 1 from public.chip_ledger where player_id = p_player_id and ref = p_ref
  ) into replay;

  new_balance := public.apply_ledger_entry(p_player_id, p_delta, p_reason, p_ref);

  if not replay and p_seating_ref is not null then
    insert into public.table_seatings (player_id, ref, buy_in, opened_at)
    values (p_player_id, p_seating_ref, p_buy_in, p_opened_at)
    on conflict (player_id, ref) do update
      set buy_in = excluded.buy_in, closed_at = null;
  end if;

  return jsonb_build_object('balance', new_balance, 'replay', replay);
end;
$$;

revoke all on function public.apply_seat_debit(uuid, bigint, text, text, text, bigint, timestamptz)
  from public, anon, authenticated;
grant execute on function public.apply_seat_debit(uuid, bigint, text, text, text, bigint, timestamptz)
  to service_role;

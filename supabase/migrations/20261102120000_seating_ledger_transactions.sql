-- A seat's chips and its line in the seating book, written together.
--
-- The server used to move a seat's chips and then write the seating book in a
-- second request. A crash between the two broke the book's one promise, that an
-- open seating is a buy-in nobody has been paid back:
--
--   * a buy-in or rebuy debited but never written down was lost for good, since
--     the start-up refund pays back only what the book says is open;
--   * a stand or a leave credited but never written down as closed was paid
--     again, buy-in and all, by the next server to start.
--
-- Each function below applies one ledger entry through apply_ledger_entry and
-- writes what that entry does to its seating, in the same transaction, so
-- either both land or neither does.

-- A buy-in or rebuy debited, or a refused stand's credit taken back: the
-- seating is open, at the size given. A ledger reference already used is a
-- retry of a call that committed, so its seating is left as that call wrote it,
-- whatever has happened since.
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

-- A stack paid back, or a refused buy-in refunded: the seating is over. Closing
-- is the same however often it runs, so a retry closes it too.
create or replace function public.apply_ledger_entry_closing_seating(
  p_player_id uuid,
  p_delta bigint,
  p_reason text,
  p_ref text,
  p_seating_ref text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_balance bigint;
begin
  new_balance := public.apply_ledger_entry(p_player_id, p_delta, p_reason, p_ref);

  update public.table_seatings
  set closed_at = now()
  where player_id = p_player_id and ref = p_seating_ref and closed_at is null;

  return new_balance;
end;
$$;

revoke all on function public.apply_ledger_entry_opening_seating(uuid, bigint, text, text, text, bigint, timestamptz)
  from public, anon, authenticated;
grant execute on function public.apply_ledger_entry_opening_seating(uuid, bigint, text, text, text, bigint, timestamptz)
  to service_role;

revoke all on function public.apply_ledger_entry_closing_seating(uuid, bigint, text, text, text)
  from public, anon, authenticated;
grant execute on function public.apply_ledger_entry_closing_seating(uuid, bigint, text, text, text)
  to service_role;

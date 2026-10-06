-- Which table seatings are open, kept beside the chip ledger rather than in it.
--
-- Tables live in the server's memory. A graceful shutdown pays every seated
-- stack back, but a crash or a forced kill does not, and the buy-ins behind
-- those seats stay debited. The server writes a row here when a seating opens,
-- rewrites it when a rebuy grows it, and closes it when the seating ends,
-- whatever it had left. On start-up it pays back the buy-in of each row that
-- an earlier server opened and never closed, under a ledger reference named
-- after the seating, and closes the row.
--
-- The chip ledger alone cannot answer that question. A seat that ends with
-- nothing left moves no chips, so nothing in chip_ledger says it ended, and
-- every player who busted and left would look like a seat a crash had taken.
--
-- The server's service role is the only reader and writer. Writes merge on the
-- primary key and never write closed_at on an open, so a row once closed stays
-- closed whatever arrives after it.

create table public.table_seatings (
  player_id uuid not null references public.players (id) on delete restrict,
  -- Short enough that the refund's `${ref}:crash-refund` still fits a ledger ref.
  ref text not null check (char_length(ref) between 1 and 115),
  buy_in bigint not null check (buy_in > 0),
  opened_at timestamptz not null,
  closed_at timestamptz,
  primary key (player_id, ref)
);

-- The start-up read: open seatings opened before a moment, oldest first.
create index table_seatings_open_idx
  on public.table_seatings (opened_at)
  where closed_at is null;

alter table public.table_seatings enable row level security;
revoke all on table public.table_seatings from anon, authenticated;
grant select, insert, update on table public.table_seatings to service_role;

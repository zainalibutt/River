-- Table items are bought with chips and are the chip sink the spec wanted.
-- They never affect poker odds; they carry visual identity and a REP earning
-- boost only.
--
-- Ownership is permanent once bought. Equipping is free and reversible, and one
-- item may occupy each slot.

create table if not exists public.player_table_items (
  player_id uuid not null references public.players (id) on delete cascade,
  item_id text not null,
  slot text not null,
  equipped boolean not null default false,
  acquired_at timestamptz not null default now(),
  primary key (player_id, item_id)
);

-- One equipped item per slot per player. Enforced here rather than in
-- application code, because a second item in a slot would silently double a
-- player's REP rate.
create unique index if not exists player_table_items_slot_idx
  on public.player_table_items (player_id, slot)
  where equipped;

alter table public.player_table_items enable row level security;

-- Players may read their own inventory and nothing else. Writes are
-- server-only: an item is bought through the ledger, and a client that could
-- insert here could grant itself the REP boost without paying.
drop policy if exists player_table_items_select_own on public.player_table_items;
create policy player_table_items_select_own
  on public.player_table_items
  for select
  using (player_id = auth.uid());

revoke insert, update, delete on table public.player_table_items from anon, authenticated;

-- Cosmetics are worn, bought with chips, and never affect play. They are kept
-- separate from player_table_items because the two are different things: a
-- table item boosts REP earning, a cosmetic changes only appearance. One table
-- holding both would make that distinction a convention rather than a rule.

create table if not exists public.player_cosmetics (
  player_id uuid not null references public.players (id) on delete cascade,
  cosmetic_id text not null,
  slot text not null,
  equipped boolean not null default false,
  acquired_at timestamptz not null default now(),
  primary key (player_id, cosmetic_id)
);

-- One equipped cosmetic per slot. Enforced here rather than in application
-- code: two items in a slot would render a character wearing both.
create unique index if not exists player_cosmetics_slot_idx
  on public.player_cosmetics (player_id, slot)
  where equipped;

alter table public.player_cosmetics enable row level security;

-- Players read their own wardrobe and nothing else. Writes are server-only:
-- a client able to insert here would dress itself in anything for free.
drop policy if exists player_cosmetics_select_own on public.player_cosmetics;
create policy player_cosmetics_select_own
  on public.player_cosmetics
  for select
  using (player_id = auth.uid());

revoke insert, update, delete on table public.player_cosmetics from anon, authenticated;

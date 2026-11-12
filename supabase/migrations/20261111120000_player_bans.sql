-- Bans that outlive the server process.
--
-- The developer account can ban a player, and the server kept that list in
-- memory, so every deploy or restart let everyone back in. One row here is one
-- banned player; lifting the ban deletes the row. Only the server reads or
-- writes it, with the service role: a player can neither see who is banned nor
-- learn that they are.
--
-- The id carries no foreign key on purpose. A ban is a statement about an id
-- the server will refuse, whether or not that id has a player row yet, and it
-- must hold after the player is erased: the erased row keeps its id.

create table if not exists public.player_bans (
  player_id uuid primary key,
  banned_at timestamptz not null default now()
);

alter table public.player_bans enable row level security;

revoke all on table public.player_bans from public, anon, authenticated;
grant select, insert, delete on table public.player_bans to service_role;

-- Keys for the public bot API: a saved account makes them, uses them to play River's bots over
-- HTTP, and revokes them. Only a SHA-256 hash of each key is stored; the key itself is shown once,
-- when it is made. Every write goes through the server with the service role, which applies the
-- limits (active keys per player); a player can read their own keys' labels and dates and nothing
-- else. Nothing here touches a table that exists already.

create table public.bot_api_keys (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players (id) on delete cascade,
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  label text not null default '' check (char_length(label) <= 40),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index bot_api_keys_player_idx on public.bot_api_keys (player_id, created_at desc);

alter table public.bot_api_keys enable row level security;

revoke all on table public.bot_api_keys from anon, authenticated;
grant select (id, player_id, label, created_at, last_used_at, revoked_at)
  on table public.bot_api_keys to authenticated;
grant select, insert, update, delete on table public.bot_api_keys to service_role;

create policy "a player reads their own bot API keys"
  on public.bot_api_keys for select to authenticated
  using (player_id = (select auth.uid()));

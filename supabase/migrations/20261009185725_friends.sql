-- Friends: requests between saved accounts, accepted friendships, silent blocks and
-- invitations to a private table. Every write goes through the server with the service
-- role, which applies the limits (pending requests, daily requests, expiry, re-sending
-- after a decline); a player can read the rows they are part of and nothing else.

create table public.friend_requests (
  id bigint generated always as identity primary key,
  from_player uuid not null references public.players (id) on delete cascade,
  to_player uuid not null references public.players (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (from_player <> to_player)
);

-- One open request between two players at a time, whichever way round it was sent.
create unique index friend_requests_one_pending_idx
  on public.friend_requests (least(from_player, to_player), greatest(from_player, to_player))
  where status = 'pending';
create index friend_requests_to_idx on public.friend_requests (to_player, status, created_at desc);
create index friend_requests_from_idx on public.friend_requests (from_player, created_at desc);

create table public.friendships (
  player_a uuid not null references public.players (id) on delete cascade,
  player_b uuid not null references public.players (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (player_a, player_b),
  check (player_a < player_b)
);
create index friendships_b_idx on public.friendships (player_b);

create table public.player_blocks (
  blocker uuid not null references public.players (id) on delete cascade,
  blocked uuid not null references public.players (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);

create table public.table_invites (
  id bigint generated always as identity primary key,
  from_player uuid not null references public.players (id) on delete cascade,
  to_player uuid not null references public.players (id) on delete cascade,
  invite_code text not null check (invite_code ~ '^[A-Z0-9]{4,12}$'),
  created_at timestamptz not null default now(),
  check (from_player <> to_player)
);
create index table_invites_to_idx on public.table_invites (to_player, created_at desc);

alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.player_blocks enable row level security;
alter table public.table_invites enable row level security;

revoke all on table public.friend_requests, public.friendships, public.player_blocks,
  public.table_invites from anon, authenticated;
grant select on table public.friend_requests, public.friendships, public.player_blocks,
  public.table_invites to authenticated;
grant select, insert, update, delete on table public.friend_requests, public.friendships,
  public.player_blocks, public.table_invites to service_role;

create policy "a player reads requests they sent or received"
  on public.friend_requests for select to authenticated
  using ((select auth.uid()) in (from_player, to_player));

create policy "a player reads their own friendships"
  on public.friendships for select to authenticated
  using ((select auth.uid()) in (player_a, player_b));

-- Blocks are silent: the blocked player never sees a row saying so.
create policy "a player reads the blocks they made"
  on public.player_blocks for select to authenticated
  using ((select auth.uid()) = blocker);

create policy "a player reads invitations sent to them"
  on public.table_invites for select to authenticated
  using ((select auth.uid()) = to_player);

-- Members choose a name of their own, and once chosen it is theirs for good.
--
-- A generated name (see the generated_display_names migration) is a
-- placeholder. A member who has confirmed their email chooses a name through
-- the server, which checks it against the rules in
-- apps/web/src/lib/player-name.ts and then calls claim_display_name here. A
-- chosen name is locked to that account: no other account can hold it in any
-- mix of capitals, and the account cannot trade it in, so a short or rare name
-- stays rare.
--
-- Nothing else sets a name any more. A signed-in player could rewrite their
-- own name to anything through the REST API, and a signup could bring one in
-- its metadata; both are closed. Every new player is given a generated name
-- whatever the signup carried.
--
-- The shape check covers every row, generated names included, so it is looser
-- than the chosen-name rule: generated names run to 19 characters.

begin;

set local lock_timeout = '5s';

alter table public.players add column if not exists name_claimed_at timestamptz;

alter table public.players
  add constraint players_display_name_shape
  check (display_name ~ '^[A-Za-z][A-Za-z0-9_]{2,23}$');

create index if not exists players_display_name_lower_idx
  on public.players (lower(display_name));

create unique index if not exists players_claimed_name_key
  on public.players (lower(display_name))
  where name_claimed_at is not null;

drop policy if exists players_update_own on public.players;
revoke update on table public.players from anon, authenticated;
revoke update (display_name) on table public.players from anon, authenticated;

-- A generated name no player holds in any mix of capitals, or null when
-- twenty-five draws all found one taken.
create or replace function private.generated_display_name()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  adjectives constant text[] := array[
    'Amber', 'Bold', 'Brave', 'Brisk', 'Calm', 'Clever', 'Copper', 'Crimson',
    'Dapper', 'Deft', 'Early', 'Fabled', 'Fleet', 'Gentle', 'Gilded', 'Golden',
    'Hardy', 'Hidden', 'Jolly', 'Keen', 'Lucky', 'Mellow', 'Misty', 'Nimble',
    'Noble', 'Quick', 'Quiet', 'Rapid', 'Royal', 'Rustic', 'Silent', 'Silver',
    'Steady', 'Still', 'Sunny', 'Swift', 'Tidal', 'Velvet', 'Wily', 'Wise'
  ];
  nouns constant text[] := array[
    'Badger', 'Bittern', 'Crane', 'Dipper', 'Eel', 'Egret', 'Falcon', 'Ferry',
    'Finch', 'Gull', 'Hare', 'Heron', 'Kestrel', 'Kingfisher', 'Lark', 'Mallard',
    'Marten', 'Merlin', 'Minnow', 'Moorhen', 'Newt', 'Osprey', 'Otter', 'Owl',
    'Perch', 'Pike', 'Plover', 'Raven', 'Reed', 'Robin', 'Salmon', 'Sparrow',
    'Stoat', 'Swan', 'Teal', 'Tern', 'Trout', 'Vole', 'Willow', 'Wren'
  ];
  candidate text;
begin
  for attempt in 1..25 loop
    candidate :=
      adjectives[1 + floor(random() * array_length(adjectives, 1))::int]
      || nouns[1 + floor(random() * array_length(nouns, 1))::int]
      || (10 + floor(random() * 90))::int::text;
    if not exists (
      select 1 from public.players where lower(display_name) = lower(candidate)
    ) then
      return candidate;
    end if;
  end loop;
  return null;
end;
$$;

-- Every new player is named here, whatever the signup carried, and nobody
-- arrives with a name already claimed.
create or replace function private.name_new_player()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.name_claimed_at := null;
  begin
    new.display_name := coalesce(private.generated_display_name(), 'Player');
  exception when others then
    -- A name is not worth a refused signup.
    new.display_name := 'Player';
  end;
  return new;
end;
$$;

-- What claiming p_name for p_player_id comes to, and with p_commit the claim
-- itself: 'available' or 'claimed', 'taken' when another player holds it in
-- any mix of capitals, 'locked' when this player has already chosen, 'invalid'
-- outside the chosen-name shape, and 'missing' for no such player. The shape is
-- a backstop; the server's rules also refuse reserved and unsuitable names.
create or replace function public.claim_display_name(
  p_player_id uuid,
  p_name text,
  p_commit boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  chosen_at timestamptz;
begin
  if p_name is null or p_name !~ '^[A-Za-z][A-Za-z0-9_]{2,15}$' then
    return 'invalid';
  end if;
  select name_claimed_at into chosen_at
  from public.players
  where id = p_player_id
  for update;
  if not found then
    return 'missing';
  end if;
  if chosen_at is not null then
    return 'locked';
  end if;
  if exists (
    select 1 from public.players
    where lower(display_name) = lower(p_name) and id <> p_player_id
  ) then
    return 'taken';
  end if;
  if not p_commit then
    return 'available';
  end if;
  update public.players
  set display_name = p_name, name_claimed_at = now()
  where id = p_player_id;
  return 'claimed';
exception when unique_violation then
  -- Another claim of the same name landed first.
  return 'taken';
end;
$$;

revoke all on function public.claim_display_name(uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.claim_display_name(uuid, text, boolean) to service_role;

commit;

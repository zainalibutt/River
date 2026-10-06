-- Every player gets a name of their own, rather than 'Player'.
--
-- A member's public profile lives at /p/<name>, and a name everybody shares
-- names nobody, so until now no profile could be found at all. Each new player
-- is named as their row is written, and every player still called 'Player' is
-- named here. A name is two words and two digits, such as QuietHeron42:
-- nothing in it says anything about the person, and there are 144,000 of them,
-- so one that nobody has is always near at hand.
--
-- Naming never stops somebody arriving. The signup trigger writes the players
-- row, so anything raised here would refuse the signup; a name that cannot be
-- found or made leaves the player as 'Player' instead, with no profile until
-- they are named.
--
-- The index serves the profile route, which reads a player by name, and the
-- generator's check that a name is free.

begin;

set local lock_timeout = '5s';

create index if not exists players_display_name_idx on public.players (display_name);

-- A name no player has yet, or null when twenty-five draws all found one taken.
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
    if not exists (select 1 from public.players where display_name = candidate) then
      return candidate;
    end if;
  end loop;
  return null;
end;
$$;

revoke all on function private.generated_display_name() from public;

create or replace function private.name_new_player()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.display_name = 'Player' then
    begin
      new.display_name := coalesce(private.generated_display_name(), new.display_name);
    exception when others then
      -- A name is not worth a refused signup. They stay 'Player' for now.
      null;
    end;
  end if;
  return new;
end;
$$;

revoke all on function private.name_new_player() from public;

drop trigger if exists players_named_on_arrival on public.players;
create trigger players_named_on_arrival
  before insert on public.players
  for each row execute function private.name_new_player();

-- One statement per player, so each draw sees every name given before it.
do $$
declare
  unnamed uuid;
begin
  for unnamed in
    select id from public.players where display_name = 'Player' order by created_at, id
  loop
    update public.players
    set display_name = coalesce(private.generated_display_name(), display_name)
    where id = unnamed;
  end loop;
end;
$$;

commit;

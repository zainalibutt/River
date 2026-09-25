begin;

set local lock_timeout = '5s';

alter table public.players
  drop constraint players_id_fkey,
  add constraint players_id_fkey foreign key (id) references auth.users (id) on delete restrict not valid;

alter table public.chip_ledger
  drop constraint chip_ledger_player_id_fkey,
  add constraint chip_ledger_player_id_fkey foreign key (player_id) references public.players (id) on delete restrict not valid;

alter table public.players validate constraint players_id_fkey;
alter table public.chip_ledger validate constraint chip_ledger_player_id_fkey;

alter table public.chip_ledger
  add constraint chip_ledger_ref_length check (char_length(ref) between 1 and 128) not valid;
alter table public.chip_ledger validate constraint chip_ledger_ref_length;
alter table public.chip_ledger alter column ref set not null;

commit;


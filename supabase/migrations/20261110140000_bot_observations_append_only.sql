-- What a bot has seen of a player is appended and never rewritten.
--
-- The table was meant to take only inserts, and deletes once a checkpoint has
-- folded a run of rows in, from the server. It granted those, but never took
-- away the update Supabase gives the service role on every new table by
-- default, so the server could have rewritten what a bot remembered of a hand
-- after the fact. The server never does; now it cannot.
revoke update, truncate on table public.bot_opponent_observations from service_role;

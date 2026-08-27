-- The developer role.
--
-- River's server reads the role straight out of the signed access token, from
-- `app_metadata`. That object is writable only with the service key, which is
-- what makes it safe to trust without a lookup: `user_metadata`, the other
-- metadata object in the same token, is writable by the account holder through
-- auth.updateUser, so a role kept there would be one browser console call away
-- from anybody granting themselves every power in the game.
--
-- Nobody is granted anything here. This installs the two statements that do it,
-- so granting is one call rather than a hand-written update against auth.users,
-- and so revoking is too.

create or replace function private.set_river_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_role is not null and p_role <> 'developer' then
    raise exception 'unknown River role: %', p_role;
  end if;

  update auth.users
  set raw_app_meta_data =
    case
      when p_role is null then (coalesce(raw_app_meta_data, '{}'::jsonb) - 'river_role')
      else coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('river_role', p_role)
    end
  where id = p_user_id;

  if not found then
    raise exception 'no such user: %', p_user_id;
  end if;
end;
$$;

-- Only the service key may call it. An authenticated user reaching this
-- function is an authenticated user promoting themselves.
revoke all on function private.set_river_role(uuid, text) from public, anon, authenticated;

comment on function private.set_river_role(uuid, text) is
  'Grants or clears the River developer role. Pass null to revoke. Service key only. '
  'The change lands in app_metadata and therefore in the next issued access token, '
  'so the holder must sign out and back in before the server sees it.';

-- To grant, from the SQL editor or with the service key:
--
--   select private.set_river_role(
--     (select id from auth.users where email = 'you@example.com'),
--     'developer'
--   );
--
-- To revoke:
--
--   select private.set_river_role(
--     (select id from auth.users where email = 'you@example.com'),
--     null
--   );
--
-- The role travels in the access token, so it takes effect on the next one.
-- Sign out and back in, or wait for the refresh, before expecting the server to
-- agree that you hold it.

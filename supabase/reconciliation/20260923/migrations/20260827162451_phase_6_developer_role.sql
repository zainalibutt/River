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

revoke all on function private.set_river_role(uuid, text) from public, anon, authenticated;

comment on function private.set_river_role(uuid, text) is
  'Grants or clears the River developer role. Pass null to revoke. Service key only. '
  'The change lands in app_metadata and therefore in the next issued access token, '
  'so the holder must sign out and back in before the server sees it.';


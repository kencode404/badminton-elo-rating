-- ban_user can no longer target another admin. Defense in depth
-- alongside the client filter so a compromised / malicious admin
-- can't lock fellow admins out of the system.
--
-- Safe to rerun.

create or replace function public.ban_user(
  p_target_id uuid,
  p_reason text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean;
  v_target_admin boolean;
  v_target_name text;
  v_admin_name text;
begin
  select is_admin into v_admin
    from public.profiles
   where id = auth.uid();
  if not coalesce(v_admin, false) then
    raise exception 'Only admins can ban users';
  end if;
  if p_target_id = auth.uid() then
    raise exception 'You cannot ban yourself';
  end if;

  select is_admin into v_target_admin
    from public.profiles
   where id = p_target_id;
  if coalesce(v_target_admin, false) then
    raise exception 'You cannot ban another admin';
  end if;

  update public.profiles
     set is_banned = true,
         banned_at = now(),
         banned_by = auth.uid(),
         banned_reason = nullif(trim(coalesce(p_reason, '')), '')
   where id = p_target_id
   returning display_name into v_target_name;

  select display_name into v_admin_name
    from public.profiles where id = auth.uid();

  insert into public.chat_messages
    (kind, user_id, body, expires_at)
  values (
    'system_user_banned',
    p_target_id,
    coalesce(v_target_name, 'A player') || ' banned by ' ||
      coalesce(v_admin_name, 'admin'),
    now() + interval '30 days'
  );
end;
$$;

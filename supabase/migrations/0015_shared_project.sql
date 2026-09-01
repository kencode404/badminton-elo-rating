-- 0015: shared Supabase project hardening. Safe to rerun.
--
-- This app now lives in a Supabase project that is shared with another
-- app (every object is prefixed badminton_ for that reason), which means
-- auth.users is shared too. Two consequences:
--
--   1) badminton_handle_new_user() must NOT create a badminton profile
--      for every sign-up in the shared project — otherwise the other
--      app's users would show up on our leaderboard as 1200-rated
--      players. It now only acts on sign-ups that tag themselves with
--      raw_user_meta_data.app = 'badminton' (the password sign-up form
--      sets that).
--
--   2) Users who arrive without that tag — Google OAuth sign-ins, or an
--      existing account from the other app opening this app — get their
--      profile created lazily by badminton_ensure_profile(), which the
--      client calls right after a session is established.

create or replace function public.badminton_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.raw_user_meta_data->>'app', '') <> 'badminton' then
    return new;
  end if;

  insert into public.badminton_profiles (id, display_name)
  values (
    new.id,
    left(
      coalesce(
        nullif(new.raw_user_meta_data->>'display_name', ''),
        split_part(new.email, '@', 1),
        'Player'
      ),
      15
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.badminton_ensure_profile()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_meta jsonb;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  if exists (select 1 from public.badminton_profiles where id = v_uid) then
    return;
  end if;

  select email, raw_user_meta_data
    into v_email, v_meta
    from auth.users
   where id = v_uid;

  insert into public.badminton_profiles (id, display_name)
  values (
    v_uid,
    left(
      coalesce(
        nullif(v_meta->>'display_name', ''),
        nullif(v_meta->>'full_name', ''),
        nullif(v_meta->>'name', ''),
        nullif(split_part(coalesce(v_email, ''), '@', 1), ''),
        'Player'
      ),
      15
    )
  )
  on conflict (id) do nothing;
end;
$$;

revoke all on function public.badminton_ensure_profile() from public;
grant execute on function public.badminton_ensure_profile() to authenticated;

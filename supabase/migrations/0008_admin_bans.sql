-- Admin ban infrastructure.
--
-- Adds an is_banned flag (+ audit fields) to profiles, plus admin-only
-- RPCs for banning and unbanning users. Bans are non-destructive —
-- profile + match history stays intact; the user is just hidden from
-- the leaderboard / player picker and force-signed-out client-side.
--
-- ban_user has two extra guards over the obvious admin-only check:
--   * cannot ban yourself
--   * cannot ban another admin (defense in depth alongside the
--     client-side admin filter on the search dropdown)
-- and emits a `system_user_banned` moderation log line in chat.
-- unban is silent — no chat announcement, just flips the flag.
--
-- Safe to rerun.

-- =========================================================================
-- 1. Ban columns + index
-- =========================================================================

alter table public.profiles
  add column if not exists is_banned boolean not null default false,
  add column if not exists banned_at timestamptz,
  add column if not exists banned_by uuid references public.profiles(id) on delete set null,
  add column if not exists banned_reason text;

-- Partial index — most rows are not banned, so this stays tiny.
create index if not exists profiles_banned_idx
  on public.profiles (banned_at desc) where is_banned = true;

-- =========================================================================
-- 2. ban_user / unban_user RPCs
-- =========================================================================

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

  -- Quiet centered grey log line in chat — broadcasts the ban to the
  -- club without breaking the streak/tier celebration cadence.
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

grant execute on function public.ban_user(uuid, text) to authenticated;

create or replace function public.unban_user(p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean;
begin
  select is_admin into v_admin
    from public.profiles
   where id = auth.uid();
  if not coalesce(v_admin, false) then
    raise exception 'Only admins can unban users';
  end if;
  update public.profiles
     set is_banned = false,
         banned_at = null,
         banned_by = null,
         banned_reason = null
   where id = p_target_id;
end;
$$;

grant execute on function public.unban_user(uuid) to authenticated;

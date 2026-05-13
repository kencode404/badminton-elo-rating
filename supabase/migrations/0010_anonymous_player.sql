-- Anonymous player feature.
--
-- A single shared "Anonymous" profile that real players can pick when a
-- missing person needs filling in (e.g. a guest who isn't signed up).
-- Properties:
--   * Pickable multiple times in the same match (e.g. two anonymous
--     opponents on team B). Enforced via a slot column on
--     match_participants (PK becomes match_id, user_id, slot) plus a
--     partial unique index that still blocks duplicate REAL players.
--   * Auto-accepts on insert (a BEFORE INSERT trigger stamps
--     confirmation='accepted').
--   * Matches involving anonymous never auto-settle — they enter a
--     new 'awaiting_admin' status. An admin approves via the Apex
--     Command page, which runs the full ELO settlement. Reject just
--     marks the match rejected.
--   * Anonymous's rating doesn't move from match outcomes. After every
--     settle (and once at provisioning), refresh_anonymous_rating()
--     resets it to the average of all real, non-banned players who
--     have played at least one game in that mode. This makes
--     anonymous a neutral opponent in the ELO math.
--   * Anonymous is hidden from leaderboard / season-reset ranking and
--     cannot be banned.
--
-- Safe to rerun.

-- =========================================================================
-- 1. is_anonymous column on profiles
-- =========================================================================

alter table public.profiles
  add column if not exists is_anonymous boolean not null default false;

create index if not exists profiles_anonymous_idx
  on public.profiles (id) where is_anonymous = true;

-- =========================================================================
-- 2. slot column on match_participants
--    Old PK (match_id, user_id) blocks duplicate anonymous slots, so we
--    widen the PK to include slot. A partial unique index keeps the
--    "no duplicate real players in one match" invariant.
-- =========================================================================

alter table public.match_participants
  add column if not exists slot smallint not null default 0;

do $$ begin
  alter table public.match_participants
    drop constraint if exists match_participants_pkey;
exception when others then null;
end $$;

do $$ begin
  alter table public.match_participants
    add primary key (match_id, user_id, slot);
exception when invalid_table_definition then null;
       when duplicate_table then null;
end $$;

-- One row per real player per match. Anonymous (the only id that may
-- repeat) is exempted.
create unique index if not exists match_participants_unique_real_player
  on public.match_participants (match_id, user_id)
  where user_id <> '00000000-0000-0000-0000-000000000001'::uuid;

-- =========================================================================
-- 3. 'awaiting_admin' status value on match_status
-- =========================================================================

do $$ begin
  alter type match_status add value if not exists 'awaiting_admin';
exception when others then null;
end $$;

-- =========================================================================
-- 4. Anonymous backing account
--    Fixed UUID so the app can hard-code the reference. Created in
--    auth.users so the profiles FK to auth.users is satisfied; the
--    encrypted_password is a placeholder (never used for sign-in).
-- =========================================================================

create or replace function public.anonymous_user_id()
returns uuid
language sql
immutable
as $$
  select '00000000-0000-0000-0000-000000000001'::uuid;
$$;

grant execute on function public.anonymous_user_id() to authenticated, anon;

do $$
declare
  v_anon_id uuid := '00000000-0000-0000-0000-000000000001'::uuid;
begin
  if not exists (select 1 from auth.users where id = v_anon_id) then
    begin
      insert into auth.users (
        id, instance_id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data,
        is_super_admin, is_sso_user
      ) values (
        v_anon_id,
        '00000000-0000-0000-0000-000000000000'::uuid,
        'authenticated',
        'authenticated',
        'anonymous@badminton.local',
        '$2a$10$placeholderplaceholderplaceholderplaceholderplaceholder.x',
        now(),
        now(), now(),
        jsonb_build_object('provider', 'system'),
        jsonb_build_object('display_name', 'Anonymous'),
        false,
        false
      );
    exception when others then
      -- auth.users schema varies across Supabase versions; if the
      -- insert fails the admin can create the anonymous account
      -- manually via the dashboard with id = anonymous_user_id().
      raise notice 'Could not auto-create anonymous auth user: %', sqlerrm;
    end;
  end if;
end $$;

-- Ensure the profile row exists and is flagged. on_auth_user_created
-- from 0001 may have already auto-created it; this normalizes the
-- fields either way.
insert into public.profiles (id, display_name, is_anonymous)
values ('00000000-0000-0000-0000-000000000001'::uuid, 'Anonymous', true)
on conflict (id) do update
  set display_name = 'Anonymous',
      is_anonymous = true;

-- =========================================================================
-- 5. refresh_anonymous_rating — keeps anon at the club's average so it
--    plays as a neutral opponent in ELO math.
-- =========================================================================

create or replace function public.refresh_anonymous_rating()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  avg_s numeric;
  avg_d numeric;
begin
  select
    avg(singles_rating) filter (where singles_games_played > 0),
    avg(doubles_rating) filter (where doubles_games_played > 0)
    into avg_s, avg_d
  from public.profiles
  where is_anonymous = false
    and is_banned = false;

  update public.profiles
     set singles_rating = coalesce(round(avg_s)::int, 1000),
         doubles_rating = coalesce(round(avg_d)::int, 1000)
   where id = public.anonymous_user_id();
end;
$$;

grant execute on function public.refresh_anonymous_rating() to authenticated;

select public.refresh_anonymous_rating();

-- =========================================================================
-- 6. Auto-accept anonymous slots on insert
-- =========================================================================

create or replace function public.auto_accept_anonymous()
returns trigger
language plpgsql
as $$
begin
  if new.user_id = public.anonymous_user_id() then
    new.confirmation := 'accepted';
    new.responded_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_auto_accept_anonymous on public.match_participants;
create trigger trg_auto_accept_anonymous
  before insert on public.match_participants
  for each row execute function public.auto_accept_anonymous();

-- =========================================================================
-- 7. Refactor settle_match
--    settle_match now detects anonymous-tainted matches and routes them
--    to 'awaiting_admin' instead of confirming. _settle_match_elo holds
--    the actual ELO arithmetic and is shared between the normal flow
--    and the admin-approval path.
-- =========================================================================

create or replace function public._settle_match_elo(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  k_provisional constant int := 40;
  k_established constant int := 24;
  provisional_games constant int := 5;
  elo_divisor constant numeric := 400;
  margin_deadband constant int := 2;
  margin_divisor constant numeric := 21;
  margin_max_mult constant numeric := 2;
  v_anon uuid := public.anonymous_user_id();
  rating_a numeric;
  rating_b numeric;
  expected_a numeric;
  expected_b numeric;
  actual_a numeric;
  actual_b numeric;
  rating_col text;
  games_col text;
  peak_col text;
  participant record;
  current_rating int;
  current_games int;
  base_k int;
  effective_k numeric;
  team_actual numeric;
  team_expected numeric;
  delta int;
  score_diff int;
  margin_mult numeric;
  winning_team match_team;
begin
  select * into m from public.matches where id = p_match_id for update;
  if not found then
    return;
  end if;

  if m.match_type = 'singles' then
    rating_col := 'singles_rating';
    games_col := 'singles_games_played';
    peak_col := 'peak_singles_rating';
  else
    rating_col := 'doubles_rating';
    games_col := 'doubles_games_played';
    peak_col := 'peak_doubles_rating';
  end if;

  -- Team mean ratings — anonymous's rating (= club average) is included
  -- naturally because it's a real number on the profile row.
  execute format(
    'select avg(p.%I)::numeric
       from public.match_participants mp
       join public.profiles p on p.id = mp.user_id
      where mp.match_id = $1 and mp.team = $2::match_team',
    rating_col
  ) using p_match_id, 'A' into rating_a;

  execute format(
    'select avg(p.%I)::numeric
       from public.match_participants mp
       join public.profiles p on p.id = mp.user_id
      where mp.match_id = $1 and mp.team = $2::match_team',
    rating_col
  ) using p_match_id, 'B' into rating_b;

  expected_a := 1 / (1 + power(10, (rating_b - rating_a) / elo_divisor));
  expected_b := 1 - expected_a;

  if m.score_a > m.score_b then
    actual_a := 1; actual_b := 0;
    winning_team := 'A';
  else
    actual_a := 0; actual_b := 1;
    winning_team := 'B';
  end if;

  score_diff := abs(m.score_a - m.score_b);
  margin_mult := least(
    margin_max_mult,
    1 + greatest(0, score_diff - margin_deadband)::numeric / margin_divisor
  );

  -- Loop every slot. Anonymous slots: stamp rating_before/after/delta
  -- = (current, current, 0) so the participant row is consistent, but
  -- skip the profile update — anonymous's rating is recomputed at the
  -- end via refresh_anonymous_rating().
  for participant in
    select user_id, team, slot
      from public.match_participants
     where match_id = p_match_id
  loop
    execute format('select %I, %I from public.profiles where id = $1', rating_col, games_col)
      using participant.user_id into current_rating, current_games;

    if participant.user_id = v_anon then
      update public.match_participants
         set rating_before = current_rating,
             rating_after = current_rating,
             rating_delta = 0
       where match_id = p_match_id
         and user_id = participant.user_id
         and slot = participant.slot;
      continue;
    end if;

    base_k := case when current_games < provisional_games then k_provisional else k_established end;

    if participant.team = winning_team then
      effective_k := base_k * margin_mult;
    else
      effective_k := base_k;
    end if;

    if participant.team = 'A' then
      team_actual := actual_a; team_expected := expected_a;
    else
      team_actual := actual_b; team_expected := expected_b;
    end if;

    delta := round(effective_k * (team_actual - team_expected));

    update public.match_participants
       set rating_before = current_rating,
           rating_after = current_rating + delta,
           rating_delta = delta
     where match_id = p_match_id
       and user_id = participant.user_id
       and slot = participant.slot;

    execute format(
      'update public.profiles
          set %I = %I + $1,
              %I = %I + 1,
              %I = greatest(%I, %I + $1)
        where id = $2',
      rating_col, rating_col,
      games_col, games_col,
      peak_col, peak_col, rating_col
    ) using delta, participant.user_id;
  end loop;

  update public.matches
     set status = 'confirmed', confirmed_at = now(), elo_version = 2
   where id = p_match_id;

  -- Anonymous's rating drifts with the club average. Recompute after
  -- every settlement so the next match using anonymous uses the
  -- up-to-date avg.
  perform public.refresh_anonymous_rating();
end;
$$;

create or replace function public.settle_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  has_anon boolean;
begin
  select * into m from public.matches where id = p_match_id for update;
  if not found or m.status <> 'pending' then
    return;
  end if;

  -- One acceptance per team is enough. Bail if either side has none.
  if not exists (
    select 1 from public.match_participants
     where match_id = p_match_id and team = 'A' and confirmation = 'accepted'
  ) or not exists (
    select 1 from public.match_participants
     where match_id = p_match_id and team = 'B' and confirmation = 'accepted'
  ) then
    return;
  end if;

  -- Anonymous-tainted? Park for admin approval — the extra layer is
  -- specifically to prevent abuse of the auto-accept flow.
  select exists (
    select 1 from public.match_participants
     where match_id = p_match_id
       and user_id = public.anonymous_user_id()
  ) into has_anon;

  if has_anon then
    update public.matches
       set status = 'awaiting_admin'
     where id = p_match_id;
    return;
  end if;

  perform public._settle_match_elo(p_match_id);
end;
$$;

-- =========================================================================
-- 8. Admin approve / reject RPCs
-- =========================================================================

create or replace function public.approve_anonymous_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean;
  v_status match_status;
begin
  select is_admin into v_admin
    from public.profiles where id = auth.uid();
  if not coalesce(v_admin, false) then
    raise exception 'Only admins can approve matches';
  end if;

  select status into v_status
    from public.matches where id = p_match_id for update;
  if v_status is null then
    raise exception 'Match not found';
  end if;
  if v_status <> 'awaiting_admin' then
    raise exception 'Match is not awaiting admin approval';
  end if;

  perform public._settle_match_elo(p_match_id);
end;
$$;

grant execute on function public.approve_anonymous_match(uuid) to authenticated;

create or replace function public.reject_anonymous_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean;
  v_status match_status;
begin
  select is_admin into v_admin
    from public.profiles where id = auth.uid();
  if not coalesce(v_admin, false) then
    raise exception 'Only admins can reject matches';
  end if;

  select status into v_status
    from public.matches where id = p_match_id for update;
  if v_status is null then
    raise exception 'Match not found';
  end if;
  if v_status <> 'awaiting_admin' then
    raise exception 'Match is not awaiting admin approval';
  end if;

  update public.matches
     set status = 'rejected'
   where id = p_match_id;
end;
$$;

grant execute on function public.reject_anonymous_match(uuid) to authenticated;

-- =========================================================================
-- 9. RLS — admins need to read awaiting-admin matches + participants
--    even when not a participant themselves.
-- =========================================================================

create or replace function public.is_caller_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_admin from public.profiles where id = auth.uid()),
    false
  );
$$;

grant execute on function public.is_caller_admin() to authenticated;

drop policy if exists "Matches visible to participants" on public.matches;
create policy "Matches visible to participants"
  on public.matches for select
  to authenticated
  using (
    auth.uid() = created_by
    or public.is_match_participant(id, auth.uid())
    or public.is_caller_admin()
  );

drop policy if exists "Participants visible to involved users" on public.match_participants;
create policy "Participants visible to involved users"
  on public.match_participants for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_match_participant(match_id, auth.uid())
    or exists (
      select 1 from public.matches m
       where m.id = match_participants.match_id and m.created_by = auth.uid()
    )
    or public.is_caller_admin()
  );

-- =========================================================================
-- 10. Anti-foot-gun guards
-- =========================================================================

-- ban_user must refuse the anonymous account.
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
  v_target_anon boolean;
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
  if p_target_id = public.anonymous_user_id() then
    raise exception 'You cannot ban the anonymous player';
  end if;

  select is_admin, is_anonymous into v_target_admin, v_target_anon
    from public.profiles
   where id = p_target_id;
  if coalesce(v_target_admin, false) then
    raise exception 'You cannot ban another admin';
  end if;
  if coalesce(v_target_anon, false) then
    raise exception 'You cannot ban the anonymous player';
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

  -- The newly-banned player drops out of the active pool, which can
  -- shift the club average. Recompute anonymous's rating so the next
  -- match using anon prices it correctly.
  perform public.refresh_anonymous_rating();
end;
$$;

grant execute on function public.ban_user(uuid, text) to authenticated;

-- unban_user — same refresh reasoning. Override the version from 0008.
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

  perform public.refresh_anonymous_rating();
end;
$$;

grant execute on function public.unban_user(uuid) to authenticated;

-- =========================================================================
-- 11. update_pending_match — relax uniqueness for anonymous
-- =========================================================================

create or replace function public.update_pending_match(
  p_match_id uuid,
  p_partner_id uuid,
  p_opponent_ids uuid[],
  p_score_a int,
  p_score_b int
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  v_caller uuid := auth.uid();
  v_anon uuid := public.anonymous_user_id();
  v_idx int;
  v_oid uuid;
  v_slot_counter jsonb := '{}'::jsonb;
  v_slot int;
begin
  select * into m from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'Match not found';
  end if;
  if m.created_by <> v_caller then
    raise exception 'Only the match creator can edit it';
  end if;
  if m.status <> 'pending' then
    raise exception 'Match is no longer pending';
  end if;

  if exists (
    select 1 from public.match_participants
     where match_id = p_match_id
       and user_id <> v_caller
       and confirmation = 'accepted'
       and user_id <> v_anon
  ) then
    raise exception 'Cannot edit — another player has already accepted';
  end if;

  if p_score_a is null or p_score_b is null then
    raise exception 'Scores are required';
  end if;
  if p_score_a < 0 or p_score_b < 0 then
    raise exception 'Scores cannot be negative';
  end if;
  if p_score_a = p_score_b then
    raise exception 'Scores cannot be tied';
  end if;

  if m.match_type = 'singles' then
    if p_partner_id is not null then
      raise exception 'Singles has no partner';
    end if;
    if coalesce(array_length(p_opponent_ids, 1), 0) <> 1 then
      raise exception 'Singles needs exactly 1 opponent';
    end if;
  else
    if p_partner_id is null then
      raise exception 'Doubles needs a partner';
    end if;
    if coalesce(array_length(p_opponent_ids, 1), 0) <> 2 then
      raise exception 'Doubles needs exactly 2 opponents';
    end if;

    -- Uniqueness check excludes anonymous — it may legitimately
    -- appear in multiple slots.
    if (
      select count(*) from (
        select id
          from unnest(array[v_caller, p_partner_id] || p_opponent_ids) as id
         where id <> v_anon
        group by id
        having count(*) > 1
      ) dups
    ) > 0 then
      raise exception 'Players must be unique';
    end if;
  end if;

  update public.matches
     set score_a = p_score_a,
         score_b = p_score_b
   where id = p_match_id;

  delete from public.match_participants where match_id = p_match_id;

  -- Re-insert with slot indices. Slot starts at 0 for each user_id and
  -- increments per duplicate (only anonymous can duplicate). Anonymous
  -- rows auto-accept via the BEFORE INSERT trigger.
  insert into public.match_participants (match_id, user_id, team, slot, confirmation)
  values (p_match_id, v_caller, 'A', 0, 'accepted');

  if m.match_type = 'doubles' then
    v_slot := case when p_partner_id = v_anon then 0 else 0 end;
    insert into public.match_participants (match_id, user_id, team, slot, confirmation)
    values (p_match_id, p_partner_id, 'A', v_slot, 'pending');
    if p_partner_id = v_anon then
      v_slot_counter := jsonb_set(
        v_slot_counter, array[v_anon::text], to_jsonb(1)
      );
    end if;
  end if;

  v_idx := 0;
  foreach v_oid in array p_opponent_ids loop
    if v_oid = v_anon then
      v_slot := coalesce((v_slot_counter->>v_anon::text)::int, 0);
      v_slot_counter := jsonb_set(
        v_slot_counter, array[v_anon::text], to_jsonb(v_slot + 1)
      );
    else
      v_slot := 0;
    end if;
    insert into public.match_participants (match_id, user_id, team, slot, confirmation)
    values (p_match_id, v_oid, 'B', v_slot, 'pending');
    v_idx := v_idx + 1;
  end loop;
end;
$$;

grant execute on function public.update_pending_match(uuid, uuid, uuid[], int, int) to authenticated;

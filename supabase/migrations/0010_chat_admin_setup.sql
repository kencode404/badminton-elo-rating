-- Wires up the moderation chat announcements added in 0009:
--   * Updates the chat_messages check constraint to permit the two
--     new kinds (each requires user_id + body).
--   * Replaces ban_user() so it inserts a small grey "X banned by Y"
--     log line at the end. unban is intentionally silent.
--   * Replaces reset_season() so it inserts a "Season N reset by Y"
--     announcement at the end. The streak/tier-up cleanup inside
--     reset_season is unchanged (those kinds are still cleared);
--     the new season_reset / user_banned messages are NOT cleared on
--     reset — they expire naturally after 30 days.
--
-- Safe to rerun.

-- =========================================================================
-- 1. Check constraint covering all six kinds
-- =========================================================================

alter table public.chat_messages
  drop constraint if exists chat_messages_check;

alter table public.chat_messages
  add constraint chat_messages_check check (
    (kind = 'system_streak'
      and user_id is not null
      and match_type is not null
      and streak_count is not null
      and streak_count >= 2)
    or (kind = 'system_tier_up'
      and user_id is not null
      and match_type is not null
      and tier_key in ('bronze', 'silver', 'gold', 'diamond', 'predator'))
    or (kind = 'system_streak_ended'
      and user_id is not null
      and match_type is not null
      and streak_count is not null
      and streak_count >= 2
      and breaker_user_ids is not null
      and array_length(breaker_user_ids, 1) >= 1)
    or (kind = 'system_season_reset'
      and user_id is not null
      and body is not null
      and length(trim(body)) > 0)
    or (kind = 'system_user_banned'
      and user_id is not null
      and body is not null
      and length(trim(body)) > 0)
    or (kind = 'user'
      and user_id is not null
      and body is not null
      and length(trim(body)) > 0)
  );

-- =========================================================================
-- 2. ban_user — emit a moderation log line at the end
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

-- =========================================================================
-- 3. reset_season — emit a moderation log line at the end
-- =========================================================================

create or replace function public.reset_season()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean;
  v_admin_name text;
  v_current_season int;
  v_next_season int;
begin
  select is_admin, display_name into v_admin, v_admin_name
    from public.profiles
   where id = auth.uid();
  if not coalesce(v_admin, false) then
    raise exception 'Only admins can reset the season';
  end if;

  select coalesce(max(number), 1) into v_current_season
    from public.seasons;

  v_next_season := v_current_season + 1;

  with singles_ranked as (
    select id,
      row_number() over (
        order by singles_rating desc, singles_games_played desc
      )::int as rank
      from public.profiles
     where singles_games_played > 0
       and is_banned = false
  ),
  doubles_ranked as (
    select id,
      row_number() over (
        order by doubles_rating desc, doubles_games_played desc
      )::int as rank
      from public.profiles
     where doubles_games_played > 0
       and is_banned = false
  )
  insert into public.season_snapshots
    (user_id, season_number, singles_rating, doubles_rating,
     singles_games_played, doubles_games_played,
     singles_wins, doubles_wins,
     singles_rank, doubles_rank)
  select
    p.id,
    v_current_season,
    p.singles_rating,
    p.doubles_rating,
    p.singles_games_played,
    p.doubles_games_played,
    coalesce(sw.singles_wins, 0),
    coalesce(sw.doubles_wins, 0),
    sr.rank,
    dr.rank
  from public.profiles p
  left join singles_ranked sr on sr.id = p.id
  left join doubles_ranked dr on dr.id = p.id
  left join lateral (
    select
      coalesce(sum(case
        when m.match_type = 'singles'
         and ((mp.team = 'A' and m.score_a > m.score_b)
              or (mp.team = 'B' and m.score_b > m.score_a))
        then 1 else 0 end), 0)::int as singles_wins,
      coalesce(sum(case
        when m.match_type = 'doubles'
         and ((mp.team = 'A' and m.score_a > m.score_b)
              or (mp.team = 'B' and m.score_b > m.score_a))
        then 1 else 0 end), 0)::int as doubles_wins
    from public.match_participants mp
    join public.matches m on m.id = mp.match_id
    where mp.user_id = p.id
      and m.status = 'confirmed'
      and m.played_at >= (
        select started_at from public.seasons where number = v_current_season
      )
  ) sw on true;

  insert into public.seasons (number, started_at)
  values (v_next_season, now());

  update public.profiles
     set singles_rating = 1000,
         doubles_rating = 1000,
         singles_games_played = 0,
         doubles_games_played = 0;

  -- Stale match-derived announcements go; ban / reset moderation logs
  -- are kept (they expire on their own 30-day timer).
  delete from public.chat_messages
   where kind in ('system_streak', 'system_tier_up', 'system_streak_ended');

  delete from public.season_snapshots
   where season_number <= v_current_season - 5;

  -- Drop the moderation log line announcing this reset.
  insert into public.chat_messages
    (kind, user_id, body, expires_at)
  values (
    'system_season_reset',
    auth.uid(),
    'Season ' || v_current_season || ' reset by ' ||
      coalesce(v_admin_name, 'admin'),
    now() + interval '30 days'
  );

  return v_next_season;
end;
$$;

-- Season-reset infrastructure.
--
-- The `seasons` table itself lives in 0001 (foundational — referenced
-- by streak/win helpers in 0003). This file adds:
--
--   * season_snapshots (one row per user per archived season): final
--     rating, games, wins, and rank per mode
--   * reset_season() RPC: admin-only — snapshots every profile, opens
--     the next season, resets ratings to 1000 / games to 0, deletes
--     stale system announcements, trims snapshots older than 5 seasons
--   * one-shot grant making khieng96@gmail.com an admin
--
-- Safe to rerun. To grant another email later:
--   update public.badminton_profiles
--      set is_admin = true
--    where id = (select id from auth.users where email = 'YOUR_EMAIL');

-- =========================================================================
-- 1. season_snapshots
-- =========================================================================

create table if not exists public.badminton_season_snapshots (
  user_id uuid not null references public.badminton_profiles(id) on delete cascade,
  season_number int not null references public.badminton_seasons(number) on delete cascade,
  archived_at timestamptz not null default now(),
  singles_rating int not null,
  doubles_rating int not null,
  singles_games_played int not null,
  doubles_games_played int not null,
  singles_wins int not null default 0,
  doubles_wins int not null default 0,
  -- Final rank within the closing season for each mode. Null if the
  -- player didn't play any matches in that mode.
  singles_rank int,
  doubles_rank int,
  primary key (user_id, season_number)
);

create index if not exists badminton_season_snapshots_user_idx
  on public.badminton_season_snapshots (user_id, season_number desc);

alter table public.badminton_season_snapshots enable row level security;

drop policy if exists "Snapshots readable by all" on public.badminton_season_snapshots;
create policy "Snapshots readable by all"
  on public.badminton_season_snapshots for select
  to authenticated using (true);

-- No insert/update/delete policies — only the SECURITY DEFINER
-- reset_season() function below writes here.

-- =========================================================================
-- 2. reset_season()
-- =========================================================================

create or replace function public.badminton_reset_season()
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
  -- Auth: caller must be an admin
  select is_admin, display_name into v_admin, v_admin_name
    from public.badminton_profiles
   where id = auth.uid();
  if not coalesce(v_admin, false) then
    raise exception 'Only admins can reset the season';
  end if;

  -- Current season is the row we're about to archive
  select coalesce(max(number), 1) into v_current_season
    from public.badminton_seasons;

  v_next_season := v_current_season + 1;

  -- Snapshot every profile into the season we're closing. Wins are
  -- derived from match_participants for matches confirmed within the
  -- current season window. Ranks are row_number() over the rating
  -- column per mode, restricted to players who actually played that
  -- mode AND aren't banned (so banned players get null rank).
  with singles_ranked as (
    select id,
      row_number() over (
        order by singles_rating desc, singles_games_played desc
      )::int as rank
      from public.badminton_profiles
     where singles_games_played > 0
       and is_banned = false
  ),
  doubles_ranked as (
    select id,
      row_number() over (
        order by doubles_rating desc, doubles_games_played desc
      )::int as rank
      from public.badminton_profiles
     where doubles_games_played > 0
       and is_banned = false
  )
  insert into public.badminton_season_snapshots
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
  from public.badminton_profiles p
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
    from public.badminton_match_participants mp
    join public.badminton_matches m on m.id = mp.match_id
    where mp.user_id = p.id
      and m.status = 'confirmed'
      and m.played_at >= (
        select started_at from public.badminton_seasons where number = v_current_season
      )
  ) sw on true;

  -- Open the new season
  insert into public.badminton_seasons (number, started_at)
  values (v_next_season, now());

  -- Reset every profile's season-state — including banned users (the
  -- is_banned flag itself is intentionally left untouched).
  update public.badminton_profiles
     set singles_rating = 1000,
         doubles_rating = 1000,
         singles_games_played = 0,
         doubles_games_played = 0;

  -- Stale match-derived announcements go; the season-reset moderation
  -- log line we insert below is kept (it has its own 30-day timer).
  delete from public.badminton_chat_messages
   where kind in ('system_streak', 'system_tier_up', 'system_streak_ended');

  -- Keep only the five most recent past seasons. Older snapshots are
  -- dropped so the Past Seasons Record list stays focused.
  delete from public.badminton_season_snapshots
   where season_number <= v_current_season - 5;

  -- Drop the moderation log line announcing this reset.
  insert into public.badminton_chat_messages
    (kind, user_id, body, expires_at)
  values (
    'system_season_reset',
    auth.uid(),
    'Season ' || v_current_season || ' reset by ' ||
      coalesce(v_admin_name, 'admin') ||
      ', welcome to Season ' || v_next_season,
    now() + interval '30 days'
  );

  -- The anonymous player's rating tracks the club average. After
  -- everyone is reset to 1000 / 0 games, anonymous should be too.
  -- Function lives in 0010_anonymous_player.sql; if not yet applied
  -- this raises at runtime — swallow it so a partial migration set
  -- can still reset seasons.
  begin
    perform public.badminton_refresh_anonymous_rating();
  exception when undefined_function then null;
  end;

  return v_next_season;
end;
$$;

grant execute on function public.badminton_reset_season() to authenticated;

-- =========================================================================
-- 3. Backfill peak ratings from any historical snapshots
--
-- badminton_profiles.peak_X_rating defaults to 1000 and is bumped by settle_match
-- going forward. For prod that already has past-season snapshots with
-- higher ratings, ratchet the peak from those rows once. Idempotent —
-- subsequent runs are a no-op because greatest() is monotonic.
-- =========================================================================

update public.badminton_profiles p
   set peak_singles_rating = greatest(
         p.peak_singles_rating,
         coalesce((
           select max(s.singles_rating)
             from public.badminton_season_snapshots s
            where s.user_id = p.id
         ), 0)
       ),
       peak_doubles_rating = greatest(
         p.peak_doubles_rating,
         coalesce((
           select max(s.doubles_rating)
             from public.badminton_season_snapshots s
            where s.user_id = p.id
         ), 0)
       );

-- =========================================================================
-- 4. Grant admin to khieng96@gmail.com (idempotent)
-- =========================================================================

update public.badminton_profiles
   set is_admin = true
 where id in (
   select id from auth.users where email = 'khieng96@gmail.com'
 );

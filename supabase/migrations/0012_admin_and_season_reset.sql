-- Season reset infrastructure.
--
-- Adds:
--   * profiles.is_admin (per-user admin flag — defaults false)
--   * seasons table (latest row = current season; started_at is the
--                    cutoff for "current season" match queries)
--   * season_snapshots table (one row per user per archived season,
--                             written by reset_season())
--   * reset_season() RPC, callable by admins only
--   * streak SQL functions are rewritten to filter matches by the
--     current season's started_at so post-reset streak counts don't
--     carry over from the previous season.
--
-- Safe to rerun.
--
-- After running, the admin (khieng96@gmail.com) is granted admin
-- automatically below. To grant another email later:
--   update public.profiles
--      set is_admin = true
--    where id = (select id from auth.users where email = 'YOUR_EMAIL');

-- =========================================================================
-- 1. Admin flag
-- =========================================================================

alter table public.profiles
  add column if not exists is_admin boolean not null default false;

-- =========================================================================
-- 2. Seasons + snapshots
-- =========================================================================

create table if not exists public.seasons (
  number int primary key,
  started_at timestamptz not null default now()
);

-- Seed season 1 with a far-past start so every existing match counts
-- as belonging to the current season. Subsequent reset_season() calls
-- insert season 2, 3, … with started_at = now().
insert into public.seasons (number, started_at)
select 1, '1970-01-01'::timestamptz
 where not exists (select 1 from public.seasons);

create table if not exists public.season_snapshots (
  user_id uuid not null references public.profiles(id) on delete cascade,
  season_number int not null references public.seasons(number) on delete cascade,
  archived_at timestamptz not null default now(),
  singles_rating int not null,
  doubles_rating int not null,
  singles_games_played int not null,
  doubles_games_played int not null,
  singles_wins int not null default 0,
  doubles_wins int not null default 0,
  -- Final-rank within the closing season for each mode. Null if the
  -- player didn't play any matches in that mode.
  singles_rank int,
  doubles_rank int,
  primary key (user_id, season_number)
);

create index if not exists season_snapshots_user_idx
  on public.season_snapshots (user_id, season_number desc);

-- =========================================================================
-- 3. RLS — both tables readable by all signed-in users
-- =========================================================================

alter table public.seasons enable row level security;

drop policy if exists "Seasons readable by all" on public.seasons;
create policy "Seasons readable by all"
  on public.seasons for select
  to authenticated using (true);

alter table public.season_snapshots enable row level security;

drop policy if exists "Snapshots readable by all" on public.season_snapshots;
create policy "Snapshots readable by all"
  on public.season_snapshots for select
  to authenticated using (true);

-- No insert/update/delete policies — only SECURITY DEFINER functions
-- (reset_season) write to these tables.

-- =========================================================================
-- 4. reset_season()
-- =========================================================================

create or replace function public.reset_season()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean;
  v_current_season int;
  v_next_season int;
begin
  -- Auth: caller must be an admin
  select is_admin into v_admin
    from public.profiles
   where id = auth.uid();
  if not coalesce(v_admin, false) then
    raise exception 'Only admins can reset the season';
  end if;

  -- Current season is the row we're about to archive
  select coalesce(max(number), 1) into v_current_season
    from public.seasons;

  v_next_season := v_current_season + 1;

  -- Snapshot every profile into the season we're closing. Wins are
  -- derived from match_participants for matches confirmed within the
  -- current season window. Ranks are row_number() over the rating
  -- column per mode, restricted to players who actually played that
  -- mode (so non-players get null rank instead of being lumped at
  -- the bottom).
  with singles_ranked as (
    select id,
      row_number() over (
        order by singles_rating desc, singles_games_played desc
      )::int as rank
      from public.profiles
     where singles_games_played > 0
  ),
  doubles_ranked as (
    select id,
      row_number() over (
        order by doubles_rating desc, doubles_games_played desc
      )::int as rank
      from public.profiles
     where doubles_games_played > 0
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

  -- Open the new season
  insert into public.seasons (number, started_at)
  values (v_next_season, now());

  -- Reset every profile to fresh-start state
  update public.profiles
     set singles_rating = 1000,
         doubles_rating = 1000,
         singles_games_played = 0,
         doubles_games_played = 0;

  -- Clear stale system announcements (they reference last season's
  -- streaks and tier crossings). User chat is preserved.
  delete from public.chat_messages
   where kind in ('system_streak', 'system_tier_up', 'system_streak_ended');

  -- Keep only the five most recent past seasons. Older snapshots
  -- are dropped so the Past Seasons Record list stays focused.
  delete from public.season_snapshots
   where season_number <= v_current_season - 5;

  return v_next_season;
end;
$$;

grant execute on function public.reset_season() to authenticated;

-- =========================================================================
-- 5. Rewrite streak SQL helpers to filter by current season start
-- =========================================================================

create or replace function public.current_streak_for_user_mode(
  p_user_id uuid,
  p_match_type match_type
)
returns int
language sql
stable
security definer
set search_path = public
as $$
  with season_start as (
    select started_at from public.seasons
     order by number desc
     limit 1
  ),
  ordered as (
    select
      m.played_at,
      case
        when (mp.team = 'A' and m.score_a > m.score_b)
          or (mp.team = 'B' and m.score_b > m.score_a)
        then 1
        else 0
      end as is_win
    from public.match_participants mp
    join public.matches m on m.id = mp.match_id
    where mp.user_id = p_user_id
      and m.match_type = p_match_type
      and m.status = 'confirmed'
      and m.played_at >= (select started_at from season_start)
  ),
  with_loss as (
    select
      is_win,
      sum(1 - is_win) over (
        order by played_at desc
        rows between unbounded preceding and current row
      ) as losses_so_far
    from ordered
  )
  select coalesce(count(*) filter (where is_win = 1 and losses_so_far = 0), 0)::int
    from with_loss;
$$;

drop function if exists public.get_win_streaks();
create or replace function public.get_win_streaks()
returns table (
  user_id uuid,
  singles_streak int,
  doubles_streak int
)
language sql
stable
security definer
set search_path = public
as $$
  with season_start as (
    select started_at from public.seasons order by number desc limit 1
  ),
  ordered as (
    select
      mp.user_id,
      m.match_type,
      m.played_at,
      case
        when (mp.team = 'A' and m.score_a > m.score_b)
          or (mp.team = 'B' and m.score_b > m.score_a)
        then 1
        else 0
      end as is_win
    from public.match_participants mp
    join public.matches m on m.id = mp.match_id
    where m.status = 'confirmed'
      and m.played_at >= (select started_at from season_start)
  ),
  with_loss_count as (
    select
      user_id,
      match_type,
      is_win,
      sum(1 - is_win) over (
        partition by user_id, match_type
        order by played_at desc
        rows between unbounded preceding and current row
      ) as losses_so_far
    from ordered
  ),
  streaks_by_mode as (
    select
      user_id,
      match_type,
      count(*) filter (where is_win = 1 and losses_so_far = 0)::int as streak
    from with_loss_count
    group by user_id, match_type
  )
  select
    user_id,
    coalesce(max(streak) filter (where match_type = 'singles'), 0)::int as singles_streak,
    coalesce(max(streak) filter (where match_type = 'doubles'), 0)::int as doubles_streak
    from streaks_by_mode
   group by user_id;
$$;

grant execute on function public.get_win_streaks() to authenticated;

-- get_user_win_counts (used by Profile + ProfileDetailModal) also
-- filters to current season so the win-rate display matches the
-- current-season ratings shown beside it.
create or replace function public.get_user_win_counts(p_user_id uuid)
returns table (singles_wins int, doubles_wins int)
language sql
stable
security definer
set search_path = public
as $$
  with season_start as (
    select started_at from public.seasons order by number desc limit 1
  )
  select
    coalesce(
      sum(case
        when (mp.team = 'A' and m.score_a > m.score_b)
          or (mp.team = 'B' and m.score_b > m.score_a)
        then 1 else 0 end
      ) filter (where m.match_type = 'singles'),
      0
    )::int as singles_wins,
    coalesce(
      sum(case
        when (mp.team = 'A' and m.score_a > m.score_b)
          or (mp.team = 'B' and m.score_b > m.score_a)
        then 1 else 0 end
      ) filter (where m.match_type = 'doubles'),
      0
    )::int as doubles_wins
  from public.match_participants mp
  join public.matches m on m.id = mp.match_id
  where mp.user_id = p_user_id
    and m.status = 'confirmed'
    and m.played_at >= (select started_at from season_start);
$$;

grant execute on function public.get_user_win_counts(uuid) to authenticated;

-- streak_before_match (used by the streak-broken trigger) also needs
-- the cutoff; otherwise a player who just won a match in the new
-- season after a 4-win streak in the old season would wrongly trigger
-- a "streak ended" announcement.
create or replace function public.streak_before_match(
  p_user_id uuid,
  p_mode match_type,
  p_match_id uuid
) returns int
language plpgsql
stable
as $$
declare
  ref_played_at timestamptz;
  v_season_start timestamptz;
  total int := 0;
  rec record;
begin
  select played_at into ref_played_at
    from public.matches
   where id = p_match_id;
  if ref_played_at is null then
    return 0;
  end if;

  select started_at into v_season_start
    from public.seasons
   order by number desc
   limit 1;

  for rec in
    select
      case when (mp.team = 'A' and m.score_a > m.score_b)
            or (mp.team = 'B' and m.score_b > m.score_a)
           then 1 else 0 end as won
    from public.matches m
    join public.match_participants mp on mp.match_id = m.id
    where mp.user_id = p_user_id
      and m.match_type = p_mode
      and m.status = 'confirmed'
      and m.id <> p_match_id
      and m.played_at < ref_played_at
      and m.played_at >= v_season_start
    order by m.played_at desc, m.id desc
  loop
    if rec.won = 1 then
      total := total + 1;
    else
      exit;
    end if;
  end loop;

  return total;
end;
$$;

-- =========================================================================
-- 6. Grant admin to khieng96@gmail.com (idempotent)
-- =========================================================================

update public.profiles
   set is_admin = true
 where id in (
   select id from auth.users where email = 'khieng96@gmail.com'
 );

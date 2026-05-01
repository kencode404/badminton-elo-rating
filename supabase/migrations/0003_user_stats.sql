-- Per-user stats RPCs used by the leaderboard, profile page, and
-- profile-detail modal. All SECURITY DEFINER so they can read across
-- match_participants without tripping its RLS.
--
-- Folds together the original 0006_win_streaks.sql, 0007_user_stats.sql,
-- and the current_streak_for_user_mode helper from 0008.
-- Safe to rerun.

-- =========================================================================
-- 1. Per-mode current win streak (single user)
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
  with ordered as (
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

grant execute on function public.current_streak_for_user_mode(uuid, match_type) to authenticated;

-- =========================================================================
-- 2. Per-mode win streaks for all users (leaderboard fire-halo badge)
-- =========================================================================

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
  with ordered as (
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

-- =========================================================================
-- 3. Confirmed wins by mode (single user) — drives the win-rate display
-- =========================================================================

create or replace function public.get_user_win_counts(p_user_id uuid)
returns table (singles_wins int, doubles_wins int)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(
      sum(
        case
          when (mp.team = 'A' and m.score_a > m.score_b)
            or (mp.team = 'B' and m.score_b > m.score_a)
          then 1
          else 0
        end
      ) filter (where m.match_type = 'singles'),
      0
    )::int as singles_wins,
    coalesce(
      sum(
        case
          when (mp.team = 'A' and m.score_a > m.score_b)
            or (mp.team = 'B' and m.score_b > m.score_a)
          then 1
          else 0
        end
      ) filter (where m.match_type = 'doubles'),
      0
    )::int as doubles_wins
  from public.match_participants mp
  join public.matches m on m.id = mp.match_id
  where mp.user_id = p_user_id and m.status = 'confirmed';
$$;

grant execute on function public.get_user_win_counts(uuid) to authenticated;

-- =========================================================================
-- 4. Recent confirmed matches for a user (profile detail modal)
-- =========================================================================

create or replace function public.get_recent_matches(
  p_user_id uuid,
  p_limit int default 5
)
returns table (
  match_id uuid,
  match_type match_type,
  played_at timestamptz,
  user_team match_team,
  score_a int,
  score_b int,
  rating_delta int,
  others jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.id as match_id,
    m.match_type,
    m.played_at,
    mp.team as user_team,
    m.score_a,
    m.score_b,
    mp.rating_delta,
    (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', mp2.user_id,
        'display_name', p2.display_name,
        'team', mp2.team
      ) order by mp2.team, p2.display_name), '[]'::jsonb)
      from public.match_participants mp2
      join public.profiles p2 on p2.id = mp2.user_id
      where mp2.match_id = m.id and mp2.user_id <> p_user_id
    ) as others
  from public.match_participants mp
  join public.matches m on m.id = mp.match_id
  where mp.user_id = p_user_id and m.status = 'confirmed'
  order by m.played_at desc
  limit p_limit;
$$;

grant execute on function public.get_recent_matches(uuid, int) to authenticated;

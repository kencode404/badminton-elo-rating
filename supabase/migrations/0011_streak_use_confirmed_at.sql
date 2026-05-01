-- Switch streak computation from played_at to confirmed_at ordering.
--
-- The streak counted "consecutive wins from the user's most recent
-- confirmed match", but ordered by played_at — the timestamp set when
-- the match was created. That meant a match played earlier and
-- confirmed late could retroactively shift current streaks. Confusing.
--
-- Reorder by confirmed_at instead so a streak only ever grows when a
-- new match becomes confirmed; a late-confirmed older match counts as
-- the latest event in the timeline. confirmed_at is non-null on rows
-- with status='confirmed', so it's safe.
--
-- Updates: current_streak_for_user_mode (chat trigger) and
-- get_win_streaks (leaderboard badge). Safe to rerun.

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
      m.confirmed_at,
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
        order by confirmed_at desc nulls last
        rows between unbounded preceding and current row
      ) as losses_so_far
    from ordered
  )
  select coalesce(count(*) filter (where is_win = 1 and losses_so_far = 0), 0)::int
  from with_loss;
$$;

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
      m.confirmed_at,
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
        order by confirmed_at desc nulls last
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

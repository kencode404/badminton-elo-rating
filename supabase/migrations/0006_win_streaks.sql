-- Per-mode current win-streaks per player.
-- Returns one row per user containing their current consecutive-confirmed-wins
-- streak in singles and in doubles (counted independently, since the two
-- ratings are independent). The streak walks back from each player's most
-- recent confirmed match in that mode and stops at the first loss.
--
-- SECURITY DEFINER so the leaderboard can show streaks for every user
-- without leaking individual match details through match_participants RLS.
-- Safe to rerun.

-- The earlier draft of this migration returned (user_id, streak). Postgres
-- won't CREATE OR REPLACE a function when the return shape changes, so
-- drop first.
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

-- Current win-streak per player: count of consecutive confirmed wins
-- starting from each player's most recent confirmed match. Counts the
-- player's own wins (whether they were on team A or B), and includes
-- both singles and doubles results.
--
-- Returned as a SECURITY DEFINER function so the leaderboard can show
-- streaks for every user without leaking individual match details
-- through match_participants RLS. Safe to rerun.

create or replace function public.get_win_streaks()
returns table (user_id uuid, streak int)
language sql
stable
security definer
set search_path = public
as $$
  with ordered as (
    select
      mp.user_id,
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
      is_win,
      sum(1 - is_win) over (
        partition by user_id
        order by played_at desc
        rows between unbounded preceding and current row
      ) as losses_so_far
    from ordered
  )
  select
    user_id,
    count(*)::int as streak
  from with_loss_count
  where is_win = 1 and losses_so_far = 0
  group by user_id;
$$;

grant execute on function public.get_win_streaks() to authenticated;

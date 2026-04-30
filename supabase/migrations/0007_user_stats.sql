-- Per-user win counts and recent-match summaries, exposed as
-- SECURITY DEFINER functions so the leaderboard / profile detail modal
-- can read them for any player without tripping match_participants RLS.
-- Safe to rerun.

-- Confirmed wins by mode for one user.
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

-- Recent confirmed matches for a user, oldest-first cut to p_limit. Each
-- row contains the match-level data plus a JSON array `others` of all
-- OTHER participants (their user_id, display_name, team).
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

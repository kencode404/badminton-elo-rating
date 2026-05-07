-- Admin ban infrastructure.
--
-- Adds an is_banned flag (+ audit fields) to profiles, plus admin-only
-- RPCs for banning and unbanning users. Bans are non-destructive —
-- profile + match history stays intact, the user is just hidden from
-- the leaderboard / player picker and force-signed-out client-side.
--
-- Also rebuilds reset_season() so that the per-mode rank window
-- excludes banned users (their snapshots get rank = null).
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
   where id = p_target_id;
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

-- =========================================================================
-- 3. reset_season() — exclude banned users from rank windows
--
-- Banned users are still included in season_snapshots (their row is
-- preserved with rank = null), but they don't compete with active
-- players for the per-mode #1, #2, … positions.
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
  select is_admin into v_admin
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

  -- Reset every profile's season-state — including banned users (the
  -- is_banned flag itself is intentionally left untouched).
  update public.profiles
     set singles_rating = 1000,
         doubles_rating = 1000,
         singles_games_played = 0,
         doubles_games_played = 0;

  delete from public.chat_messages
   where kind in ('system_streak', 'system_tier_up', 'system_streak_ended');

  delete from public.season_snapshots
   where season_number <= v_current_season - 5;

  return v_next_season;
end;
$$;

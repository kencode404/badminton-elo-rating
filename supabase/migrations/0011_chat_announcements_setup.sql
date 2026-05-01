-- Sets up tier-promotion + streak-broken announcements. Builds on
-- the enum values added in 0010.
--
-- Schema:
--   - columns tier_key, breaker_user_ids on chat_messages
--   - rebuilt check constraint covering all four kinds
--   - helper functions: rating_to_tier_key, tier_rank,
--     streak_before_match
--   - refresh_chat_streak_messages now emits all three system kinds
--
-- Tier thresholds match src/lib/tiers.ts. Update both if you change
-- a bracket. Safe to rerun.

-- =========================================================================
-- 1. Columns
-- =========================================================================

alter table public.chat_messages
  add column if not exists tier_key text,
  add column if not exists breaker_user_ids uuid[];

-- =========================================================================
-- 2. Check constraint covering every kind
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
    or (kind = 'user'
      and user_id is not null
      and body is not null
      and length(trim(body)) > 0)
  );

-- =========================================================================
-- 3. Helper functions
-- =========================================================================

create or replace function public.rating_to_tier_key(p_rating int)
returns text
language sql
immutable
as $$
  select case
    when p_rating >= 1600 then 'predator'
    when p_rating >= 1400 then 'diamond'
    when p_rating >= 1250 then 'gold'
    when p_rating >= 1100 then 'silver'
    else 'bronze'
  end;
$$;

create or replace function public.tier_rank(p_key text)
returns int
language sql
immutable
as $$
  select case p_key
    when 'bronze' then 1
    when 'silver' then 2
    when 'gold' then 3
    when 'diamond' then 4
    when 'predator' then 5
    else 0
  end;
$$;

-- Counts consecutive wins for p_user_id in p_mode immediately before
-- p_match_id (excluding p_match_id itself). Used to detect "your X-win
-- streak just ended" cases when a player loses.
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
  total int := 0;
  rec record;
begin
  select played_at into ref_played_at
    from public.matches
   where id = p_match_id;
  if ref_played_at is null then
    return 0;
  end if;

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
-- 4. Replace trigger function — emits all three system kinds
-- =========================================================================

create or replace function public.refresh_chat_streak_messages()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  participant record;
  v_streak int;
  participant_won boolean;
  v_old_tier text;
  v_new_tier text;
  v_winner_ids uuid[];
  v_loser_streak int;
begin
  -- Winning team's user_ids — used as the "breakers" array on any
  -- streak-ended announcement we emit below.
  select array_agg(mp.user_id)
    into v_winner_ids
  from public.match_participants mp
  where mp.match_id = new.id
    and (
      (mp.team = 'A' and new.score_a > new.score_b)
      or (mp.team = 'B' and new.score_b > new.score_a)
    );

  for participant in
    select user_id, team, rating_before, rating_after
      from public.match_participants
     where match_id = new.id
  loop
    participant_won :=
      (participant.team = 'A' and new.score_a > new.score_b)
      or (participant.team = 'B' and new.score_b > new.score_a);

    if participant_won then
      -- (a) Existing on-going streak announcement.
      v_streak := public.current_streak_for_user_mode(
        participant.user_id, new.match_type);
      if v_streak >= 2 then
        insert into public.chat_messages
          (kind, user_id, match_type, streak_count, expires_at)
        values
          ('system_streak', participant.user_id, new.match_type, v_streak,
           now() + interval '30 days');
      end if;

      -- (b) Tier-up announcement: rating crossed a bracket upward.
      if participant.rating_before is not null
         and participant.rating_after is not null then
        v_old_tier := public.rating_to_tier_key(participant.rating_before);
        v_new_tier := public.rating_to_tier_key(participant.rating_after);
        if v_new_tier <> v_old_tier
           and public.tier_rank(v_new_tier) > public.tier_rank(v_old_tier) then
          insert into public.chat_messages
            (kind, user_id, match_type, tier_key, expires_at)
          values
            ('system_tier_up', participant.user_id, new.match_type,
             v_new_tier, now() + interval '30 days');
        end if;
      end if;

    else
      -- (c) Streak-ended: this loser had a >=2 streak going into the
      --     match. Breakers are the winning side.
      if v_winner_ids is not null and array_length(v_winner_ids, 1) >= 1 then
        v_loser_streak := public.streak_before_match(
          participant.user_id, new.match_type, new.id);
        if v_loser_streak >= 2 then
          insert into public.chat_messages
            (kind, user_id, match_type, streak_count, breaker_user_ids, expires_at)
          values
            ('system_streak_ended', participant.user_id, new.match_type,
             v_loser_streak, v_winner_ids,
             now() + interval '30 days');
        end if;
      end if;
    end if;
  end loop;

  -- Lazy cleanup of expired system rows. User chat (expires_at = null)
  -- is kept indefinitely.
  delete from public.chat_messages
   where kind in ('system_streak', 'system_tier_up', 'system_streak_ended')
     and expires_at is not null
     and expires_at < now();

  return new;
end;
$$;

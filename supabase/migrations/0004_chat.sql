-- Club Chat schema: chat_messages (system announcements + user chat),
-- chat_reactions (one per user per message), helpers for the
-- after-match-confirmed trigger that emits three system kinds:
--
--   * system_streak        — winner is on a >= 2-win streak
--   * system_tier_up       — winner's rating crossed a tier boundary
--                            upward
--   * system_streak_ended  — loser had a >= 2 win streak that just
--                            broke; breaker_user_ids names the
--                            winning side
--
-- Also adds the chat_last_seen_at column on profiles that drives the
-- home-tab unread badge. Safe to rerun.

-- =========================================================================
-- 1. profiles.chat_last_seen_at
-- =========================================================================

alter table public.profiles
  add column if not exists chat_last_seen_at timestamptz not null
    default '1970-01-01 00:00:00+00';

-- =========================================================================
-- 2. Enum (all four message kinds from creation — fresh installs and
--    existing prod that already has the enum both end up consistent)
-- =========================================================================

do $$ begin
  create type chat_message_kind as enum (
    'system_streak',
    'system_tier_up',
    'system_streak_ended',
    'user'
  );
exception when duplicate_object then null;
end $$;

-- =========================================================================
-- 3. chat_messages
-- =========================================================================

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  kind chat_message_kind not null,
  user_id uuid references public.profiles(id) on delete cascade,
  body text,
  match_type match_type,
  streak_count int,
  tier_key text,
  breaker_user_ids uuid[],
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

-- Idempotent column adds for existing prod that pre-dates them.
alter table public.chat_messages
  add column if not exists tier_key text,
  add column if not exists breaker_user_ids uuid[];

create index if not exists chat_messages_created_idx
  on public.chat_messages (created_at desc);

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

alter table public.chat_messages enable row level security;

drop policy if exists "Chat messages readable by all" on public.chat_messages;
create policy "Chat messages readable by all"
  on public.chat_messages for select
  to authenticated
  using (true);

drop policy if exists "Users can post user chat messages" on public.chat_messages;
create policy "Users can post user chat messages"
  on public.chat_messages for insert
  to authenticated
  with check (kind = 'user' and user_id = auth.uid());

-- Unsend window: users can delete their own user messages for 10
-- minutes after sending. Enforced server-side; the client hides the
-- unsend button once the window closes.
drop policy if exists "Users can delete own chat messages" on public.chat_messages;
create policy "Users can delete own chat messages"
  on public.chat_messages for delete
  to authenticated
  using (
    kind = 'user'
    and user_id = auth.uid()
    and created_at > now() - interval '10 minutes'
  );

-- =========================================================================
-- 4. Helpers used by the announcement trigger
-- =========================================================================

-- Tier thresholds — keep in sync with src/lib/tiers.ts.
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
-- p_match_id (excluding p_match_id itself), restricted to the current
-- season window. Used to detect "your X-win streak just ended" cases.
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
-- 5. Announcement trigger — emits all three system kinds after a
--    match is confirmed
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

drop trigger if exists trg_refresh_chat_streak_messages on public.matches;
create trigger trg_refresh_chat_streak_messages
  after update of status on public.matches
  for each row
  when (new.status = 'confirmed' and old.status is distinct from new.status)
  execute function public.refresh_chat_streak_messages();

-- =========================================================================
-- 6. chat_reactions (one per user per message)
-- =========================================================================

create table if not exists public.chat_reactions (
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists chat_reactions_message_idx
  on public.chat_reactions (message_id);

alter table public.chat_reactions enable row level security;

drop policy if exists "Reactions readable by all" on public.chat_reactions;
create policy "Reactions readable by all"
  on public.chat_reactions for select
  to authenticated
  using (true);

drop policy if exists "Users react as themselves" on public.chat_reactions;
create policy "Users react as themselves"
  on public.chat_reactions for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Users update own reactions" on public.chat_reactions;
create policy "Users update own reactions"
  on public.chat_reactions for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Users delete own reactions" on public.chat_reactions;
create policy "Users delete own reactions"
  on public.chat_reactions for delete
  to authenticated
  using (user_id = auth.uid());

-- =========================================================================
-- 7. Backfill — populate from current win streaks so a fresh install
--               with existing matches doesn't have an empty chat
-- =========================================================================

insert into public.chat_messages
  (kind, user_id, match_type, streak_count, expires_at)
select 'system_streak', s.user_id, 'singles'::match_type, s.singles_streak,
       now() + interval '30 days'
from public.get_win_streaks() s
where s.singles_streak >= 2
on conflict do nothing;

insert into public.chat_messages
  (kind, user_id, match_type, streak_count, expires_at)
select 'system_streak', s.user_id, 'doubles'::match_type, s.doubles_streak,
       now() + interval '30 days'
from public.get_win_streaks() s
where s.doubles_streak >= 2
on conflict do nothing;

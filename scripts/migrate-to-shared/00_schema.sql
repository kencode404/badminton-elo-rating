-- GENERATED: concatenation of supabase/migrations/0001..0015 for a one-shot run in the
-- new project's SQL editor. Regenerate after editing any migration:
--   cat supabase/migrations/*.sql > scripts/migrate-to-shared/00_schema.sql (plus this header)


-- ======================================================================
-- supabase/migrations/0001_init.sql
-- ======================================================================
-- Badminton ELO — consolidated schema (v2 ELO).
-- Run this in the Supabase SQL editor for your project. Safe to rerun.
--
-- This is the single source of truth for the base schema. To set up
-- a fresh database, run the migration files in numeric order:
--   1) 0001_init.sql       — this file: base schema, ELO settlement,
--                            RLS policies, expiry cron stub, seasons
--   2) 0002_avatars.sql    — storage bucket for profile avatars + RLS
--   3) 0003_user_stats.sql — leaderboard / profile RPCs (streaks,
--                            win counts, recent matches), filtered to
--                            the current season
--   4) 0004_chat.sql       — chat_messages, chat_reactions, plus the
--                            three system-announcement kinds (streak,
--                            tier_up, streak_ended) emitted by the
--                            after-match-confirmed trigger
--   5) 0005_realtime.sql   — adds chat tables + profiles to the
--                            supabase_realtime publication
--   6) 0006_unsend_window.sql — chat unsend window tweak
--   7) 0007_seasons.sql    — season_snapshots + reset_season RPC,
--                            admin grant for the club admin
--
-- Constants (K-factor, starting rating, expiry days, margin tuning) are
-- kept in sync with src/lib/elo.ts and docs/ELO_CALCULATION.md.

-- =========================================================================
-- 1. Enums (idempotent)
-- =========================================================================

do $$ begin
  create type badminton_match_type as enum ('singles', 'doubles');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type badminton_match_status as enum ('pending', 'confirmed', 'rejected', 'expired');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type badminton_match_team as enum ('A', 'B');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type badminton_confirmation_status as enum ('pending', 'accepted', 'rejected');
exception when duplicate_object then null;
end $$;

-- =========================================================================
-- 2. Profiles (one row per auth.users entry)
-- =========================================================================

create table if not exists public.badminton_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 15),
  avatar_url text,
  singles_rating int not null default 1000,
  doubles_rating int not null default 1000,
  singles_games_played int not null default 0 check (singles_games_played >= 0),
  doubles_games_played int not null default 0 check (doubles_games_played >= 0),
  -- Lifetime peak rating per mode. Bumped monotonically by
  -- settle_match (never decreases). Survives season resets so a
  -- player's all-time best tier is always visible.
  peak_singles_rating int not null default 1000,
  peak_doubles_rating int not null default 1000,
  created_at timestamptz not null default now(),
  is_admin boolean not null default false,
  -- Cutoff for the notification-bell badge — chat events newer than
  -- this count toward the badge until the user opens the popover.
  notifications_last_seen_at timestamptz not null
    default '1970-01-01 00:00:00+00'
);

-- Idempotent column adds for existing prod that pre-dates the column.
alter table public.badminton_profiles
  add column if not exists is_admin boolean not null default false,
  add column if not exists peak_singles_rating int not null default 1000,
  add column if not exists peak_doubles_rating int not null default 1000,
  add column if not exists notifications_last_seen_at timestamptz not null
    default '1970-01-01 00:00:00+00';

-- Idempotent backfill: peak >= current rating. Re-running is a no-op
-- because greatest() is monotonic.
update public.badminton_profiles
   set peak_singles_rating = greatest(peak_singles_rating, singles_rating),
       peak_doubles_rating = greatest(peak_doubles_rating, doubles_rating);

create index if not exists badminton_profiles_singles_rating_idx on public.badminton_profiles (singles_rating desc);
create index if not exists badminton_profiles_doubles_rating_idx on public.badminton_profiles (doubles_rating desc);

-- Auto-create profile row when a new auth user signs up.
create or replace function public.badminton_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.badminton_profiles (id, display_name)
  values (
    new.id,
    left(
      coalesce(
        new.raw_user_meta_data->>'display_name',
        split_part(new.email, '@', 1)
      ),
      15
    )
  );
  return new;
end;
$$;

drop trigger if exists badminton_on_auth_user_created on auth.users;
create trigger badminton_on_auth_user_created
  after insert on auth.users
  for each row execute function public.badminton_handle_new_user();

-- =========================================================================
-- 2b. Seasons (latest row's started_at is the current-season cutoff
--     used by streak/win SQL helpers in 0003)
-- =========================================================================

create table if not exists public.badminton_seasons (
  number int primary key,
  started_at timestamptz not null default now()
);

-- Seed season 1 with a far-past start so every existing match counts
-- as belonging to the current season. reset_season() (in 0007) inserts
-- season 2, 3, … with started_at = now().
insert into public.badminton_seasons (number, started_at)
select 1, '1970-01-01'::timestamptz
 where not exists (select 1 from public.badminton_seasons);

alter table public.badminton_seasons enable row level security;

drop policy if exists "Seasons readable by all" on public.badminton_seasons;
create policy "Seasons readable by all"
  on public.badminton_seasons for select
  to authenticated using (true);

-- =========================================================================
-- 3. Matches & participants
-- =========================================================================

create table if not exists public.badminton_matches (
  id uuid primary key default gen_random_uuid(),
  match_type badminton_match_type not null,
  created_by uuid not null references public.badminton_profiles(id) on delete cascade,
  score_a int not null check (score_a >= 0),
  score_b int not null check (score_b >= 0),
  status badminton_match_status not null default 'pending',
  played_at timestamptz not null default now(),
  confirmed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  elo_version int not null default 1,
  check (score_a <> score_b)  -- no ties
);

create index if not exists badminton_matches_status_idx on public.badminton_matches (status);
create index if not exists badminton_matches_played_at_idx on public.badminton_matches (played_at desc);
create index if not exists badminton_matches_expires_at_idx on public.badminton_matches (expires_at) where status = 'pending';

create table if not exists public.badminton_match_participants (
  match_id uuid not null references public.badminton_matches(id) on delete cascade,
  user_id uuid not null references public.badminton_profiles(id) on delete cascade,
  team badminton_match_team not null,
  confirmation badminton_confirmation_status not null default 'pending',
  responded_at timestamptz,
  rating_before int,
  rating_after int,
  rating_delta int,
  primary key (match_id, user_id)
);

create index if not exists badminton_match_participants_user_pending_idx
  on public.badminton_match_participants (user_id)
  where confirmation = 'pending';

-- =========================================================================
-- 4. Match-creation guards
-- =========================================================================

-- Enforce correct team sizes and prevent same player on both teams.
create or replace function public.badminton_validate_match_participants()
returns trigger
language plpgsql
as $$
declare
  m record;
  count_a int;
  count_b int;
  expected_size int;
begin
  select * into m from public.badminton_matches where id = new.match_id;
  if not found then
    return new;
  end if;

  expected_size := case m.match_type when 'singles' then 1 else 2 end;

  select
    count(*) filter (where team = 'A'),
    count(*) filter (where team = 'B')
    into count_a, count_b
  from public.badminton_match_participants
  where match_id = new.match_id;

  if count_a > expected_size or count_b > expected_size then
    raise exception 'Too many players on team for % match', m.match_type;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_match_participants on public.badminton_match_participants;
create trigger trg_validate_match_participants
  after insert on public.badminton_match_participants
  for each row execute function public.badminton_validate_match_participants();

-- =========================================================================
-- 5. ELO settlement on full confirmation
-- =========================================================================

-- Constants here MUST match src/lib/elo.ts and docs/ELO_CALCULATION.md.
create or replace function public.badminton_settle_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  k_provisional constant int := 40;
  k_established constant int := 24;
  provisional_games constant int := 5;
  elo_divisor constant numeric := 400;
  margin_deadband constant int := 2;
  margin_divisor constant numeric := 21;
  margin_max_mult constant numeric := 2;
  rating_a numeric;
  rating_b numeric;
  expected_a numeric;
  expected_b numeric;
  actual_a numeric;
  actual_b numeric;
  rating_col text;
  games_col text;
  peak_col text;
  participant record;
  current_rating int;
  current_games int;
  base_k int;
  effective_k numeric;
  team_actual numeric;
  team_expected numeric;
  delta int;
  score_diff int;
  margin_mult numeric;
  winning_team badminton_match_team;
begin
  select * into m from public.badminton_matches where id = p_match_id for update;
  if not found or m.status <> 'pending' then
    return;
  end if;

  -- One acceptance per team is enough. Bail if either side has none.
  -- Singles falls out naturally: 1 per team = both players.
  if not exists (
    select 1 from public.badminton_match_participants
     where match_id = p_match_id
       and team = 'A'
       and confirmation = 'accepted'
  ) or not exists (
    select 1 from public.badminton_match_participants
     where match_id = p_match_id
       and team = 'B'
       and confirmation = 'accepted'
  ) then
    return;
  end if;

  if m.match_type = 'singles' then
    rating_col := 'singles_rating';
    games_col := 'singles_games_played';
    peak_col := 'peak_singles_rating';
  else
    rating_col := 'doubles_rating';
    games_col := 'doubles_games_played';
    peak_col := 'peak_doubles_rating';
  end if;

  -- Compute team mean ratings.
  execute format(
    'select avg(p.%I)::numeric
       from public.badminton_match_participants mp
       join public.badminton_profiles p on p.id = mp.user_id
      where mp.match_id = $1 and mp.team = $2::badminton_match_team',
    rating_col
  ) using p_match_id, 'A' into rating_a;

  execute format(
    'select avg(p.%I)::numeric
       from public.badminton_match_participants mp
       join public.badminton_profiles p on p.id = mp.user_id
      where mp.match_id = $1 and mp.team = $2::badminton_match_team',
    rating_col
  ) using p_match_id, 'B' into rating_b;

  expected_a := 1 / (1 + power(10, (rating_b - rating_a) / elo_divisor));
  expected_b := 1 - expected_a;

  if m.score_a > m.score_b then
    actual_a := 1; actual_b := 0;
    winning_team := 'A';
  else
    actual_a := 0; actual_b := 1;
    winning_team := 'B';
  end if;

  -- Margin-of-victory multiplier (winner only).
  score_diff := abs(m.score_a - m.score_b);
  margin_mult := least(margin_max_mult, 1 + greatest(0, score_diff - margin_deadband)::numeric / margin_divisor);

  -- Loop participants, compute per-player delta with their personal K.
  for participant in
    select user_id, team from public.badminton_match_participants where match_id = p_match_id
  loop
    execute format('select %I, %I from public.badminton_profiles where id = $1', rating_col, games_col)
      using participant.user_id into current_rating, current_games;

    base_k := case when current_games < provisional_games then k_provisional else k_established end;

    if participant.team = winning_team then
      effective_k := base_k * margin_mult;
    else
      effective_k := base_k;
    end if;

    if participant.team = 'A' then
      team_actual := actual_a; team_expected := expected_a;
    else
      team_actual := actual_b; team_expected := expected_b;
    end if;

    delta := round(effective_k * (team_actual - team_expected));

    update public.badminton_match_participants
       set rating_before = current_rating,
           rating_after = current_rating + delta,
           rating_delta = delta
     where match_id = p_match_id and user_id = participant.user_id;

    -- Bump rating, increment games, and ratchet peak monotonically.
    -- Set expressions in a single UPDATE reference the OLD row, so
    -- greatest(peak_col, rating_col + $1) compares old peak to the
    -- post-update rating.
    execute format(
      'update public.badminton_profiles
          set %I = %I + $1,
              %I = %I + 1,
              %I = greatest(%I, %I + $1)
        where id = $2',
      rating_col, rating_col,
      games_col, games_col,
      peak_col, peak_col, rating_col
    ) using delta, participant.user_id;
  end loop;

  update public.badminton_matches
     set status = 'confirmed', confirmed_at = now(), elo_version = 2
   where id = p_match_id;
end;
$$;

-- Trigger: when the last participant accepts, settle the match.
-- When any participant rejects, mark the match rejected.
create or replace function public.badminton_handle_confirmation_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  m_status badminton_match_status;
begin
  if new.confirmation = old.confirmation then
    return new;
  end if;

  select status into m_status from public.badminton_matches where id = new.match_id;
  if m_status <> 'pending' then
    return new;
  end if;

  if new.confirmation = 'rejected' then
    -- Any single rejection kills the match — one veto is enough.
    update public.badminton_matches set status = 'rejected' where id = new.match_id;
    return new;
  end if;

  if new.confirmation = 'accepted' then
    -- Settle as soon as each team has at least one acceptance.
    if exists (
      select 1 from public.badminton_match_participants
       where match_id = new.match_id
         and team = 'A'
         and confirmation = 'accepted'
    ) and exists (
      select 1 from public.badminton_match_participants
       where match_id = new.match_id
         and team = 'B'
         and confirmation = 'accepted'
    ) then
      perform public.badminton_settle_match(new.match_id);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_handle_confirmation_change on public.badminton_match_participants;
create trigger trg_handle_confirmation_change
  after update of confirmation on public.badminton_match_participants
  for each row execute function public.badminton_handle_confirmation_change();

-- =========================================================================
-- 6. Row Level Security
-- =========================================================================

alter table public.badminton_profiles enable row level security;
alter table public.badminton_matches enable row level security;
alter table public.badminton_match_participants enable row level security;

-- Helper: SECURITY DEFINER membership check that bypasses RLS, so the
-- match_participants SELECT policy can reference its own table without
-- triggering 42P17 "infinite recursion in policy".
create or replace function public.badminton_is_match_participant(
  p_match_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.badminton_match_participants
    where match_id = p_match_id and user_id = p_user_id
  );
$$;

grant execute on function public.badminton_is_match_participant(uuid, uuid) to authenticated;

-- Profiles: anyone signed in can read; only the owner can update their profile.
drop policy if exists "Profiles readable by all signed-in users" on public.badminton_profiles;
create policy "Profiles readable by all signed-in users"
  on public.badminton_profiles for select
  to authenticated
  using (true);

drop policy if exists "Users can update own profile" on public.badminton_profiles;
create policy "Users can update own profile"
  on public.badminton_profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Note: rating columns are managed by settle_match (security definer),
-- not by direct user updates. We rely on the app to never let users PATCH
-- those columns — adding a column-level grant restriction is overkill for v1.

-- Matches:
-- Read: any participant or the creator.
-- Insert: must be the creator and a participant.
-- Update: only the creator can cancel a still-pending match (handled later).
drop policy if exists "Matches visible to participants" on public.badminton_matches;
create policy "Matches visible to participants"
  on public.badminton_matches for select
  to authenticated
  using (
    auth.uid() = created_by
    or public.badminton_is_match_participant(id, auth.uid())
  );

drop policy if exists "Users can create matches as themselves" on public.badminton_matches;
create policy "Users can create matches as themselves"
  on public.badminton_matches for insert
  to authenticated
  with check (created_by = auth.uid());

-- Match participants:
-- Read: any signed-in user can read participants of matches they are in or created.
-- Insert: creator of the match adds participants at match-creation time.
-- Update: a user can only update their own confirmation.
drop policy if exists "Participants visible to involved users" on public.badminton_match_participants;
create policy "Participants visible to involved users"
  on public.badminton_match_participants for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.badminton_is_match_participant(match_id, auth.uid())
    or exists (
      select 1 from public.badminton_matches m
      where m.id = badminton_match_participants.match_id and m.created_by = auth.uid()
    )
  );

drop policy if exists "Match creator inserts participants" on public.badminton_match_participants;
create policy "Match creator inserts participants"
  on public.badminton_match_participants for insert
  to authenticated
  with check (
    exists (
      select 1 from public.badminton_matches m
      where m.id = match_id and m.created_by = auth.uid()
    )
  );

drop policy if exists "Users update only own confirmation" on public.badminton_match_participants;
create policy "Users update only own confirmation"
  on public.badminton_match_participants for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- =========================================================================
-- 7. Realtime
-- =========================================================================

-- Allow Realtime to broadcast inserts/updates on these tables (idempotent).
do $$ begin
  alter publication supabase_realtime add table public.badminton_matches;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.badminton_match_participants;
exception when duplicate_object then null;
end $$;

-- =========================================================================
-- 8. Match expiry job (call from a scheduled edge function or pg_cron)
-- =========================================================================

create or replace function public.badminton_expire_old_matches()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  affected int;
begin
  update public.badminton_matches
     set status = 'expired'
   where status = 'pending' and expires_at < now();
  get diagnostics affected = row_count;
  return affected;
end;
$$;


-- ======================================================================
-- supabase/migrations/0002_avatars.sql
-- ======================================================================
-- Avatars storage bucket + policies. Safe to rerun.
--
-- Convention: each user uploads to a folder named by their auth uid, so the
-- file path is `{user_id}/avatar.jpg`. RLS uses the first folder segment to
-- enforce that users can only modify their own avatar.

-- Public bucket (anyone can read, only owners can write).
insert into storage.buckets (id, name, public)
values ('badminton_avatars', 'badminton_avatars', true)
on conflict (id) do update set public = excluded.public;

-- Public read.
drop policy if exists "Badminton avatar public read" on storage.objects;
create policy "Badminton avatar public read"
  on storage.objects for select
  to public
  using (bucket_id = 'badminton_avatars');

-- Owner can insert into their own folder.
drop policy if exists "Badminton avatar upload by owner" on storage.objects;
create policy "Badminton avatar upload by owner"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'badminton_avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Owner can overwrite their own avatar.
drop policy if exists "Badminton avatar update by owner" on storage.objects;
create policy "Badminton avatar update by owner"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'badminton_avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'badminton_avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Owner can delete their own avatar.
drop policy if exists "Badminton avatar delete by owner" on storage.objects;
create policy "Badminton avatar delete by owner"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'badminton_avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- ======================================================================
-- supabase/migrations/0003_user_stats.sql
-- ======================================================================
-- Per-user stats RPCs used by the leaderboard, profile page, and
-- profile-detail modal. All SECURITY DEFINER so they can read across
-- match_participants without tripping its RLS.
--
-- Every match-history query is filtered to the current season
-- (badminton_seasons.started_at). Older matches still exist in the matches
-- table (kept for the get_recent_matches modal feed below) but
-- streak / win-count helpers ignore them after a reset_season().
--
-- Safe to rerun.

-- =========================================================================
-- 1. Per-mode current win streak (single user)
-- =========================================================================

create or replace function public.badminton_current_streak_for_user_mode(
  p_user_id uuid,
  p_match_type badminton_match_type
)
returns int
language sql
stable
security definer
set search_path = public
as $$
  with season_start as (
    select started_at from public.badminton_seasons
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
    from public.badminton_match_participants mp
    join public.badminton_matches m on m.id = mp.match_id
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

grant execute on function public.badminton_current_streak_for_user_mode(uuid, badminton_match_type) to authenticated;

-- =========================================================================
-- 2. Per-mode win streaks for all users (leaderboard fire-halo badge)
-- =========================================================================

drop function if exists public.badminton_get_win_streaks();
create or replace function public.badminton_get_win_streaks()
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
    select started_at from public.badminton_seasons order by number desc limit 1
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
    from public.badminton_match_participants mp
    join public.badminton_matches m on m.id = mp.match_id
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

grant execute on function public.badminton_get_win_streaks() to authenticated;

-- =========================================================================
-- 3. Confirmed wins by mode (single user) — drives the win-rate display
-- =========================================================================

create or replace function public.badminton_get_user_win_counts(p_user_id uuid)
returns table (singles_wins int, doubles_wins int)
language sql
stable
security definer
set search_path = public
as $$
  with season_start as (
    select started_at from public.badminton_seasons order by number desc limit 1
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
  from public.badminton_match_participants mp
  join public.badminton_matches m on m.id = mp.match_id
  where mp.user_id = p_user_id
    and m.status = 'confirmed'
    and m.played_at >= (select started_at from season_start);
$$;

grant execute on function public.badminton_get_user_win_counts(uuid) to authenticated;

-- =========================================================================
-- 4. Recent confirmed matches for a user (profile detail modal)
--    Not season-filtered — the modal's "Last 5 Matches" tab can span
--    seasons; the past-season summary lives elsewhere.
-- =========================================================================

create or replace function public.badminton_get_recent_matches(
  p_user_id uuid,
  p_limit int default 5
)
returns table (
  match_id uuid,
  match_type badminton_match_type,
  played_at timestamptz,
  user_team badminton_match_team,
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
      from public.badminton_match_participants mp2
      join public.badminton_profiles p2 on p2.id = mp2.user_id
      where mp2.match_id = m.id and mp2.user_id <> p_user_id
    ) as others
  from public.badminton_match_participants mp
  join public.badminton_matches m on m.id = mp.match_id
  where mp.user_id = p_user_id and m.status = 'confirmed'
  order by m.played_at desc
  limit p_limit;
$$;

grant execute on function public.badminton_get_recent_matches(uuid, int) to authenticated;


-- ======================================================================
-- supabase/migrations/0004_chat.sql
-- ======================================================================
-- Club Chat schema: chat_messages (system announcements + user chat),
-- chat_reactions (one per user per message), helpers + the after-
-- match-confirmed trigger that emits all five system kinds:
--
--   * system_streak        — winner is on a >= 2-win streak
--   * system_tier_up       — placement reveal at game 5, OR a tier
--                            crossing upward post-placement
--   * system_streak_ended  — loser had a >= 2 win streak that just
--                            broke; breaker_user_ids names the
--                            winning side
--   * system_season_reset  — moderation log line (admin reset season)
--   * system_user_banned   — moderation log line (admin banned user)
--
-- User chat (kind = 'user') supports replies (reply_to_message_id)
-- and @mentions (mentioned_user_ids). Adds chat_last_seen_at on
-- profiles that drives the home-tab unread badge.
--
-- Safe to rerun.

-- =========================================================================
-- 1. badminton_profiles.chat_last_seen_at
-- =========================================================================

alter table public.badminton_profiles
  add column if not exists chat_last_seen_at timestamptz not null
    default '1970-01-01 00:00:00+00';

-- =========================================================================
-- 2. Enum (all six message kinds from creation — fresh installs are
--    one-shot; existing prod that already has the enum keeps its
--    values regardless)
-- =========================================================================

do $$ begin
  create type badminton_chat_message_kind as enum (
    'system_streak',
    'system_tier_up',
    'system_streak_ended',
    'system_season_reset',
    'system_user_banned',
    'user'
  );
exception when duplicate_object then null;
end $$;

-- =========================================================================
-- 3. chat_messages
-- =========================================================================

create table if not exists public.badminton_chat_messages (
  id uuid primary key default gen_random_uuid(),
  kind badminton_chat_message_kind not null,
  user_id uuid references public.badminton_profiles(id) on delete cascade,
  body text,
  match_type badminton_match_type,
  streak_count int,
  tier_key text,
  breaker_user_ids uuid[],
  reply_to_message_id uuid references public.badminton_chat_messages(id) on delete set null,
  mentioned_user_ids uuid[],
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

-- Idempotent column adds for existing prod that pre-dates them.
alter table public.badminton_chat_messages
  add column if not exists tier_key text,
  add column if not exists breaker_user_ids uuid[],
  add column if not exists reply_to_message_id uuid
    references public.badminton_chat_messages(id) on delete set null,
  add column if not exists mentioned_user_ids uuid[];

create index if not exists badminton_chat_messages_created_idx
  on public.badminton_chat_messages (created_at desc);

create index if not exists badminton_chat_messages_reply_to_idx
  on public.badminton_chat_messages (reply_to_message_id)
  where reply_to_message_id is not null;

-- GIN index — used by the bell-badge query to find messages where
-- the current user is in mentioned_user_ids.
create index if not exists badminton_chat_messages_mentions_idx
  on public.badminton_chat_messages using gin (mentioned_user_ids);

alter table public.badminton_chat_messages
  drop constraint if exists chat_messages_check;

alter table public.badminton_chat_messages
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
    or (kind = 'system_season_reset'
      and user_id is not null
      and body is not null
      and length(trim(body)) > 0)
    or (kind = 'system_user_banned'
      and user_id is not null
      and body is not null
      and length(trim(body)) > 0)
    or (kind = 'user'
      and user_id is not null
      and body is not null
      and length(trim(body)) > 0)
  );

alter table public.badminton_chat_messages enable row level security;

drop policy if exists "Chat messages readable by all" on public.badminton_chat_messages;
create policy "Chat messages readable by all"
  on public.badminton_chat_messages for select
  to authenticated
  using (true);

drop policy if exists "Users can post user chat messages" on public.badminton_chat_messages;
create policy "Users can post user chat messages"
  on public.badminton_chat_messages for insert
  to authenticated
  with check (kind = 'user' and user_id = auth.uid());

-- Unsend window: users can delete their own user messages for 10
-- minutes after sending. Enforced server-side; the client hides the
-- unsend button once the window closes.
drop policy if exists "Users can delete own chat messages" on public.badminton_chat_messages;
create policy "Users can delete own chat messages"
  on public.badminton_chat_messages for delete
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
create or replace function public.badminton_rating_to_tier_key(p_rating int)
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

create or replace function public.badminton_tier_rank(p_key text)
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
create or replace function public.badminton_streak_before_match(
  p_user_id uuid,
  p_mode badminton_match_type,
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
    from public.badminton_matches
   where id = p_match_id;
  if ref_played_at is null then
    return 0;
  end if;

  select started_at into v_season_start
    from public.badminton_seasons
   order by number desc
   limit 1;

  for rec in
    select
      case when (mp.team = 'A' and m.score_a > m.score_b)
            or (mp.team = 'B' and m.score_b > m.score_a)
           then 1 else 0 end as won
    from public.badminton_matches m
    join public.badminton_match_participants mp on mp.match_id = m.id
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
-- 5. Announcement trigger — emits all three "match-derived" system
--    kinds, with placement gating on tier_up.
--
-- Placement (games_played < 5 in this mode) → no per-match tier_up.
-- Exactly at games_played = 5 → emit a single system_tier_up
-- revealing the player's final placement tier (winner OR loser).
-- Past placement (games_played > 5) → tier_up only on actual crossing.
-- Streak announcements are placement-agnostic.
-- =========================================================================

create or replace function public.badminton_refresh_chat_streak_messages()
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
  v_games int;
  v_placement_games constant int := 5;
begin
  select array_agg(mp.user_id)
    into v_winner_ids
  from public.badminton_match_participants mp
  where mp.match_id = new.id
    and (
      (mp.team = 'A' and new.score_a > new.score_b)
      or (mp.team = 'B' and new.score_b > new.score_a)
    );

  for participant in
    select user_id, team, rating_before, rating_after
      from public.badminton_match_participants
     where match_id = new.id
  loop
    participant_won :=
      (participant.team = 'A' and new.score_a > new.score_b)
      or (participant.team = 'B' and new.score_b > new.score_a);

    -- Post-match games_played for this mode (settle_match already
    -- incremented it).
    if new.match_type = 'singles' then
      select singles_games_played into v_games
        from public.badminton_profiles where id = participant.user_id;
    else
      select doubles_games_played into v_games
        from public.badminton_profiles where id = participant.user_id;
    end if;

    -- Placement-complete reveal — fires for every participant whose
    -- 5th game just settled, regardless of win/loss.
    if v_games = v_placement_games and participant.rating_after is not null then
      insert into public.badminton_chat_messages
        (kind, user_id, match_type, tier_key, expires_at)
      values
        ('system_tier_up', participant.user_id, new.match_type,
         public.badminton_rating_to_tier_key(participant.rating_after),
         now() + interval '30 days');
    end if;

    if participant_won then
      -- (a) Existing on-going streak announcement (placement-agnostic).
      v_streak := public.badminton_current_streak_for_user_mode(
        participant.user_id, new.match_type);
      if v_streak >= 2 then
        insert into public.badminton_chat_messages
          (kind, user_id, match_type, streak_count, expires_at)
        values
          ('system_streak', participant.user_id, new.match_type, v_streak,
           now() + interval '30 days');
      end if;

      -- (b) Tier-up announcement: only after placement is over
      -- (games_played > 5). The exact placement-complete game is
      -- handled by the placement reveal block above.
      if v_games > v_placement_games
         and participant.rating_before is not null
         and participant.rating_after is not null then
        v_old_tier := public.badminton_rating_to_tier_key(participant.rating_before);
        v_new_tier := public.badminton_rating_to_tier_key(participant.rating_after);
        if v_new_tier <> v_old_tier
           and public.badminton_tier_rank(v_new_tier) > public.badminton_tier_rank(v_old_tier) then
          insert into public.badminton_chat_messages
            (kind, user_id, match_type, tier_key, expires_at)
          values
            ('system_tier_up', participant.user_id, new.match_type,
             v_new_tier, now() + interval '30 days');
        end if;
      end if;

    else
      -- (c) Streak-ended (placement-agnostic).
      if v_winner_ids is not null and array_length(v_winner_ids, 1) >= 1 then
        v_loser_streak := public.badminton_streak_before_match(
          participant.user_id, new.match_type, new.id);
        if v_loser_streak >= 2 then
          insert into public.badminton_chat_messages
            (kind, user_id, match_type, streak_count, breaker_user_ids, expires_at)
          values
            ('system_streak_ended', participant.user_id, new.match_type,
             v_loser_streak, v_winner_ids,
             now() + interval '30 days');
        end if;
      end if;
    end if;
  end loop;

  -- Stale match-derived announcements go; ban / reset moderation logs
  -- are kept (they have their own 30-day timer).
  delete from public.badminton_chat_messages
   where kind in ('system_streak', 'system_tier_up', 'system_streak_ended')
     and expires_at is not null
     and expires_at < now();

  return new;
end;
$$;

drop trigger if exists trg_refresh_chat_streak_messages on public.badminton_matches;
create trigger trg_refresh_chat_streak_messages
  after update of status on public.badminton_matches
  for each row
  when (new.status = 'confirmed' and old.status is distinct from new.status)
  execute function public.badminton_refresh_chat_streak_messages();

-- =========================================================================
-- 6. chat_reactions (one per user per message)
-- =========================================================================

create table if not exists public.badminton_chat_reactions (
  message_id uuid not null references public.badminton_chat_messages(id) on delete cascade,
  user_id uuid not null references public.badminton_profiles(id) on delete cascade,
  emoji text not null check (length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists badminton_chat_reactions_message_idx
  on public.badminton_chat_reactions (message_id);

alter table public.badminton_chat_reactions enable row level security;

drop policy if exists "Reactions readable by all" on public.badminton_chat_reactions;
create policy "Reactions readable by all"
  on public.badminton_chat_reactions for select
  to authenticated
  using (true);

drop policy if exists "Users react as themselves" on public.badminton_chat_reactions;
create policy "Users react as themselves"
  on public.badminton_chat_reactions for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Users update own reactions" on public.badminton_chat_reactions;
create policy "Users update own reactions"
  on public.badminton_chat_reactions for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Users delete own reactions" on public.badminton_chat_reactions;
create policy "Users delete own reactions"
  on public.badminton_chat_reactions for delete
  to authenticated
  using (user_id = auth.uid());

-- =========================================================================
-- 7. Backfill — populate from current win streaks so a fresh install
--               with existing matches doesn't have an empty chat
-- =========================================================================

insert into public.badminton_chat_messages
  (kind, user_id, match_type, streak_count, expires_at)
select 'system_streak', s.user_id, 'singles'::badminton_match_type, s.singles_streak,
       now() + interval '30 days'
from public.badminton_get_win_streaks() s
where s.singles_streak >= 2
on conflict do nothing;

insert into public.badminton_chat_messages
  (kind, user_id, match_type, streak_count, expires_at)
select 'system_streak', s.user_id, 'doubles'::badminton_match_type, s.doubles_streak,
       now() + interval '30 days'
from public.badminton_get_win_streaks() s
where s.doubles_streak >= 2
on conflict do nothing;


-- ======================================================================
-- supabase/migrations/0005_realtime.sql
-- ======================================================================
-- Add the chat tables and profiles to the supabase_realtime publication
-- so the client receives live INSERT / UPDATE / DELETE events. Without
-- these the chat panel only updates on a manual refresh and the home
-- unread badge never recomputes.
--
-- (matches and match_participants are added to the same publication
-- by 0001_init.sql and aren't repeated here.)
--
-- Folds 0014_chat_realtime.sql + 0015_profiles_realtime.sql.
-- Safe to rerun.

do $$ begin
  alter publication supabase_realtime add table public.badminton_chat_messages;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.badminton_chat_reactions;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.badminton_profiles;
exception when duplicate_object then null;
end $$;


-- ======================================================================
-- supabase/migrations/0006_unsend_window.sql
-- ======================================================================
-- Limit chat message deletion to a 10-minute window after sending.
-- The client UI hides the unsend button after the window closes, but
-- the server enforces the rule too so a clever user can't bypass via
-- direct API calls. Safe to rerun.
--
-- Tightens the existing 'Users can delete own chat messages' policy.

drop policy if exists "Users can delete own chat messages" on public.badminton_chat_messages;
create policy "Users can delete own chat messages"
  on public.badminton_chat_messages for delete
  to authenticated
  using (
    kind = 'user'
    and user_id = auth.uid()
    and created_at > now() - interval '10 minutes'
  );


-- ======================================================================
-- supabase/migrations/0007_seasons.sql
-- ======================================================================
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


-- ======================================================================
-- supabase/migrations/0008_admin_bans.sql
-- ======================================================================
-- Admin ban infrastructure.
--
-- Adds an is_banned flag (+ audit fields) to profiles, plus admin-only
-- RPCs for banning and unbanning users. Bans are non-destructive —
-- profile + match history stays intact; the user is just hidden from
-- the leaderboard / player picker and force-signed-out client-side.
--
-- ban_user has two extra guards over the obvious admin-only check:
--   * cannot ban yourself
--   * cannot ban another admin (defense in depth alongside the
--     client-side admin filter on the search dropdown)
-- and emits a `system_user_banned` moderation log line in chat.
-- unban is silent — no chat announcement, just flips the flag.
--
-- Safe to rerun.

-- =========================================================================
-- 1. Ban columns + index
-- =========================================================================

alter table public.badminton_profiles
  add column if not exists is_banned boolean not null default false,
  add column if not exists banned_at timestamptz,
  add column if not exists banned_by uuid references public.badminton_profiles(id) on delete set null,
  add column if not exists banned_reason text;

-- Partial index — most rows are not banned, so this stays tiny.
create index if not exists badminton_profiles_banned_idx
  on public.badminton_profiles (banned_at desc) where is_banned = true;

-- =========================================================================
-- 2. ban_user / unban_user RPCs
-- =========================================================================

create or replace function public.badminton_ban_user(
  p_target_id uuid,
  p_reason text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean;
  v_target_admin boolean;
  v_target_name text;
  v_admin_name text;
begin
  select is_admin into v_admin
    from public.badminton_profiles
   where id = auth.uid();
  if not coalesce(v_admin, false) then
    raise exception 'Only admins can ban users';
  end if;
  if p_target_id = auth.uid() then
    raise exception 'You cannot ban yourself';
  end if;

  select is_admin into v_target_admin
    from public.badminton_profiles
   where id = p_target_id;
  if coalesce(v_target_admin, false) then
    raise exception 'You cannot ban another admin';
  end if;

  update public.badminton_profiles
     set is_banned = true,
         banned_at = now(),
         banned_by = auth.uid(),
         banned_reason = nullif(trim(coalesce(p_reason, '')), '')
   where id = p_target_id
   returning display_name into v_target_name;

  select display_name into v_admin_name
    from public.badminton_profiles where id = auth.uid();

  -- Quiet centered grey log line in chat — broadcasts the ban to the
  -- club without breaking the streak/tier celebration cadence.
  insert into public.badminton_chat_messages
    (kind, user_id, body, expires_at)
  values (
    'system_user_banned',
    p_target_id,
    coalesce(v_target_name, 'A player') || ' banned by ' ||
      coalesce(v_admin_name, 'admin'),
    now() + interval '30 days'
  );
end;
$$;

grant execute on function public.badminton_ban_user(uuid, text) to authenticated;

create or replace function public.badminton_unban_user(p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean;
begin
  select is_admin into v_admin
    from public.badminton_profiles
   where id = auth.uid();
  if not coalesce(v_admin, false) then
    raise exception 'Only admins can unban users';
  end if;
  update public.badminton_profiles
     set is_banned = false,
         banned_at = null,
         banned_by = null,
         banned_reason = null
   where id = p_target_id;
end;
$$;

grant execute on function public.badminton_unban_user(uuid) to authenticated;


-- ======================================================================
-- supabase/migrations/0009_edit_pending_match.sql
-- ======================================================================
-- Edit a pending match — scores + players only, match_type is fixed.
--
-- Allowed when:
--   1) caller is the match's created_by
--   2) match.status = 'pending'
--   3) nobody besides the creator has accepted yet
-- Otherwise raises an exception.
--
-- The edit rewrites match_participants (delete + re-insert) so the
-- lineup can change freely. The creator is re-stamped as 'accepted'
-- automatically; everyone else starts at 'pending'. Match scores are
-- updated in place. The settle trigger doesn't fire because Team B
-- has zero accepts immediately after the rewrite.
--
-- Safe to rerun.

create or replace function public.badminton_update_pending_match(
  p_match_id uuid,
  p_partner_id uuid,                 -- nullable; pass NULL for singles
  p_opponent_ids uuid[],
  p_score_a int,
  p_score_b int
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  v_caller uuid := auth.uid();
begin
  select * into m from public.badminton_matches where id = p_match_id for update;
  if not found then
    raise exception 'Match not found';
  end if;
  if m.created_by <> v_caller then
    raise exception 'Only the match creator can edit it';
  end if;
  if m.status <> 'pending' then
    raise exception 'Match is no longer pending';
  end if;

  -- Guard: no non-creator may have accepted yet. We don't want to
  -- silently invalidate someone else's prior acceptance of the old
  -- data.
  if exists (
    select 1 from public.badminton_match_participants
     where match_id = p_match_id
       and user_id <> v_caller
       and confirmation = 'accepted'
  ) then
    raise exception 'Cannot edit — another player has already accepted';
  end if;

  -- Validate scores
  if p_score_a is null or p_score_b is null then
    raise exception 'Scores are required';
  end if;
  if p_score_a < 0 or p_score_b < 0 then
    raise exception 'Scores cannot be negative';
  end if;
  if p_score_a = p_score_b then
    raise exception 'Scores cannot be tied';
  end if;

  -- Validate participant count vs match_type (which is NOT editable)
  if m.match_type = 'singles' then
    if p_partner_id is not null then
      raise exception 'Singles has no partner';
    end if;
    if coalesce(array_length(p_opponent_ids, 1), 0) <> 1 then
      raise exception 'Singles needs exactly 1 opponent';
    end if;
  else
    if p_partner_id is null then
      raise exception 'Doubles needs a partner';
    end if;
    if coalesce(array_length(p_opponent_ids, 1), 0) <> 2 then
      raise exception 'Doubles needs exactly 2 opponents';
    end if;
    -- No duplicates
    if (
      select count(distinct id) from unnest(
        array[v_caller, p_partner_id] || p_opponent_ids
      ) as id
    ) <> 4 then
      raise exception 'Players must be unique';
    end if;
  end if;

  -- Apply: scores + participants
  update public.badminton_matches
     set score_a = p_score_a,
         score_b = p_score_b
   where id = p_match_id;

  delete from public.badminton_match_participants where match_id = p_match_id;

  insert into public.badminton_match_participants (match_id, user_id, team, confirmation)
  values (p_match_id, v_caller, 'A', 'accepted');

  if m.match_type = 'doubles' then
    insert into public.badminton_match_participants (match_id, user_id, team, confirmation)
    values (p_match_id, p_partner_id, 'A', 'pending');
  end if;

  insert into public.badminton_match_participants (match_id, user_id, team, confirmation)
  select p_match_id, opponent_id, 'B', 'pending'
    from unnest(p_opponent_ids) as opponent_id;
end;
$$;

grant execute on function public.badminton_update_pending_match(uuid, uuid, uuid[], int, int) to authenticated;


-- ======================================================================
-- supabase/migrations/0010_anonymous_player.sql
-- ======================================================================
-- Anonymous player feature.
--
-- A single shared "Anonymous" profile that real players can pick when a
-- missing person needs filling in (e.g. a guest who isn't signed up).
-- Properties:
--   * Pickable multiple times in the same match (e.g. two anonymous
--     opponents on team B). Enforced via a slot column on
--     match_participants (PK becomes match_id, user_id, slot) plus a
--     partial unique index that still blocks duplicate REAL players.
--   * Auto-accepts on insert (a BEFORE INSERT trigger stamps
--     confirmation='accepted').
--   * Matches involving anonymous never auto-settle — they enter a
--     new 'awaiting_admin' status. An admin approves via the Apex
--     Command page, which runs the full ELO settlement. Reject just
--     marks the match rejected.
--   * Anonymous's rating doesn't move from match outcomes. After every
--     settle (and once at provisioning), refresh_anonymous_rating()
--     resets it to the average of all real, non-banned players who
--     have played at least one game in that mode. This makes
--     anonymous a neutral opponent in the ELO math.
--   * Anonymous is hidden from leaderboard / season-reset ranking and
--     cannot be banned.
--
-- Safe to rerun.

-- =========================================================================
-- 1. is_anonymous column on profiles
-- =========================================================================

alter table public.badminton_profiles
  add column if not exists is_anonymous boolean not null default false;

create index if not exists badminton_profiles_anonymous_idx
  on public.badminton_profiles (id) where is_anonymous = true;

-- =========================================================================
-- 2. slot column on match_participants
--    Old PK (match_id, user_id) blocks duplicate anonymous slots, so we
--    widen the PK to include slot. A partial unique index keeps the
--    "no duplicate real players in one match" invariant.
-- =========================================================================

alter table public.badminton_match_participants
  add column if not exists slot smallint not null default 0;

do $$ begin
  alter table public.badminton_match_participants
    drop constraint if exists match_participants_pkey,
    drop constraint if exists badminton_match_participants_pkey;
exception when others then null;
end $$;

do $$ begin
  alter table public.badminton_match_participants
    add primary key (match_id, user_id, slot);
exception when invalid_table_definition then null;
       when duplicate_table then null;
end $$;

-- One row per real player per match. Anonymous (the only id that may
-- repeat) is exempted.
create unique index if not exists badminton_match_participants_unique_real_player
  on public.badminton_match_participants (match_id, user_id)
  where user_id <> '00000000-0000-0000-0000-000000000001'::uuid;

-- =========================================================================
-- 3. 'awaiting_admin' status value on badminton_match_status
-- =========================================================================

do $$ begin
  alter type badminton_match_status add value if not exists 'awaiting_admin';
exception when others then null;
end $$;

-- =========================================================================
-- 4. Anonymous backing account
--    Fixed UUID so the app can hard-code the reference. Created in
--    auth.users so the profiles FK to auth.users is satisfied; the
--    encrypted_password is a placeholder (never used for sign-in).
-- =========================================================================

create or replace function public.badminton_anonymous_user_id()
returns uuid
language sql
immutable
as $$
  select '00000000-0000-0000-0000-000000000001'::uuid;
$$;

grant execute on function public.badminton_anonymous_user_id() to authenticated, anon;

do $$
declare
  v_anon_id uuid := '00000000-0000-0000-0000-000000000001'::uuid;
begin
  if not exists (select 1 from auth.users where id = v_anon_id) then
    begin
      insert into auth.users (
        id, instance_id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data,
        is_super_admin, is_sso_user
      ) values (
        v_anon_id,
        '00000000-0000-0000-0000-000000000000'::uuid,
        'authenticated',
        'authenticated',
        'anonymous@badminton.local',
        '$2a$10$placeholderplaceholderplaceholderplaceholderplaceholder.x',
        now(),
        now(), now(),
        jsonb_build_object('provider', 'system'),
        jsonb_build_object('display_name', 'Anonymous'),
        false,
        false
      );
    exception when others then
      -- auth.users schema varies across Supabase versions; if the
      -- insert fails the admin can create the anonymous account
      -- manually via the dashboard with id = anonymous_user_id().
      raise notice 'Could not auto-create anonymous auth user: %', sqlerrm;
    end;
  end if;
end $$;

-- Ensure the profile row exists and is flagged. badminton_on_auth_user_created
-- from 0001 may have already auto-created it; this normalizes the
-- fields either way.
insert into public.badminton_profiles (id, display_name, is_anonymous)
values ('00000000-0000-0000-0000-000000000001'::uuid, 'Anonymous', true)
on conflict (id) do update
  set display_name = 'Anonymous',
      is_anonymous = true;

-- =========================================================================
-- 5. refresh_anonymous_rating — keeps anon at the club's average so it
--    plays as a neutral opponent in ELO math.
-- =========================================================================

create or replace function public.badminton_refresh_anonymous_rating()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  avg_s numeric;
  avg_d numeric;
begin
  select
    avg(singles_rating) filter (where singles_games_played > 0),
    avg(doubles_rating) filter (where doubles_games_played > 0)
    into avg_s, avg_d
  from public.badminton_profiles
  where is_anonymous = false
    and is_banned = false;

  update public.badminton_profiles
     set singles_rating = coalesce(round(avg_s)::int, 1000),
         doubles_rating = coalesce(round(avg_d)::int, 1000)
   where id = public.badminton_anonymous_user_id();
end;
$$;

grant execute on function public.badminton_refresh_anonymous_rating() to authenticated;

select public.badminton_refresh_anonymous_rating();

-- =========================================================================
-- 6. Auto-accept anonymous slots on insert
-- =========================================================================

create or replace function public.badminton_auto_accept_anonymous()
returns trigger
language plpgsql
as $$
begin
  if new.user_id = public.badminton_anonymous_user_id() then
    new.confirmation := 'accepted';
    new.responded_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_auto_accept_anonymous on public.badminton_match_participants;
create trigger trg_auto_accept_anonymous
  before insert on public.badminton_match_participants
  for each row execute function public.badminton_auto_accept_anonymous();

-- =========================================================================
-- 7. Refactor settle_match
--    settle_match now detects anonymous-tainted matches and routes them
--    to 'awaiting_admin' instead of confirming. _settle_match_elo holds
--    the actual ELO arithmetic and is shared between the normal flow
--    and the admin-approval path.
-- =========================================================================

create or replace function public.badminton__settle_match_elo(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  k_provisional constant int := 40;
  k_established constant int := 24;
  provisional_games constant int := 5;
  elo_divisor constant numeric := 400;
  margin_deadband constant int := 2;
  margin_divisor constant numeric := 21;
  margin_max_mult constant numeric := 2;
  v_anon uuid := public.badminton_anonymous_user_id();
  rating_a numeric;
  rating_b numeric;
  expected_a numeric;
  expected_b numeric;
  actual_a numeric;
  actual_b numeric;
  rating_col text;
  games_col text;
  peak_col text;
  participant record;
  current_rating int;
  current_games int;
  base_k int;
  effective_k numeric;
  team_actual numeric;
  team_expected numeric;
  delta int;
  score_diff int;
  margin_mult numeric;
  winning_team badminton_match_team;
begin
  select * into m from public.badminton_matches where id = p_match_id for update;
  if not found then
    return;
  end if;

  if m.match_type = 'singles' then
    rating_col := 'singles_rating';
    games_col := 'singles_games_played';
    peak_col := 'peak_singles_rating';
  else
    rating_col := 'doubles_rating';
    games_col := 'doubles_games_played';
    peak_col := 'peak_doubles_rating';
  end if;

  -- Team mean ratings — anonymous's rating (= club average) is included
  -- naturally because it's a real number on the profile row.
  execute format(
    'select avg(p.%I)::numeric
       from public.badminton_match_participants mp
       join public.badminton_profiles p on p.id = mp.user_id
      where mp.match_id = $1 and mp.team = $2::badminton_match_team',
    rating_col
  ) using p_match_id, 'A' into rating_a;

  execute format(
    'select avg(p.%I)::numeric
       from public.badminton_match_participants mp
       join public.badminton_profiles p on p.id = mp.user_id
      where mp.match_id = $1 and mp.team = $2::badminton_match_team',
    rating_col
  ) using p_match_id, 'B' into rating_b;

  expected_a := 1 / (1 + power(10, (rating_b - rating_a) / elo_divisor));
  expected_b := 1 - expected_a;

  if m.score_a > m.score_b then
    actual_a := 1; actual_b := 0;
    winning_team := 'A';
  else
    actual_a := 0; actual_b := 1;
    winning_team := 'B';
  end if;

  score_diff := abs(m.score_a - m.score_b);
  margin_mult := least(
    margin_max_mult,
    1 + greatest(0, score_diff - margin_deadband)::numeric / margin_divisor
  );

  -- Loop every slot. Anonymous slots: stamp rating_before/after/delta
  -- = (current, current, 0) so the participant row is consistent, but
  -- skip the profile update — anonymous's rating is recomputed at the
  -- end via refresh_anonymous_rating().
  for participant in
    select user_id, team, slot
      from public.badminton_match_participants
     where match_id = p_match_id
  loop
    execute format('select %I, %I from public.badminton_profiles where id = $1', rating_col, games_col)
      using participant.user_id into current_rating, current_games;

    if participant.user_id = v_anon then
      update public.badminton_match_participants
         set rating_before = current_rating,
             rating_after = current_rating,
             rating_delta = 0
       where match_id = p_match_id
         and user_id = participant.user_id
         and slot = participant.slot;
      continue;
    end if;

    base_k := case when current_games < provisional_games then k_provisional else k_established end;

    if participant.team = winning_team then
      effective_k := base_k * margin_mult;
    else
      effective_k := base_k;
    end if;

    if participant.team = 'A' then
      team_actual := actual_a; team_expected := expected_a;
    else
      team_actual := actual_b; team_expected := expected_b;
    end if;

    delta := round(effective_k * (team_actual - team_expected));

    update public.badminton_match_participants
       set rating_before = current_rating,
           rating_after = current_rating + delta,
           rating_delta = delta
     where match_id = p_match_id
       and user_id = participant.user_id
       and slot = participant.slot;

    execute format(
      'update public.badminton_profiles
          set %I = %I + $1,
              %I = %I + 1,
              %I = greatest(%I, %I + $1)
        where id = $2',
      rating_col, rating_col,
      games_col, games_col,
      peak_col, peak_col, rating_col
    ) using delta, participant.user_id;
  end loop;

  update public.badminton_matches
     set status = 'confirmed', confirmed_at = now(), elo_version = 2
   where id = p_match_id;

  -- Anonymous's rating drifts with the club average. Recompute after
  -- every settlement so the next match using anonymous uses the
  -- up-to-date avg.
  perform public.badminton_refresh_anonymous_rating();
end;
$$;

create or replace function public.badminton_settle_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  has_anon boolean;
begin
  select * into m from public.badminton_matches where id = p_match_id for update;
  if not found or m.status <> 'pending' then
    return;
  end if;

  -- One acceptance per team is enough. Bail if either side has none.
  if not exists (
    select 1 from public.badminton_match_participants
     where match_id = p_match_id and team = 'A' and confirmation = 'accepted'
  ) or not exists (
    select 1 from public.badminton_match_participants
     where match_id = p_match_id and team = 'B' and confirmation = 'accepted'
  ) then
    return;
  end if;

  -- Anonymous-tainted? Park for admin approval — the extra layer is
  -- specifically to prevent abuse of the auto-accept flow.
  select exists (
    select 1 from public.badminton_match_participants
     where match_id = p_match_id
       and user_id = public.badminton_anonymous_user_id()
  ) into has_anon;

  if has_anon then
    update public.badminton_matches
       set status = 'awaiting_admin'
     where id = p_match_id;
    return;
  end if;

  perform public.badminton__settle_match_elo(p_match_id);
end;
$$;

-- =========================================================================
-- 8. Admin approve / reject RPCs
-- =========================================================================

create or replace function public.badminton_approve_anonymous_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean;
  v_status badminton_match_status;
begin
  select is_admin into v_admin
    from public.badminton_profiles where id = auth.uid();
  if not coalesce(v_admin, false) then
    raise exception 'Only admins can approve matches';
  end if;

  select status into v_status
    from public.badminton_matches where id = p_match_id for update;
  if v_status is null then
    raise exception 'Match not found';
  end if;
  if v_status <> 'awaiting_admin' then
    raise exception 'Match is not awaiting admin approval';
  end if;

  perform public.badminton__settle_match_elo(p_match_id);
end;
$$;

grant execute on function public.badminton_approve_anonymous_match(uuid) to authenticated;

create or replace function public.badminton_reject_anonymous_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean;
  v_status badminton_match_status;
begin
  select is_admin into v_admin
    from public.badminton_profiles where id = auth.uid();
  if not coalesce(v_admin, false) then
    raise exception 'Only admins can reject matches';
  end if;

  select status into v_status
    from public.badminton_matches where id = p_match_id for update;
  if v_status is null then
    raise exception 'Match not found';
  end if;
  if v_status <> 'awaiting_admin' then
    raise exception 'Match is not awaiting admin approval';
  end if;

  update public.badminton_matches
     set status = 'rejected'
   where id = p_match_id;
end;
$$;

grant execute on function public.badminton_reject_anonymous_match(uuid) to authenticated;

-- =========================================================================
-- 9. RLS — admins need to read awaiting-admin matches + participants
--    even when not a participant themselves.
-- =========================================================================

create or replace function public.badminton_is_caller_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_admin from public.badminton_profiles where id = auth.uid()),
    false
  );
$$;

grant execute on function public.badminton_is_caller_admin() to authenticated;

drop policy if exists "Matches visible to participants" on public.badminton_matches;
create policy "Matches visible to participants"
  on public.badminton_matches for select
  to authenticated
  using (
    auth.uid() = created_by
    or public.badminton_is_match_participant(id, auth.uid())
    or public.badminton_is_caller_admin()
  );

drop policy if exists "Participants visible to involved users" on public.badminton_match_participants;
create policy "Participants visible to involved users"
  on public.badminton_match_participants for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.badminton_is_match_participant(match_id, auth.uid())
    or exists (
      select 1 from public.badminton_matches m
       where m.id = badminton_match_participants.match_id and m.created_by = auth.uid()
    )
    or public.badminton_is_caller_admin()
  );

-- =========================================================================
-- 10. Anti-foot-gun guards
-- =========================================================================

-- ban_user must refuse the anonymous account.
create or replace function public.badminton_ban_user(
  p_target_id uuid,
  p_reason text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean;
  v_target_admin boolean;
  v_target_anon boolean;
  v_target_name text;
  v_admin_name text;
begin
  select is_admin into v_admin
    from public.badminton_profiles
   where id = auth.uid();
  if not coalesce(v_admin, false) then
    raise exception 'Only admins can ban users';
  end if;
  if p_target_id = auth.uid() then
    raise exception 'You cannot ban yourself';
  end if;
  if p_target_id = public.badminton_anonymous_user_id() then
    raise exception 'You cannot ban the anonymous player';
  end if;

  select is_admin, is_anonymous into v_target_admin, v_target_anon
    from public.badminton_profiles
   where id = p_target_id;
  if coalesce(v_target_admin, false) then
    raise exception 'You cannot ban another admin';
  end if;
  if coalesce(v_target_anon, false) then
    raise exception 'You cannot ban the anonymous player';
  end if;

  update public.badminton_profiles
     set is_banned = true,
         banned_at = now(),
         banned_by = auth.uid(),
         banned_reason = nullif(trim(coalesce(p_reason, '')), '')
   where id = p_target_id
   returning display_name into v_target_name;

  select display_name into v_admin_name
    from public.badminton_profiles where id = auth.uid();

  insert into public.badminton_chat_messages
    (kind, user_id, body, expires_at)
  values (
    'system_user_banned',
    p_target_id,
    coalesce(v_target_name, 'A player') || ' banned by ' ||
      coalesce(v_admin_name, 'admin'),
    now() + interval '30 days'
  );

  -- The newly-banned player drops out of the active pool, which can
  -- shift the club average. Recompute anonymous's rating so the next
  -- match using anon prices it correctly.
  perform public.badminton_refresh_anonymous_rating();
end;
$$;

grant execute on function public.badminton_ban_user(uuid, text) to authenticated;

-- unban_user — same refresh reasoning. Override the version from 0008.
create or replace function public.badminton_unban_user(p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean;
begin
  select is_admin into v_admin
    from public.badminton_profiles
   where id = auth.uid();
  if not coalesce(v_admin, false) then
    raise exception 'Only admins can unban users';
  end if;
  update public.badminton_profiles
     set is_banned = false,
         banned_at = null,
         banned_by = null,
         banned_reason = null
   where id = p_target_id;

  perform public.badminton_refresh_anonymous_rating();
end;
$$;

grant execute on function public.badminton_unban_user(uuid) to authenticated;

-- =========================================================================
-- 11. update_pending_match — relax uniqueness for anonymous
-- =========================================================================

create or replace function public.badminton_update_pending_match(
  p_match_id uuid,
  p_partner_id uuid,
  p_opponent_ids uuid[],
  p_score_a int,
  p_score_b int
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  v_caller uuid := auth.uid();
  v_anon uuid := public.badminton_anonymous_user_id();
  v_idx int;
  v_oid uuid;
  v_slot_counter jsonb := '{}'::jsonb;
  v_slot int;
begin
  select * into m from public.badminton_matches where id = p_match_id for update;
  if not found then
    raise exception 'Match not found';
  end if;
  if m.created_by <> v_caller then
    raise exception 'Only the match creator can edit it';
  end if;
  if m.status <> 'pending' then
    raise exception 'Match is no longer pending';
  end if;

  if exists (
    select 1 from public.badminton_match_participants
     where match_id = p_match_id
       and user_id <> v_caller
       and confirmation = 'accepted'
       and user_id <> v_anon
  ) then
    raise exception 'Cannot edit — another player has already accepted';
  end if;

  if p_score_a is null or p_score_b is null then
    raise exception 'Scores are required';
  end if;
  if p_score_a < 0 or p_score_b < 0 then
    raise exception 'Scores cannot be negative';
  end if;
  if p_score_a = p_score_b then
    raise exception 'Scores cannot be tied';
  end if;

  if m.match_type = 'singles' then
    if p_partner_id is not null then
      raise exception 'Singles has no partner';
    end if;
    if coalesce(array_length(p_opponent_ids, 1), 0) <> 1 then
      raise exception 'Singles needs exactly 1 opponent';
    end if;
  else
    if p_partner_id is null then
      raise exception 'Doubles needs a partner';
    end if;
    if coalesce(array_length(p_opponent_ids, 1), 0) <> 2 then
      raise exception 'Doubles needs exactly 2 opponents';
    end if;

    -- Uniqueness check excludes anonymous — it may legitimately
    -- appear in multiple slots.
    if (
      select count(*) from (
        select id
          from unnest(array[v_caller, p_partner_id] || p_opponent_ids) as id
         where id <> v_anon
        group by id
        having count(*) > 1
      ) dups
    ) > 0 then
      raise exception 'Players must be unique';
    end if;
  end if;

  update public.badminton_matches
     set score_a = p_score_a,
         score_b = p_score_b
   where id = p_match_id;

  delete from public.badminton_match_participants where match_id = p_match_id;

  -- Re-insert with slot indices. Slot starts at 0 for each user_id and
  -- increments per duplicate (only anonymous can duplicate). Anonymous
  -- rows auto-accept via the BEFORE INSERT trigger.
  insert into public.badminton_match_participants (match_id, user_id, team, slot, confirmation)
  values (p_match_id, v_caller, 'A', 0, 'accepted');

  if m.match_type = 'doubles' then
    v_slot := case when p_partner_id = v_anon then 0 else 0 end;
    insert into public.badminton_match_participants (match_id, user_id, team, slot, confirmation)
    values (p_match_id, p_partner_id, 'A', v_slot, 'pending');
    if p_partner_id = v_anon then
      v_slot_counter := jsonb_set(
        v_slot_counter, array[v_anon::text], to_jsonb(1)
      );
    end if;
  end if;

  v_idx := 0;
  foreach v_oid in array p_opponent_ids loop
    if v_oid = v_anon then
      v_slot := coalesce((v_slot_counter->>v_anon::text)::int, 0);
      v_slot_counter := jsonb_set(
        v_slot_counter, array[v_anon::text], to_jsonb(v_slot + 1)
      );
    else
      v_slot := 0;
    end if;
    insert into public.badminton_match_participants (match_id, user_id, team, slot, confirmation)
    values (p_match_id, v_oid, 'B', v_slot, 'pending');
    v_idx := v_idx + 1;
  end loop;
end;
$$;

grant execute on function public.badminton_update_pending_match(uuid, uuid, uuid[], int, int) to authenticated;


-- ======================================================================
-- supabase/migrations/0011_shards.sql
-- ======================================================================
-- Shard economy + shop shields.
--
-- Currency rules (awarded when a match settles):
--   * 5 shards just for playing (win or lose)
--   * +5 for winning (so 10 total for a win)
--   * +5 underdog bonus if the winning team's average tier is at
--     least 2 ranks below the losing team's average tier
--     (so 15 total for an underdog win)
--
-- Placement players (< 5 games in the mode) count as tier 0 (below
-- Bronze) for the underdog check — so a placement player beating a
-- Silver+ opponent triggers the bonus, which feels right for upsets.
--
-- Anonymous slots never earn shards (it isn't a real player) and are
-- excluded from the team-tier averages so they don't dilute the gap.
--
-- Shop items (v1) — single armed shield slot per player, shared
-- across singles + doubles:
--   * Iron Shield  (60 shards) — blocks 50% of next ELO loss
--   * Aura Shield  (110 shards) — blocks 100% of next ELO loss
-- A shield only consumes on a LOSS (rating_delta < 0). Wins, draws,
-- and unsettled matches leave it armed. Players can only hold one
-- shield at a time (buying is blocked while armed).
--
-- shards_earned and shield_consumed are stamped onto each
-- match_participants row alongside the ELO delta so we can later
-- break down "where did my shards/protection come from" in the UI.
--
-- Safe to rerun.

-- =========================================================================
-- 1. Columns
-- =========================================================================

alter table public.badminton_profiles
  add column if not exists shards int not null default 0
    check (shards >= 0);

-- One armed shield slot per profile. Values: null | 'iron' | 'aura'.
-- Consumed by _settle_match_elo on the first match where the player
-- takes a rating loss; cleared on use. Wins keep it armed.
alter table public.badminton_profiles
  add column if not exists armed_shield text;

do $$ begin
  alter table public.badminton_profiles
    add constraint profiles_armed_shield_chk
    check (armed_shield is null or armed_shield in ('iron', 'aura'));
exception when duplicate_object then null;
end $$;

alter table public.badminton_match_participants
  add column if not exists shards_earned int not null default 0
    check (shards_earned >= 0);

-- Which shield (if any) absorbed this loss. Mirrors badminton_profiles.armed_shield
-- values so the UI can render "Iron blocked 12 ELO" later.
alter table public.badminton_match_participants
  add column if not exists shield_consumed text;

do $$ begin
  alter table public.badminton_match_participants
    add constraint match_participants_shield_consumed_chk
    check (shield_consumed is null or shield_consumed in ('iron', 'aura'));
exception when duplicate_object then null;
end $$;

create index if not exists badminton_profiles_shards_idx
  on public.badminton_profiles (shards desc);

-- =========================================================================
-- 2. effective_tier_rank — placement-aware wrapper around tier_rank
--    Placement players (< 5 games in mode) → 0 (below Bronze).
-- =========================================================================

create or replace function public.badminton_effective_tier_rank(
  p_rating int,
  p_games int
) returns int
language sql
immutable
as $$
  select case
    when p_games < 5 then 0
    else public.badminton_tier_rank(public.badminton_rating_to_tier_key(p_rating))
  end;
$$;

grant execute on function public.badminton_effective_tier_rank(int, int) to authenticated;

-- =========================================================================
-- 3. _settle_match_elo — extend with shard awards
--    The body is duplicated from 0010 with two additions:
--      (a) compute per-team avg tier rank up front (real players only)
--      (b) inside the participant loop, award shards based on
--          win/lose + underdog status, stamp the row, bump the
--          profile balance.
-- =========================================================================

create or replace function public.badminton__settle_match_elo(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  k_provisional constant int := 40;
  k_established constant int := 24;
  provisional_games constant int := 5;
  elo_divisor constant numeric := 400;
  margin_deadband constant int := 2;
  margin_divisor constant numeric := 21;
  margin_max_mult constant numeric := 2;
  shards_play constant int := 5;
  shards_win constant int := 5;
  shards_underdog constant int := 5;
  underdog_gap constant int := 2;
  v_anon uuid := public.badminton_anonymous_user_id();
  v_shield text;
  v_raw_delta int;
  v_blocked_amount int;
  rating_a numeric;
  rating_b numeric;
  expected_a numeric;
  expected_b numeric;
  actual_a numeric;
  actual_b numeric;
  rating_col text;
  games_col text;
  peak_col text;
  participant record;
  current_rating int;
  current_games int;
  base_k int;
  effective_k numeric;
  team_actual numeric;
  team_expected numeric;
  delta int;
  score_diff int;
  margin_mult numeric;
  winning_team badminton_match_team;
  tier_avg_a numeric;
  tier_avg_b numeric;
  is_underdog_win boolean;
  shards_for_player int;
begin
  select * into m from public.badminton_matches where id = p_match_id for update;
  if not found then
    return;
  end if;

  if m.match_type = 'singles' then
    rating_col := 'singles_rating';
    games_col := 'singles_games_played';
    peak_col := 'peak_singles_rating';
  else
    rating_col := 'doubles_rating';
    games_col := 'doubles_games_played';
    peak_col := 'peak_doubles_rating';
  end if;

  -- Team mean ratings — anonymous's rating is included naturally.
  execute format(
    'select avg(p.%I)::numeric
       from public.badminton_match_participants mp
       join public.badminton_profiles p on p.id = mp.user_id
      where mp.match_id = $1 and mp.team = $2::badminton_match_team',
    rating_col
  ) using p_match_id, 'A' into rating_a;

  execute format(
    'select avg(p.%I)::numeric
       from public.badminton_match_participants mp
       join public.badminton_profiles p on p.id = mp.user_id
      where mp.match_id = $1 and mp.team = $2::badminton_match_team',
    rating_col
  ) using p_match_id, 'B' into rating_b;

  expected_a := 1 / (1 + power(10, (rating_b - rating_a) / elo_divisor));
  expected_b := 1 - expected_a;

  if m.score_a > m.score_b then
    actual_a := 1; actual_b := 0;
    winning_team := 'A';
  else
    actual_a := 0; actual_b := 1;
    winning_team := 'B';
  end if;

  score_diff := abs(m.score_a - m.score_b);
  margin_mult := least(
    margin_max_mult,
    1 + greatest(0, score_diff - margin_deadband)::numeric / margin_divisor
  );

  -- Per-team avg tier rank — REAL players only. Anonymous excluded so
  -- it doesn't shift the gap. NULL if a team is all anonymous (in which
  -- case underdog can't be computed and the bonus simply doesn't fire).
  execute format(
    'select avg(public.badminton_effective_tier_rank(p.%I, p.%I))::numeric
       from public.badminton_match_participants mp
       join public.badminton_profiles p on p.id = mp.user_id
      where mp.match_id = $1 and mp.team = $2::badminton_match_team
        and mp.user_id <> $3',
    rating_col, games_col
  ) using p_match_id, 'A', v_anon into tier_avg_a;

  execute format(
    'select avg(public.badminton_effective_tier_rank(p.%I, p.%I))::numeric
       from public.badminton_match_participants mp
       join public.badminton_profiles p on p.id = mp.user_id
      where mp.match_id = $1 and mp.team = $2::badminton_match_team
        and mp.user_id <> $3',
    rating_col, games_col
  ) using p_match_id, 'B', v_anon into tier_avg_b;

  is_underdog_win := false;
  if tier_avg_a is not null and tier_avg_b is not null then
    if winning_team = 'A' and (tier_avg_b - tier_avg_a) >= underdog_gap then
      is_underdog_win := true;
    elsif winning_team = 'B' and (tier_avg_a - tier_avg_b) >= underdog_gap then
      is_underdog_win := true;
    end if;
  end if;

  -- Loop every slot. Anonymous slots get rating_before/after=current,
  -- delta=0, and shards_earned=0 — no payouts to a system account.
  for participant in
    select user_id, team, slot
      from public.badminton_match_participants
     where match_id = p_match_id
  loop
    execute format('select %I, %I from public.badminton_profiles where id = $1', rating_col, games_col)
      using participant.user_id into current_rating, current_games;

    if participant.user_id = v_anon then
      update public.badminton_match_participants
         set rating_before = current_rating,
             rating_after = current_rating,
             rating_delta = 0,
             shards_earned = 0
       where match_id = p_match_id
         and user_id = participant.user_id
         and slot = participant.slot;
      continue;
    end if;

    base_k := case when current_games < provisional_games then k_provisional else k_established end;

    if participant.team = winning_team then
      effective_k := base_k * margin_mult;
    else
      effective_k := base_k;
    end if;

    if participant.team = 'A' then
      team_actual := actual_a; team_expected := expected_a;
    else
      team_actual := actual_b; team_expected := expected_b;
    end if;

    v_raw_delta := round(effective_k * (team_actual - team_expected));
    delta := v_raw_delta;
    v_shield := null;
    v_blocked_amount := 0;

    -- Shield consumption — only triggers on an actual loss (delta < 0).
    -- Iron blocks 50%, Aura blocks 100%. The shield slot is cleared in
    -- the same UPDATE that applies the rating change so a second
    -- match in the same batch can't double-spend it.
    if v_raw_delta < 0 then
      select armed_shield into v_shield
        from public.badminton_profiles where id = participant.user_id;
      if v_shield = 'iron' then
        delta := round(v_raw_delta::numeric / 2);
        v_blocked_amount := v_raw_delta - delta;  -- both negative; diff is the saved amount
      elsif v_shield = 'aura' then
        delta := 0;
        v_blocked_amount := -v_raw_delta;
      else
        v_shield := null;
      end if;
    end if;

    -- Shard payout: 5 (play) + 5 (win) + 5 (underdog win)
    if participant.team = winning_team then
      shards_for_player := shards_play + shards_win
                          + case when is_underdog_win then shards_underdog else 0 end;
    else
      shards_for_player := shards_play;
    end if;

    update public.badminton_match_participants
       set rating_before = current_rating,
           rating_after = current_rating + delta,
           rating_delta = delta,
           shards_earned = shards_for_player,
           shield_consumed = v_shield
     where match_id = p_match_id
       and user_id = participant.user_id
       and slot = participant.slot;

    -- Apply rating + games + peak + shards + clear shield (if consumed).
    -- Clearing happens via case-when so non-consumed rows are untouched.
    execute format(
      'update public.badminton_profiles
          set %I = %I + $1,
              %I = %I + 1,
              %I = greatest(%I, %I + $1),
              shards = shards + $3,
              armed_shield = case when $4::text is not null then null else armed_shield end
        where id = $2',
      rating_col, rating_col,
      games_col, games_col,
      peak_col, peak_col, rating_col
    ) using delta, participant.user_id, shards_for_player, v_shield;

    -- Hush unused warning when not in a loss branch
    perform v_blocked_amount;
  end loop;

  update public.badminton_matches
     set status = 'confirmed', confirmed_at = now(), elo_version = 2
   where id = p_match_id;

  -- Anonymous's rating drifts with the club average.
  perform public.badminton_refresh_anonymous_rating();
end;
$$;

-- =========================================================================
-- 4. buy_shield — atomic deduct-and-arm.
--    Validates: signed in, not anonymous, kind is iron|aura, no shield
--    already armed, sufficient shards. Decrements shards by the cost
--    and sets armed_shield in a single UPDATE so a double-click can't
--    buy twice.
-- =========================================================================

create or replace function public.badminton_buy_shield(p_kind text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_cost int;
  v_current int;
  v_armed text;
  v_new_balance int;
begin
  if v_caller is null then
    raise exception 'Must be signed in';
  end if;
  if v_caller = public.badminton_anonymous_user_id() then
    raise exception 'Anonymous cannot buy';
  end if;

  if p_kind = 'iron' then
    v_cost := 60;
  elsif p_kind = 'aura' then
    v_cost := 110;
  else
    raise exception 'Unknown shield: %', p_kind;
  end if;

  select shards, armed_shield into v_current, v_armed
    from public.badminton_profiles where id = v_caller for update;

  if v_armed is not null then
    raise exception 'A shield is already armed';
  end if;
  if coalesce(v_current, 0) < v_cost then
    raise exception 'Not enough shards (need %, have %)', v_cost, coalesce(v_current, 0);
  end if;

  update public.badminton_profiles
     set shards = shards - v_cost,
         armed_shield = p_kind
   where id = v_caller
   returning shards into v_new_balance;

  return v_new_balance;
end;
$$;

grant execute on function public.badminton_buy_shield(text) to authenticated;


-- ======================================================================
-- supabase/migrations/0012_boosters.sql
-- ======================================================================
-- Shop boosters — a second consumable slot, separate from shields.
--
-- v1 ships one booster:
--   * Shuttle Strike (50 shards) — your NEXT WIN gives +5 extra ELO
--     on top of the normal delta. Losses keep it armed. Singles or
--     doubles, whichever you win first.
--
-- Design choices:
--   * Separate slot from armed_shield, so a player can have a shield
--     AND a booster active simultaneously. They target opposite
--     outcomes (shield = mitigate loss, booster = amplify win), so
--     stacking is intentional.
--   * Buying is blocked while the slot is occupied (same UX as
--     shields — one at a time, no upgrade path in v1).
--   * armed_booster / booster_consumed are open text columns (not an
--     enum) so adding new booster kinds later is just a code change.
--
-- Safe to rerun.

-- =========================================================================
-- 1. Columns
-- =========================================================================

alter table public.badminton_profiles
  add column if not exists armed_booster text;

do $$ begin
  alter table public.badminton_profiles
    add constraint profiles_armed_booster_chk
    check (armed_booster is null or armed_booster in ('shuttle'));
exception when duplicate_object then null;
end $$;

alter table public.badminton_match_participants
  add column if not exists booster_consumed text;

do $$ begin
  alter table public.badminton_match_participants
    add constraint match_participants_booster_consumed_chk
    check (booster_consumed is null or booster_consumed in ('shuttle'));
exception when duplicate_object then null;
end $$;

-- =========================================================================
-- 2. _settle_match_elo — apply booster bonus on a win
--
-- This is the third override of this function (after 0010 → 0011).
-- Differences vs 0011:
--   (a) declare v_booster + v_booster_bonus
--   (b) AFTER shield logic and BEFORE writing the participant row,
--       if the player won (raw delta > 0), check armed_booster and
--       add the bonus
--   (c) clear armed_booster in the same UPDATE that applies the
--       rating change
-- =========================================================================

create or replace function public.badminton__settle_match_elo(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  k_provisional constant int := 40;
  k_established constant int := 24;
  provisional_games constant int := 5;
  elo_divisor constant numeric := 400;
  margin_deadband constant int := 2;
  margin_divisor constant numeric := 21;
  margin_max_mult constant numeric := 2;
  shards_play constant int := 5;
  shards_win constant int := 5;
  shards_underdog constant int := 5;
  underdog_gap constant int := 2;
  shuttle_bonus constant int := 5;
  v_anon uuid := public.badminton_anonymous_user_id();
  v_shield text;
  v_booster text;
  v_raw_delta int;
  rating_a numeric;
  rating_b numeric;
  expected_a numeric;
  expected_b numeric;
  actual_a numeric;
  actual_b numeric;
  rating_col text;
  games_col text;
  peak_col text;
  participant record;
  current_rating int;
  current_games int;
  base_k int;
  effective_k numeric;
  team_actual numeric;
  team_expected numeric;
  delta int;
  score_diff int;
  margin_mult numeric;
  winning_team badminton_match_team;
  tier_avg_a numeric;
  tier_avg_b numeric;
  is_underdog_win boolean;
  shards_for_player int;
begin
  select * into m from public.badminton_matches where id = p_match_id for update;
  if not found then
    return;
  end if;

  if m.match_type = 'singles' then
    rating_col := 'singles_rating';
    games_col := 'singles_games_played';
    peak_col := 'peak_singles_rating';
  else
    rating_col := 'doubles_rating';
    games_col := 'doubles_games_played';
    peak_col := 'peak_doubles_rating';
  end if;

  execute format(
    'select avg(p.%I)::numeric
       from public.badminton_match_participants mp
       join public.badminton_profiles p on p.id = mp.user_id
      where mp.match_id = $1 and mp.team = $2::badminton_match_team',
    rating_col
  ) using p_match_id, 'A' into rating_a;

  execute format(
    'select avg(p.%I)::numeric
       from public.badminton_match_participants mp
       join public.badminton_profiles p on p.id = mp.user_id
      where mp.match_id = $1 and mp.team = $2::badminton_match_team',
    rating_col
  ) using p_match_id, 'B' into rating_b;

  expected_a := 1 / (1 + power(10, (rating_b - rating_a) / elo_divisor));
  expected_b := 1 - expected_a;

  if m.score_a > m.score_b then
    actual_a := 1; actual_b := 0;
    winning_team := 'A';
  else
    actual_a := 0; actual_b := 1;
    winning_team := 'B';
  end if;

  score_diff := abs(m.score_a - m.score_b);
  margin_mult := least(
    margin_max_mult,
    1 + greatest(0, score_diff - margin_deadband)::numeric / margin_divisor
  );

  execute format(
    'select avg(public.badminton_effective_tier_rank(p.%I, p.%I))::numeric
       from public.badminton_match_participants mp
       join public.badminton_profiles p on p.id = mp.user_id
      where mp.match_id = $1 and mp.team = $2::badminton_match_team
        and mp.user_id <> $3',
    rating_col, games_col
  ) using p_match_id, 'A', v_anon into tier_avg_a;

  execute format(
    'select avg(public.badminton_effective_tier_rank(p.%I, p.%I))::numeric
       from public.badminton_match_participants mp
       join public.badminton_profiles p on p.id = mp.user_id
      where mp.match_id = $1 and mp.team = $2::badminton_match_team
        and mp.user_id <> $3',
    rating_col, games_col
  ) using p_match_id, 'B', v_anon into tier_avg_b;

  is_underdog_win := false;
  if tier_avg_a is not null and tier_avg_b is not null then
    if winning_team = 'A' and (tier_avg_b - tier_avg_a) >= underdog_gap then
      is_underdog_win := true;
    elsif winning_team = 'B' and (tier_avg_a - tier_avg_b) >= underdog_gap then
      is_underdog_win := true;
    end if;
  end if;

  for participant in
    select user_id, team, slot
      from public.badminton_match_participants
     where match_id = p_match_id
  loop
    execute format('select %I, %I from public.badminton_profiles where id = $1', rating_col, games_col)
      using participant.user_id into current_rating, current_games;

    if participant.user_id = v_anon then
      update public.badminton_match_participants
         set rating_before = current_rating,
             rating_after = current_rating,
             rating_delta = 0,
             shards_earned = 0
       where match_id = p_match_id
         and user_id = participant.user_id
         and slot = participant.slot;
      continue;
    end if;

    base_k := case when current_games < provisional_games then k_provisional else k_established end;

    if participant.team = winning_team then
      effective_k := base_k * margin_mult;
    else
      effective_k := base_k;
    end if;

    if participant.team = 'A' then
      team_actual := actual_a; team_expected := expected_a;
    else
      team_actual := actual_b; team_expected := expected_b;
    end if;

    v_raw_delta := round(effective_k * (team_actual - team_expected));
    delta := v_raw_delta;
    v_shield := null;
    v_booster := null;

    -- Shield consumption — only on an actual loss.
    if v_raw_delta < 0 then
      select armed_shield into v_shield
        from public.badminton_profiles where id = participant.user_id;
      if v_shield = 'iron' then
        delta := round(v_raw_delta::numeric / 2);
      elsif v_shield = 'aura' then
        delta := 0;
      else
        v_shield := null;
      end if;
    end if;

    -- Booster consumption — only on an actual win.
    -- Note: applied to the raw delta sign, NOT the post-shield delta,
    -- since a shield + win can't co-occur (shields trigger on loss).
    if v_raw_delta > 0 then
      select armed_booster into v_booster
        from public.badminton_profiles where id = participant.user_id;
      if v_booster = 'shuttle' then
        delta := delta + shuttle_bonus;
      else
        v_booster := null;
      end if;
    end if;

    if participant.team = winning_team then
      shards_for_player := shards_play + shards_win
                          + case when is_underdog_win then shards_underdog else 0 end;
    else
      shards_for_player := shards_play;
    end if;

    update public.badminton_match_participants
       set rating_before = current_rating,
           rating_after = current_rating + delta,
           rating_delta = delta,
           shards_earned = shards_for_player,
           shield_consumed = v_shield,
           booster_consumed = v_booster
     where match_id = p_match_id
       and user_id = participant.user_id
       and slot = participant.slot;

    -- Apply rating + games + peak + shards + clear consumed slots.
    -- Both shield and booster can clear in the same UPDATE.
    execute format(
      'update public.badminton_profiles
          set %I = %I + $1,
              %I = %I + 1,
              %I = greatest(%I, %I + $1),
              shards = shards + $3,
              armed_shield = case when $4::text is not null then null else armed_shield end,
              armed_booster = case when $5::text is not null then null else armed_booster end
        where id = $2',
      rating_col, rating_col,
      games_col, games_col,
      peak_col, peak_col, rating_col
    ) using delta, participant.user_id, shards_for_player, v_shield, v_booster;
  end loop;

  update public.badminton_matches
     set status = 'confirmed', confirmed_at = now(), elo_version = 2
   where id = p_match_id;

  perform public.badminton_refresh_anonymous_rating();
end;
$$;

-- =========================================================================
-- 3. buy_booster — atomic deduct-and-arm (mirrors buy_shield)
-- =========================================================================

create or replace function public.badminton_buy_booster(p_kind text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_cost int;
  v_current int;
  v_armed text;
  v_new_balance int;
begin
  if v_caller is null then
    raise exception 'Must be signed in';
  end if;
  if v_caller = public.badminton_anonymous_user_id() then
    raise exception 'Anonymous cannot buy';
  end if;

  if p_kind = 'shuttle' then
    v_cost := 50;
  else
    raise exception 'Unknown booster: %', p_kind;
  end if;

  select shards, armed_booster into v_current, v_armed
    from public.badminton_profiles where id = v_caller for update;

  if v_armed is not null then
    raise exception 'A booster is already armed';
  end if;
  if coalesce(v_current, 0) < v_cost then
    raise exception 'Not enough shards (need %, have %)', v_cost, coalesce(v_current, 0);
  end if;

  update public.badminton_profiles
     set shards = shards - v_cost,
         armed_booster = p_kind
   where id = v_caller
   returning shards into v_new_balance;

  return v_new_balance;
end;
$$;

grant execute on function public.badminton_buy_booster(text) to authenticated;


-- ======================================================================
-- supabase/migrations/0013_pets.sql
-- ======================================================================
-- Pets — permanent shop unlocks (unlike shields/boosters, never consumed).
--
-- v1 ships four tiered dino pets — price + a minimum tier rank gate.
-- Eligibility is the player's BEST tier across singles + doubles
-- (so being Predator in one mode unlocks the top pet even if the
-- other mode is still Silver).
--
-- Pet      Color    Price   Min tier
-- ----     ------   -----   ----------
-- vita     green    350     Silver+   (rank ≥ 2)
-- tard     yellow   500     Gold+     (rank ≥ 3)
-- doux     blue     600     Diamond+  (rank ≥ 4)
-- mort     red      700     Predator  (rank = 5)
--
-- Tier ranks come from effective_tier_rank (0=placement, 1=bronze,
-- 2=silver, 3=gold, 4=diamond, 5=predator). Placement players (< 5
-- games) can't buy any pet — they need to finish placement first.
--
-- Each is a one-time purchase. Once owned, the player can equip any
-- pet they own to display next to their avatar on the leaderboard.
-- Buying auto-equips ONLY when nothing is currently equipped — once
-- you have an active pet, new purchases land in your collection but
-- you keep your current display until you explicitly tap Equip.
-- equip_pet accepts NULL to unequip (show no pet).
--
-- Schema choices:
--   * owned_pets text[] — array of pet keys. Permits future
--     additions without schema churn.
--   * equipped_pet text — single key, must be in owned_pets when
--     non-null. Enforced by the equip_pet RPC.
--   * Both default to empty/null so existing rows are unaffected.
--
-- Safe to rerun.

-- =========================================================================
-- 1. Columns
-- =========================================================================

alter table public.badminton_profiles
  add column if not exists owned_pets text[] not null default '{}'::text[];

alter table public.badminton_profiles
  add column if not exists equipped_pet text;

do $$ begin
  alter table public.badminton_profiles
    add constraint profiles_equipped_pet_chk
    check (equipped_pet is null or equipped_pet in ('doux', 'mort', 'tard', 'vita'));
exception when duplicate_object then null;
end $$;

-- =========================================================================
-- 2. buy_pet — deduct, add to owned, auto-equip
-- =========================================================================

create or replace function public.badminton_buy_pet(p_kind text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_cost int;
  v_required_tier int;
  v_singles_tier int;
  v_doubles_tier int;
  v_best_tier int;
  v_current_shards int;
  v_owned text[];
  v_singles_rating int;
  v_singles_games int;
  v_doubles_rating int;
  v_doubles_games int;
  v_new_balance int;
begin
  if v_caller is null then
    raise exception 'Must be signed in';
  end if;
  if v_caller = public.badminton_anonymous_user_id() then
    raise exception 'Anonymous cannot buy';
  end if;

  -- Per-pet price + minimum tier rank gate.
  if p_kind = 'vita' then
    v_cost := 350; v_required_tier := 2;  -- silver+
  elsif p_kind = 'tard' then
    v_cost := 500; v_required_tier := 3;  -- gold+
  elsif p_kind = 'doux' then
    v_cost := 600; v_required_tier := 4;  -- diamond+
  elsif p_kind = 'mort' then
    v_cost := 700; v_required_tier := 5;  -- predator
  else
    raise exception 'Unknown pet: %', p_kind;
  end if;

  select singles_rating, singles_games_played,
         doubles_rating, doubles_games_played,
         shards, owned_pets
    into v_singles_rating, v_singles_games,
         v_doubles_rating, v_doubles_games,
         v_current_shards, v_owned
    from public.badminton_profiles where id = v_caller for update;

  -- Best tier across both modes — being Predator in either mode
  -- qualifies you for the top pet.
  v_singles_tier := public.badminton_effective_tier_rank(v_singles_rating, v_singles_games);
  v_doubles_tier := public.badminton_effective_tier_rank(v_doubles_rating, v_doubles_games);
  v_best_tier := greatest(v_singles_tier, v_doubles_tier);

  if v_best_tier < v_required_tier then
    raise exception
      'This pet requires tier rank % (singles or doubles); your best is %',
      v_required_tier, v_best_tier;
  end if;

  if p_kind = any(coalesce(v_owned, '{}'::text[])) then
    raise exception 'You already own this pet';
  end if;
  if coalesce(v_current_shards, 0) < v_cost then
    raise exception 'Not enough shards (need %, have %)',
      v_cost, coalesce(v_current_shards, 0);
  end if;

  -- Auto-equip the new pet ONLY when nothing is currently equipped
  -- (preserves the player's display choice once they've made one).
  update public.badminton_profiles
     set shards = shards - v_cost,
         owned_pets = array_append(coalesce(owned_pets, '{}'::text[]), p_kind),
         equipped_pet = coalesce(equipped_pet, p_kind)
   where id = v_caller
   returning shards into v_new_balance;

  return v_new_balance;
end;
$$;

grant execute on function public.badminton_buy_pet(text) to authenticated;

-- =========================================================================
-- 3. equip_pet — swap which pet is displayed (must already own it).
--    Pass NULL to unequip.
-- =========================================================================

create or replace function public.badminton_equip_pet(p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_owned text[];
begin
  if v_caller is null then
    raise exception 'Must be signed in';
  end if;

  if p_kind is null then
    update public.badminton_profiles set equipped_pet = null where id = v_caller;
    return;
  end if;

  if p_kind not in ('doux', 'mort', 'tard', 'vita') then
    raise exception 'Unknown pet: %', p_kind;
  end if;

  select owned_pets into v_owned
    from public.badminton_profiles where id = v_caller;
  if not (p_kind = any(coalesce(v_owned, '{}'::text[]))) then
    raise exception 'You do not own this pet';
  end if;

  update public.badminton_profiles set equipped_pet = p_kind where id = v_caller;
end;
$$;

grant execute on function public.badminton_equip_pet(text) to authenticated;


-- ======================================================================
-- supabase/migrations/0014_pet_effects.sql
-- ======================================================================
-- Pet ownership effects — split into PASSIVE and ACTIVE.
--
-- PASSIVE (just owning a pet — stacks across pets):
--   Every owned pet contributes +1 shard/day. Own 2 pets → +2/day,
--   own all 4 → +4/day. Tracked via badminton_profiles.pets_last_payout_at.
--   claim_pet_daily() is called from the client on every useMyProfile
--   fetch — it floors the elapsed time since last payout into whole
--   days, credits shards = days × daily_rate, and advances the
--   timestamp by exactly that many days. Returns the number of
--   shards credited (0 if no full day has passed).
--
-- ACTIVE (only the equipped/deployed pet — does NOT stack):
--   vita  — no active effect
--   tard  — +1 ELO on every win
--   doux  — +2 ELO on every win
--   mort  — protects 20% of every ELO loss (multiplicative AFTER
--           the shield mitigation if one is armed, so Iron + Mort
--           stack: 50% off, then another 20% off the remainder)
--
-- Applied inside _settle_match_elo. Active effects do NOT consume
-- the pet — it's purely an ownership/equipped buff.
--
-- Safe to rerun.

-- =========================================================================
-- 1. pets_last_payout_at column
-- =========================================================================

alter table public.badminton_profiles
  add column if not exists pets_last_payout_at timestamptz not null default now();

-- =========================================================================
-- 2. claim_pet_daily — credit accumulated daily shards
-- =========================================================================

create or replace function public.badminton_claim_pet_daily()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_owned text[];
  v_last_payout timestamptz;
  v_now timestamptz := now();
  v_days int;
  v_rate int;
  v_amount int;
begin
  if v_caller is null then
    raise exception 'Must be signed in';
  end if;
  if v_caller = public.badminton_anonymous_user_id() then
    return 0;
  end if;

  select owned_pets, pets_last_payout_at
    into v_owned, v_last_payout
    from public.badminton_profiles where id = v_caller for update;

  -- Passive rate = 1 shard/day per owned pet (additive across pets).
  v_rate := coalesce(array_length(v_owned, 1), 0);

  if v_rate = 0 then
    return 0;
  end if;

  -- Whole days elapsed since last payout
  v_days := floor(extract(epoch from (v_now - v_last_payout)) / 86400)::int;
  if v_days <= 0 then
    return 0;
  end if;

  v_amount := v_days * v_rate;

  -- Advance the timestamp by exactly v_days × 1 day so partial days
  -- carry over into the next payout cycle.
  update public.badminton_profiles
     set shards = shards + v_amount,
         pets_last_payout_at = pets_last_payout_at + (v_days || ' days')::interval
   where id = v_caller;

  return v_amount;
end;
$$;

grant execute on function public.badminton_claim_pet_daily() to authenticated;

-- =========================================================================
-- 3. _settle_match_elo — apply deployed-pet active effects
--
-- Fourth override of this function (0010 → 0011 → 0012 → 0014).
--
-- Differences vs 0012:
--   * Read equipped_pet (NOT owned_pets) for each non-anonymous
--     participant. Only the deployed pet's active effect fires.
--   * On a WIN (raw delta > 0): equipped Tard → +1, Doux → +2.
--   * On a LOSS (raw delta < 0): equipped Mort → multiply the
--     post-shield delta by 0.8 (reduce loss by 20%). Stacks with
--     Iron/Aura shields multiplicatively.
-- =========================================================================

create or replace function public.badminton__settle_match_elo(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  k_provisional constant int := 40;
  k_established constant int := 24;
  provisional_games constant int := 5;
  elo_divisor constant numeric := 400;
  margin_deadband constant int := 2;
  margin_divisor constant numeric := 21;
  margin_max_mult constant numeric := 2;
  shards_play constant int := 5;
  shards_win constant int := 5;
  shards_underdog constant int := 5;
  underdog_gap constant int := 2;
  shuttle_bonus constant int := 5;
  tard_win_bonus constant int := 1;
  doux_win_bonus constant int := 2;
  mort_loss_factor constant numeric := 0.8;  -- keep 80% of post-shield loss
  v_anon uuid := public.badminton_anonymous_user_id();
  v_shield text;
  v_booster text;
  v_raw_delta int;
  v_equipped_pet text;
  rating_a numeric;
  rating_b numeric;
  expected_a numeric;
  expected_b numeric;
  actual_a numeric;
  actual_b numeric;
  rating_col text;
  games_col text;
  peak_col text;
  participant record;
  current_rating int;
  current_games int;
  base_k int;
  effective_k numeric;
  team_actual numeric;
  team_expected numeric;
  delta int;
  score_diff int;
  margin_mult numeric;
  winning_team badminton_match_team;
  tier_avg_a numeric;
  tier_avg_b numeric;
  is_underdog_win boolean;
  shards_for_player int;
begin
  select * into m from public.badminton_matches where id = p_match_id for update;
  if not found then
    return;
  end if;

  if m.match_type = 'singles' then
    rating_col := 'singles_rating';
    games_col := 'singles_games_played';
    peak_col := 'peak_singles_rating';
  else
    rating_col := 'doubles_rating';
    games_col := 'doubles_games_played';
    peak_col := 'peak_doubles_rating';
  end if;

  execute format(
    'select avg(p.%I)::numeric
       from public.badminton_match_participants mp
       join public.badminton_profiles p on p.id = mp.user_id
      where mp.match_id = $1 and mp.team = $2::badminton_match_team',
    rating_col
  ) using p_match_id, 'A' into rating_a;

  execute format(
    'select avg(p.%I)::numeric
       from public.badminton_match_participants mp
       join public.badminton_profiles p on p.id = mp.user_id
      where mp.match_id = $1 and mp.team = $2::badminton_match_team',
    rating_col
  ) using p_match_id, 'B' into rating_b;

  expected_a := 1 / (1 + power(10, (rating_b - rating_a) / elo_divisor));
  expected_b := 1 - expected_a;

  if m.score_a > m.score_b then
    actual_a := 1; actual_b := 0;
    winning_team := 'A';
  else
    actual_a := 0; actual_b := 1;
    winning_team := 'B';
  end if;

  score_diff := abs(m.score_a - m.score_b);
  margin_mult := least(
    margin_max_mult,
    1 + greatest(0, score_diff - margin_deadband)::numeric / margin_divisor
  );

  execute format(
    'select avg(public.badminton_effective_tier_rank(p.%I, p.%I))::numeric
       from public.badminton_match_participants mp
       join public.badminton_profiles p on p.id = mp.user_id
      where mp.match_id = $1 and mp.team = $2::badminton_match_team
        and mp.user_id <> $3',
    rating_col, games_col
  ) using p_match_id, 'A', v_anon into tier_avg_a;

  execute format(
    'select avg(public.badminton_effective_tier_rank(p.%I, p.%I))::numeric
       from public.badminton_match_participants mp
       join public.badminton_profiles p on p.id = mp.user_id
      where mp.match_id = $1 and mp.team = $2::badminton_match_team
        and mp.user_id <> $3',
    rating_col, games_col
  ) using p_match_id, 'B', v_anon into tier_avg_b;

  is_underdog_win := false;
  if tier_avg_a is not null and tier_avg_b is not null then
    if winning_team = 'A' and (tier_avg_b - tier_avg_a) >= underdog_gap then
      is_underdog_win := true;
    elsif winning_team = 'B' and (tier_avg_a - tier_avg_b) >= underdog_gap then
      is_underdog_win := true;
    end if;
  end if;

  for participant in
    select user_id, team, slot
      from public.badminton_match_participants
     where match_id = p_match_id
  loop
    execute format('select %I, %I from public.badminton_profiles where id = $1', rating_col, games_col)
      using participant.user_id into current_rating, current_games;

    if participant.user_id = v_anon then
      update public.badminton_match_participants
         set rating_before = current_rating,
             rating_after = current_rating,
             rating_delta = 0,
             shards_earned = 0
       where match_id = p_match_id
         and user_id = participant.user_id
         and slot = participant.slot;
      continue;
    end if;

    base_k := case when current_games < provisional_games then k_provisional else k_established end;

    if participant.team = winning_team then
      effective_k := base_k * margin_mult;
    else
      effective_k := base_k;
    end if;

    if participant.team = 'A' then
      team_actual := actual_a; team_expected := expected_a;
    else
      team_actual := actual_b; team_expected := expected_b;
    end if;

    v_raw_delta := round(effective_k * (team_actual - team_expected));
    delta := v_raw_delta;
    v_shield := null;
    v_booster := null;
    v_equipped_pet := null;

    -- Read the player's equipped pet up front — relevant on both
    -- win (Tard/Doux) and loss (Mort) branches.
    select equipped_pet into v_equipped_pet
      from public.badminton_profiles where id = participant.user_id;

    if v_raw_delta < 0 then
      select armed_shield into v_shield
        from public.badminton_profiles where id = participant.user_id;
      if v_shield = 'iron' then
        delta := round(v_raw_delta::numeric / 2);
      elsif v_shield = 'aura' then
        delta := 0;
      else
        v_shield := null;
      end if;
      -- Mort active effect: 20% loss protection. Stacks with the
      -- shield multiplicatively (applied AFTER the shield, on the
      -- already-reduced delta). Mort isn't consumed.
      if v_equipped_pet = 'mort' then
        delta := round(delta::numeric * mort_loss_factor);
      end if;
    end if;

    if v_raw_delta > 0 then
      select armed_booster into v_booster
        from public.badminton_profiles where id = participant.user_id;
      if v_booster = 'shuttle' then
        delta := delta + shuttle_bonus;
      else
        v_booster := null;
      end if;
      -- Tard / Doux active win bonus — only the deployed pet's
      -- effect counts. Vita has no active effect.
      if v_equipped_pet = 'tard' then
        delta := delta + tard_win_bonus;
      elsif v_equipped_pet = 'doux' then
        delta := delta + doux_win_bonus;
      end if;
    end if;

    if participant.team = winning_team then
      shards_for_player := shards_play + shards_win
                          + case when is_underdog_win then shards_underdog else 0 end;
    else
      shards_for_player := shards_play;
    end if;

    update public.badminton_match_participants
       set rating_before = current_rating,
           rating_after = current_rating + delta,
           rating_delta = delta,
           shards_earned = shards_for_player,
           shield_consumed = v_shield,
           booster_consumed = v_booster
     where match_id = p_match_id
       and user_id = participant.user_id
       and slot = participant.slot;

    execute format(
      'update public.badminton_profiles
          set %I = %I + $1,
              %I = %I + 1,
              %I = greatest(%I, %I + $1),
              shards = shards + $3,
              armed_shield = case when $4::text is not null then null else armed_shield end,
              armed_booster = case when $5::text is not null then null else armed_booster end
        where id = $2',
      rating_col, rating_col,
      games_col, games_col,
      peak_col, peak_col, rating_col
    ) using delta, participant.user_id, shards_for_player, v_shield, v_booster;
  end loop;

  update public.badminton_matches
     set status = 'confirmed', confirmed_at = now(), elo_version = 2
   where id = p_match_id;

  perform public.badminton_refresh_anonymous_rating();
end;
$$;


-- ======================================================================
-- supabase/migrations/0015_shared_project.sql
-- ======================================================================
-- 0015: shared Supabase project hardening. Safe to rerun.
--
-- This app now lives in a Supabase project that is shared with another
-- app (every object is prefixed badminton_ for that reason), which means
-- auth.users is shared too. Two consequences:
--
--   1) badminton_handle_new_user() must NOT create a badminton profile
--      for every sign-up in the shared project — otherwise the other
--      app's users would show up on our leaderboard as 1200-rated
--      players. It now only acts on sign-ups that tag themselves with
--      raw_user_meta_data.app = 'badminton' (the password sign-up form
--      sets that).
--
--   2) Users who arrive without that tag — Google OAuth sign-ins, or an
--      existing account from the other app opening this app — get their
--      profile created lazily by badminton_ensure_profile(), which the
--      client calls right after a session is established.

create or replace function public.badminton_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.raw_user_meta_data->>'app', '') <> 'badminton' then
    return new;
  end if;

  insert into public.badminton_profiles (id, display_name)
  values (
    new.id,
    left(
      coalesce(
        nullif(new.raw_user_meta_data->>'display_name', ''),
        split_part(new.email, '@', 1),
        'Player'
      ),
      15
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.badminton_ensure_profile()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_meta jsonb;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;

  if exists (select 1 from public.badminton_profiles where id = v_uid) then
    return;
  end if;

  select email, raw_user_meta_data
    into v_email, v_meta
    from auth.users
   where id = v_uid;

  insert into public.badminton_profiles (id, display_name)
  values (
    v_uid,
    left(
      coalesce(
        nullif(v_meta->>'display_name', ''),
        nullif(v_meta->>'full_name', ''),
        nullif(v_meta->>'name', ''),
        nullif(split_part(coalesce(v_email, ''), '@', 1), ''),
        'Player'
      ),
      15
    )
  )
  on conflict (id) do nothing;
end;
$$;

revoke all on function public.badminton_ensure_profile() from public;
grant execute on function public.badminton_ensure_profile() to authenticated;


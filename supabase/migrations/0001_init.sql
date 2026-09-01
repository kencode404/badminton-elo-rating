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

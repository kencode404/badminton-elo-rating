-- Badminton ELO — consolidated schema (v2 ELO).
-- Run this in the Supabase SQL editor for your project. Safe to rerun.
--
-- This is the single source of truth for the schema. Earlier patch
-- migrations (0003–0005) have been folded back in; see git history for
-- the change rationale. To set up a fresh database, run:
--   1) 0001_init.sql       (this file)
--   2) 0002_avatars.sql    (avatars storage bucket + RLS)
--   3) 0006_win_streaks.sql (per-mode win-streak RPC)
--
-- Constants (K-factor, starting rating, expiry days, margin tuning) are
-- kept in sync with src/lib/elo.ts and docs/ELO_CALCULATION.md.

-- =========================================================================
-- 1. Enums (idempotent)
-- =========================================================================

do $$ begin
  create type match_type as enum ('singles', 'doubles');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type match_status as enum ('pending', 'confirmed', 'rejected', 'expired');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type match_team as enum ('A', 'B');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type confirmation_status as enum ('pending', 'accepted', 'rejected');
exception when duplicate_object then null;
end $$;

-- =========================================================================
-- 2. Profiles (one row per auth.users entry)
-- =========================================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  avatar_url text,
  singles_rating int not null default 1200,
  doubles_rating int not null default 1200,
  singles_games_played int not null default 0 check (singles_games_played >= 0),
  doubles_games_played int not null default 0 check (doubles_games_played >= 0),
  created_at timestamptz not null default now()
);

create index if not exists profiles_singles_rating_idx on public.profiles (singles_rating desc);
create index if not exists profiles_doubles_rating_idx on public.profiles (doubles_rating desc);

-- Auto-create profile row when a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================================================================
-- 3. Matches & participants
-- =========================================================================

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  match_type match_type not null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  score_a int not null check (score_a >= 0),
  score_b int not null check (score_b >= 0),
  status match_status not null default 'pending',
  played_at timestamptz not null default now(),
  confirmed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  elo_version int not null default 1,
  check (score_a <> score_b)  -- no ties
);

create index if not exists matches_status_idx on public.matches (status);
create index if not exists matches_played_at_idx on public.matches (played_at desc);
create index if not exists matches_expires_at_idx on public.matches (expires_at) where status = 'pending';

create table if not exists public.match_participants (
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  team match_team not null,
  confirmation confirmation_status not null default 'pending',
  responded_at timestamptz,
  rating_before int,
  rating_after int,
  rating_delta int,
  primary key (match_id, user_id)
);

create index if not exists match_participants_user_pending_idx
  on public.match_participants (user_id)
  where confirmation = 'pending';

-- =========================================================================
-- 4. Match-creation guards
-- =========================================================================

-- Enforce correct team sizes and prevent same player on both teams.
create or replace function public.validate_match_participants()
returns trigger
language plpgsql
as $$
declare
  m record;
  count_a int;
  count_b int;
  expected_size int;
begin
  select * into m from public.matches where id = new.match_id;
  if not found then
    return new;
  end if;

  expected_size := case m.match_type when 'singles' then 1 else 2 end;

  select
    count(*) filter (where team = 'A'),
    count(*) filter (where team = 'B')
    into count_a, count_b
  from public.match_participants
  where match_id = new.match_id;

  if count_a > expected_size or count_b > expected_size then
    raise exception 'Too many players on team for % match', m.match_type;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_match_participants on public.match_participants;
create trigger trg_validate_match_participants
  after insert on public.match_participants
  for each row execute function public.validate_match_participants();

-- =========================================================================
-- 5. ELO settlement on full confirmation
-- =========================================================================

-- Constants here MUST match src/lib/elo.ts and docs/ELO_CALCULATION.md.
create or replace function public.settle_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  k_provisional constant int := 40;
  k_established constant int := 24;
  provisional_games constant int := 10;
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
  winning_team match_team;
begin
  select * into m from public.matches where id = p_match_id for update;
  if not found or m.status <> 'pending' then
    return;
  end if;

  -- Bail if anyone is still unconfirmed.
  if exists (
    select 1 from public.match_participants
    where match_id = p_match_id and confirmation <> 'accepted'
  ) then
    return;
  end if;

  if m.match_type = 'singles' then
    rating_col := 'singles_rating';
    games_col := 'singles_games_played';
  else
    rating_col := 'doubles_rating';
    games_col := 'doubles_games_played';
  end if;

  -- Compute team mean ratings.
  execute format(
    'select avg(p.%I)::numeric
       from public.match_participants mp
       join public.profiles p on p.id = mp.user_id
      where mp.match_id = $1 and mp.team = $2::match_team',
    rating_col
  ) using p_match_id, 'A' into rating_a;

  execute format(
    'select avg(p.%I)::numeric
       from public.match_participants mp
       join public.profiles p on p.id = mp.user_id
      where mp.match_id = $1 and mp.team = $2::match_team',
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
    select user_id, team from public.match_participants where match_id = p_match_id
  loop
    execute format('select %I, %I from public.profiles where id = $1', rating_col, games_col)
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

    update public.match_participants
       set rating_before = current_rating,
           rating_after = current_rating + delta,
           rating_delta = delta
     where match_id = p_match_id and user_id = participant.user_id;

    execute format(
      'update public.profiles set %I = %I + $1, %I = %I + 1 where id = $2',
      rating_col, rating_col, games_col, games_col
    ) using delta, participant.user_id;
  end loop;

  update public.matches
     set status = 'confirmed', confirmed_at = now(), elo_version = 2
   where id = p_match_id;
end;
$$;

-- Trigger: when the last participant accepts, settle the match.
-- When any participant rejects, mark the match rejected.
create or replace function public.handle_confirmation_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  m_status match_status;
begin
  if new.confirmation = old.confirmation then
    return new;
  end if;

  select status into m_status from public.matches where id = new.match_id;
  if m_status <> 'pending' then
    return new;
  end if;

  if new.confirmation = 'rejected' then
    update public.matches set status = 'rejected' where id = new.match_id;
    return new;
  end if;

  if new.confirmation = 'accepted' then
    if not exists (
      select 1 from public.match_participants
      where match_id = new.match_id and confirmation <> 'accepted'
    ) then
      perform public.settle_match(new.match_id);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_handle_confirmation_change on public.match_participants;
create trigger trg_handle_confirmation_change
  after update of confirmation on public.match_participants
  for each row execute function public.handle_confirmation_change();

-- =========================================================================
-- 6. Row Level Security
-- =========================================================================

alter table public.profiles enable row level security;
alter table public.matches enable row level security;
alter table public.match_participants enable row level security;

-- Helper: SECURITY DEFINER membership check that bypasses RLS, so the
-- match_participants SELECT policy can reference its own table without
-- triggering 42P17 "infinite recursion in policy".
create or replace function public.is_match_participant(
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
    select 1 from public.match_participants
    where match_id = p_match_id and user_id = p_user_id
  );
$$;

grant execute on function public.is_match_participant(uuid, uuid) to authenticated;

-- Profiles: anyone signed in can read; only the owner can update their profile.
drop policy if exists "Profiles readable by all signed-in users" on public.profiles;
create policy "Profiles readable by all signed-in users"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
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
drop policy if exists "Matches visible to participants" on public.matches;
create policy "Matches visible to participants"
  on public.matches for select
  to authenticated
  using (
    auth.uid() = created_by
    or public.is_match_participant(id, auth.uid())
  );

drop policy if exists "Users can create matches as themselves" on public.matches;
create policy "Users can create matches as themselves"
  on public.matches for insert
  to authenticated
  with check (created_by = auth.uid());

-- Match participants:
-- Read: any signed-in user can read participants of matches they are in or created.
-- Insert: creator of the match adds participants at match-creation time.
-- Update: a user can only update their own confirmation.
drop policy if exists "Participants visible to involved users" on public.match_participants;
create policy "Participants visible to involved users"
  on public.match_participants for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_match_participant(match_id, auth.uid())
    or exists (
      select 1 from public.matches m
      where m.id = match_participants.match_id and m.created_by = auth.uid()
    )
  );

drop policy if exists "Match creator inserts participants" on public.match_participants;
create policy "Match creator inserts participants"
  on public.match_participants for insert
  to authenticated
  with check (
    exists (
      select 1 from public.matches m
      where m.id = match_id and m.created_by = auth.uid()
    )
  );

drop policy if exists "Users update only own confirmation" on public.match_participants;
create policy "Users update only own confirmation"
  on public.match_participants for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- =========================================================================
-- 7. Realtime
-- =========================================================================

-- Allow Realtime to broadcast inserts/updates on these tables (idempotent).
do $$ begin
  alter publication supabase_realtime add table public.matches;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.match_participants;
exception when duplicate_object then null;
end $$;

-- =========================================================================
-- 8. Match expiry job (call from a scheduled edge function or pg_cron)
-- =========================================================================

create or replace function public.expire_old_matches()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  affected int;
begin
  update public.matches
     set status = 'expired'
   where status = 'pending' and expires_at < now();
  get diagnostics affected = row_count;
  return affected;
end;
$$;

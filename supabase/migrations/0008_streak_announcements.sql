-- Streak announcements feed for the Home page.
--
-- Whenever a match is confirmed (status changes to 'confirmed' via the
-- existing settle_match path), each winning player who currently has a
-- 2+ win streak in that mode gets a fresh row in `streak_announcements`.
-- Losing players' previous announcement for that mode is removed (their
-- streak just broke).
--
-- Each row has an `expires_at` 30 days out. Cleanup is lazy: every time
-- the trigger fires, expired rows get deleted alongside. No pg_cron needed.
-- Safe to rerun.

-- =========================================================================
-- 1. Table
-- =========================================================================

create table if not exists public.streak_announcements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  match_type match_type not null,
  streak_count int not null check (streak_count >= 2),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  -- only one active announcement per (user, mode); replaced when streak grows
  unique (user_id, match_type)
);

create index if not exists streak_announcements_created_idx
  on public.streak_announcements (created_at desc);

-- =========================================================================
-- 2. RLS
-- =========================================================================

alter table public.streak_announcements enable row level security;

drop policy if exists "Streak announcements readable by all" on public.streak_announcements;
create policy "Streak announcements readable by all"
  on public.streak_announcements for select
  to authenticated
  using (true);

-- (No insert / update / delete user policy: rows are managed only by the
-- SECURITY DEFINER trigger below.)

-- =========================================================================
-- 3. Helpers — current single-mode streak for a user
-- =========================================================================

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
      m.played_at,
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
        order by played_at desc
        rows between unbounded preceding and current row
      ) as losses_so_far
    from ordered
  )
  select coalesce(count(*) filter (where is_win = 1 and losses_so_far = 0), 0)::int
  from with_loss;
$$;

-- =========================================================================
-- 4. Trigger — refresh announcements whenever a match becomes confirmed
-- =========================================================================

create or replace function public.refresh_streak_announcements()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  participant record;
  v_streak int;
  participant_won boolean;
begin
  -- Loop through everyone in the freshly confirmed match.
  for participant in
    select user_id, team from public.match_participants where match_id = new.id
  loop
    -- Wipe any previous announcement for this user+mode — we'll either
    -- leave them streak-less (loser) or insert a fresh one (winner).
    delete from public.streak_announcements
    where user_id = participant.user_id
      and match_type = new.match_type;

    participant_won :=
      (participant.team = 'A' and new.score_a > new.score_b)
      or (participant.team = 'B' and new.score_b > new.score_a);

    if participant_won then
      v_streak := public.current_streak_for_user_mode(participant.user_id, new.match_type);
      if v_streak >= 2 then
        insert into public.streak_announcements (user_id, match_type, streak_count)
        values (participant.user_id, new.match_type, v_streak);
      end if;
    end if;
  end loop;

  -- Lazy cleanup of expired rows on every confirmation.
  delete from public.streak_announcements where expires_at < now();

  return new;
end;
$$;

drop trigger if exists trg_refresh_streak_announcements on public.matches;
create trigger trg_refresh_streak_announcements
  after update of status on public.matches
  for each row
  when (new.status = 'confirmed' and old.status is distinct from new.status)
  execute function public.refresh_streak_announcements();

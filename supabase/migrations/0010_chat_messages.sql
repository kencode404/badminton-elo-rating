-- Replace streak_announcements with a unified chat_messages table.
--
-- This is the source of truth for both system streak announcements
-- (kind='system_streak') and future user chat (kind='user'), so the
-- Home club-chat panel renders one chronological stream and the
-- unread badge can count both kinds with a single query.
--
-- The migration drops the old streak_announcements table and
-- back-fills active streak rows from get_win_streaks() at the end so
-- the Home page stays populated. Safe to rerun.

-- =========================================================================
-- 1. Tear down old streak_announcements artefacts
-- =========================================================================

drop trigger if exists trg_refresh_streak_announcements on public.matches;
drop function if exists public.refresh_streak_announcements();
drop table if exists public.streak_announcements;

-- =========================================================================
-- 2. Enum
-- =========================================================================

do $$ begin
  create type chat_message_kind as enum ('system_streak', 'user');
exception when duplicate_object then null;
end $$;

-- =========================================================================
-- 3. Table
-- =========================================================================

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  kind chat_message_kind not null,
  user_id uuid references public.profiles(id) on delete cascade,
  body text,
  match_type match_type,
  streak_count int,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  -- Per-kind shape requirements
  check (
    (kind = 'system_streak'
      and user_id is not null
      and match_type is not null
      and streak_count is not null
      and streak_count >= 2)
    or (kind = 'user'
      and user_id is not null
      and body is not null
      and length(trim(body)) > 0)
  )
);

create index if not exists chat_messages_created_idx
  on public.chat_messages (created_at desc);

-- At most one active system_streak per (user, mode); user messages
-- aren't constrained.
create unique index if not exists chat_messages_active_streak_unique
  on public.chat_messages (user_id, match_type)
  where kind = 'system_streak';

-- =========================================================================
-- 4. RLS
-- =========================================================================

alter table public.chat_messages enable row level security;

drop policy if exists "Chat messages readable by all" on public.chat_messages;
create policy "Chat messages readable by all"
  on public.chat_messages for select
  to authenticated
  using (true);

-- User chat messages: a signed-in user can post their own. System rows
-- are inserted by the trigger only (which runs SECURITY DEFINER).
drop policy if exists "Users can post user chat messages" on public.chat_messages;
create policy "Users can post user chat messages"
  on public.chat_messages for insert
  to authenticated
  with check (kind = 'user' and user_id = auth.uid());

-- Users may delete their own user chat messages.
drop policy if exists "Users can delete own chat messages" on public.chat_messages;
create policy "Users can delete own chat messages"
  on public.chat_messages for delete
  to authenticated
  using (kind = 'user' and user_id = auth.uid());

-- =========================================================================
-- 5. Trigger — keep streak chat rows in sync with confirmed matches
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
begin
  for participant in
    select user_id, team from public.match_participants where match_id = new.id
  loop
    -- Wipe any previous active streak announcement for this user+mode.
    delete from public.chat_messages
    where kind = 'system_streak'
      and user_id = participant.user_id
      and match_type = new.match_type;

    participant_won :=
      (participant.team = 'A' and new.score_a > new.score_b)
      or (participant.team = 'B' and new.score_b > new.score_a);

    if participant_won then
      v_streak := public.current_streak_for_user_mode(participant.user_id, new.match_type);
      if v_streak >= 2 then
        insert into public.chat_messages
          (kind, user_id, match_type, streak_count, expires_at)
        values
          ('system_streak', participant.user_id, new.match_type, v_streak,
           now() + interval '30 days');
      end if;
    end if;
  end loop;

  -- Lazy cleanup of expired streak rows. User chat messages with
  -- expires_at = null are kept indefinitely.
  delete from public.chat_messages
  where kind = 'system_streak'
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
-- 6. Backfill — populate from current win streaks so Home isn't empty
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

-- Club Chat schema: chat_messages (system streak announcements + user
-- chat) + chat_reactions (one per user per message). Also adds the
-- chat_last_seen_at column on profiles that drives the home-tab
-- unread badge.
--
-- Folds together 0009_chat_last_seen.sql, 0010_chat_messages.sql,
-- 0011_streak_history.sql, 0012_chat_reactions.sql, and
-- 0013_chat_reactions_one_per_user.sql. Safe to rerun.

-- =========================================================================
-- 1. profiles.chat_last_seen_at
-- =========================================================================

alter table public.profiles
  add column if not exists chat_last_seen_at timestamptz not null
    default '1970-01-01 00:00:00+00';

-- =========================================================================
-- 2. Enum
-- =========================================================================

do $$ begin
  create type chat_message_kind as enum ('system_streak', 'user');
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
  created_at timestamptz not null default now(),
  expires_at timestamptz,
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
-- 4. Streak announcement trigger (append-only)
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

  -- Lazy cleanup of expired streak rows. User chat (expires_at = null)
  -- is kept indefinitely.
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
-- 5. chat_reactions (one per user per message)
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
-- 6. Backfill — populate from current win streaks so a fresh install
--                with existing matches doesn't have an empty chat
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

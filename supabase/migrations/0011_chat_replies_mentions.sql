-- Chat replies + @mentions + notification-bell tracking.
--
-- Adds:
--   * chat_messages.reply_to_message_id (FK to self, on delete set null)
--   * chat_messages.mentioned_user_ids uuid[]
--   * profiles.notifications_last_seen_at — cutoff for the bell badge
--   * indexes to keep notification-bell queries cheap
--
-- The chat_messages check constraint stays unchanged — both new
-- columns are nullable, only meaningful on kind='user'.
--
-- Safe to rerun.

alter table public.chat_messages
  add column if not exists reply_to_message_id uuid
    references public.chat_messages(id) on delete set null,
  add column if not exists mentioned_user_ids uuid[];

create index if not exists chat_messages_reply_to_idx
  on public.chat_messages (reply_to_message_id)
  where reply_to_message_id is not null;

-- GIN index — used by the bell badge to find messages where the
-- current user is in mentioned_user_ids. Tiny, only indexes rows
-- where mentions is non-null.
create index if not exists chat_messages_mentions_idx
  on public.chat_messages using gin (mentioned_user_ids);

alter table public.profiles
  add column if not exists notifications_last_seen_at timestamptz
    not null default '1970-01-01 00:00:00+00';

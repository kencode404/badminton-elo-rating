-- Track each user's last-seen timestamp for the Club Chat panel.
-- The home-button unread badge shows the count of streak_announcements
-- created after this timestamp. Updated whenever the user opens Home.
-- Safe to rerun.

alter table public.profiles
  add column if not exists chat_last_seen_at timestamptz not null
    default '1970-01-01 00:00:00+00';

-- The existing 'Users can update own profile' RLS policy already covers
-- this column since it allows owners to UPDATE their own row.

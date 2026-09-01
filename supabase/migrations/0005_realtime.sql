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

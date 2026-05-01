-- Add chat tables to the supabase_realtime publication so the Club
-- Chat panel receives live INSERT / UPDATE / DELETE events for new
-- messages and reactions. Without this the client only sees changes
-- after a manual page refresh. Safe to rerun.

do $$ begin
  alter publication supabase_realtime add table public.chat_messages;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.chat_reactions;
exception when duplicate_object then null;
end $$;

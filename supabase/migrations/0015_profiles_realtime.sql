-- Add profiles to the supabase_realtime publication so that updates
-- like chat_last_seen_at or display_name changes propagate live to
-- the client. Without this, the home-button unread badge only
-- recomputes on a manual refresh after the user opens Home. Safe to
-- rerun.

do $$ begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then null;
end $$;

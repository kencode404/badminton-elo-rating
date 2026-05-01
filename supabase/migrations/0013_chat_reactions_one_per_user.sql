-- Limit chat_reactions to one row per (message, user). Tapping a
-- different emoji replaces the user's previous reaction; tapping the
-- same emoji removes it. Safe to rerun.
--
-- This drops and recreates chat_reactions because the primary key
-- changes from (message_id, user_id, emoji) to (message_id, user_id).
-- Existing reactions (likely none yet) are wiped.

drop table if exists public.chat_reactions cascade;

create table public.chat_reactions (
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

-- New: needed so a user can swap their existing reaction via upsert.
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

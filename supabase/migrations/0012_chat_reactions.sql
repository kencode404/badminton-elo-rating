-- Per-message emoji reactions for the Club Chat panel.
-- Each row is one user's reaction with one emoji on one message;
-- a user can react with multiple emojis on the same message, and
-- toggling adds/removes the row. Safe to rerun.

create table if not exists public.chat_reactions (
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
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

drop policy if exists "Users delete own reactions" on public.chat_reactions;
create policy "Users delete own reactions"
  on public.chat_reactions for delete
  to authenticated
  using (user_id = auth.uid());

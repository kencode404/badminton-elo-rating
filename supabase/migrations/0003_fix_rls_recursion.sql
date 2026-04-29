-- Fix infinite recursion in match_participants RLS policies.
--
-- The original "Participants visible to involved users" policy contained
-- an `exists (select ... from match_participants mp2 ...)` clause to allow
-- a player to see their match-mates. That subquery triggered the same
-- policy again, causing 42P17 "infinite recursion in policy".
--
-- Fix: use a SECURITY DEFINER helper that bypasses RLS for the membership
-- check, so the policy can call it without re-entering itself.
--
-- Safe to rerun.

create or replace function public.is_match_participant(
  p_match_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.match_participants
    where match_id = p_match_id and user_id = p_user_id
  );
$$;

-- Allow signed-in users to call it.
grant execute on function public.is_match_participant(uuid, uuid) to authenticated;

drop policy if exists "Participants visible to involved users" on public.match_participants;
create policy "Participants visible to involved users"
  on public.match_participants for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_match_participant(match_id, auth.uid())
    or exists (
      select 1 from public.matches m
      where m.id = match_participants.match_id and m.created_by = auth.uid()
    )
  );

drop policy if exists "Matches visible to participants" on public.matches;
create policy "Matches visible to participants"
  on public.matches for select
  to authenticated
  using (
    auth.uid() = created_by
    or public.is_match_participant(id, auth.uid())
  );

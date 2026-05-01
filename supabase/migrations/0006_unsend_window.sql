-- Limit chat message deletion to a 10-minute window after sending.
-- The client UI hides the unsend button after the window closes, but
-- the server enforces the rule too so a clever user can't bypass via
-- direct API calls. Safe to rerun.
--
-- Tightens the existing 'Users can delete own chat messages' policy.

drop policy if exists "Users can delete own chat messages" on public.chat_messages;
create policy "Users can delete own chat messages"
  on public.chat_messages for delete
  to authenticated
  using (
    kind = 'user'
    and user_id = auth.uid()
    and created_at > now() - interval '10 minutes'
  );

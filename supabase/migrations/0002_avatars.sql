-- Avatars storage bucket + policies. Safe to rerun.
--
-- Convention: each user uploads to a folder named by their auth uid, so the
-- file path is `{user_id}/avatar.jpg`. RLS uses the first folder segment to
-- enforce that users can only modify their own avatar.

-- Public bucket (anyone can read, only owners can write).
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = excluded.public;

-- Public read.
drop policy if exists "Avatar public read" on storage.objects;
create policy "Avatar public read"
  on storage.objects for select
  to public
  using (bucket_id = 'avatars');

-- Owner can insert into their own folder.
drop policy if exists "Avatar upload by owner" on storage.objects;
create policy "Avatar upload by owner"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Owner can overwrite their own avatar.
drop policy if exists "Avatar update by owner" on storage.objects;
create policy "Avatar update by owner"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Owner can delete their own avatar.
drop policy if exists "Avatar delete by owner" on storage.objects;
create policy "Avatar delete by owner"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

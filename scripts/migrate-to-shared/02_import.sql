-- Import the rows exported by 01_export.sql into the NEW (shared) project.
-- Run against the NEW project with psql from this directory, AFTER the
-- schema (supabase/migrations/0001..0015) has been applied there:
--
--   psql "<NEW_PROJECT_CONNECTION_URI>" -f 02_import.sql
--
-- Everything runs in ONE transaction: any error rolls the whole import
-- back, so it is safe to fix the cause and re-run.
--
-- Shared auth.users handling
-- --------------------------
-- If an email already exists in the new project (the person already has
-- an account through the other app), we do NOT create a second user. The
-- badminton rows are instead re-pointed at the existing user's id via the
-- `idmap` table, and that person keeps signing in with their existing
-- (other-app) password. Everyone else is copied over with their id and
-- bcrypt password hash intact, so they sign in exactly as before.
--
-- Merged accounts are printed at the end — read that list.

\set ON_ERROR_STOP on
\set old_avatar_base 'https://sagogwylktikoqhvgmps.supabase.co/storage/v1/object/public/avatars/'
\set new_avatar_base 'https://mfjuuigfghzpqvjwobwg.supabase.co/storage/v1/object/public/badminton_avatars/'

begin;

-- ---------------------------------------------------------------------
-- 1. Staging tables shaped like the destination tables. LIKE copies the
--    column names/types (generated columns become plain columns, which is
--    what we want — we never insert them into the real tables).
-- ---------------------------------------------------------------------
create temp table stg_auth_users        (like auth.users);
create temp table stg_auth_identities   (like auth.identities);
create temp table stg_profiles          (like public.badminton_profiles);
create temp table stg_seasons           (like public.badminton_seasons);
create temp table stg_matches           (like public.badminton_matches);
create temp table stg_match_participants(like public.badminton_match_participants);
create temp table stg_chat_messages     (like public.badminton_chat_messages);
create temp table stg_chat_reactions    (like public.badminton_chat_reactions);
create temp table stg_season_snapshots  (like public.badminton_season_snapshots);

\i data/10_auth_users.sql
\i data/11_auth_identities.sql
\i data/20_profiles.sql
\i data/21_seasons.sql
\i data/22_matches.sql
\i data/23_match_participants.sql
\i data/24_chat_messages.sql
\i data/25_chat_reactions.sql
\i data/26_season_snapshots.sql

-- ---------------------------------------------------------------------
-- 2. Build the id map. old_id -> new_id; merged = email already existed.
-- ---------------------------------------------------------------------
create temp table idmap as
select s.id                 as old_id,
       coalesce(e.id, s.id) as new_id,
       (e.id is not null)   as merged,
       s.email
  from stg_auth_users s
  left join auth.users e
         on lower(e.email) = lower(s.email)
        and e.id <> s.id
        and e.deleted_at is null;

-- The anonymous system user maps to itself (0010 created it here already).
insert into idmap (old_id, new_id, merged, email)
values ('00000000-0000-0000-0000-000000000001'::uuid,
        '00000000-0000-0000-0000-000000000001'::uuid,
        false, 'anonymous@badminton.local')
on conflict do nothing;

create or replace function pg_temp.map_id(p uuid) returns uuid
language sql stable as $$
  select coalesce((select new_id from idmap where old_id = p), p)
$$;

create or replace function pg_temp.map_ids(p uuid[]) returns uuid[]
language sql stable as $$
  select case when p is null then null
              else (select array_agg(pg_temp.map_id(x) order by ord)
                      from unnest(p) with ordinality as t(x, ord)) end
$$;

-- ---------------------------------------------------------------------
-- 3. auth.users + auth.identities (non-merged users only).
--    Token columns are NOT NULL DEFAULT '' in GoTrue and NULLs there make
--    GoTrue fail at sign-in, hence the coalesces.
-- ---------------------------------------------------------------------
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, invited_at,
  confirmation_token, confirmation_sent_at,
  recovery_token, recovery_sent_at,
  email_change_token_new, email_change, email_change_sent_at,
  last_sign_in_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, created_at, updated_at,
  phone, phone_confirmed_at, phone_change, phone_change_token, phone_change_sent_at,
  email_change_token_current, email_change_confirm_status,
  banned_until, reauthentication_token, reauthentication_sent_at,
  is_sso_user, deleted_at, is_anonymous
)
select
  s.id, coalesce(s.instance_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(s.aud, 'authenticated'), coalesce(s.role, 'authenticated'), s.email, s.encrypted_password,
  s.email_confirmed_at, s.invited_at,
  coalesce(s.confirmation_token, ''), s.confirmation_sent_at,
  coalesce(s.recovery_token, ''), s.recovery_sent_at,
  coalesce(s.email_change_token_new, ''), coalesce(s.email_change, ''), s.email_change_sent_at,
  s.last_sign_in_at,
  coalesce(s.raw_app_meta_data, '{"provider":"email","providers":["email"]}'::jsonb),
  coalesce(s.raw_user_meta_data, '{}'::jsonb) || '{"app":"badminton"}'::jsonb,
  coalesce(s.is_super_admin, false), coalesce(s.created_at, now()), coalesce(s.updated_at, now()),
  s.phone, s.phone_confirmed_at, coalesce(s.phone_change, ''), coalesce(s.phone_change_token, ''), s.phone_change_sent_at,
  coalesce(s.email_change_token_current, ''), coalesce(s.email_change_confirm_status, 0),
  s.banned_until, coalesce(s.reauthentication_token, ''), s.reauthentication_sent_at,
  coalesce(s.is_sso_user, false), s.deleted_at, coalesce(s.is_anonymous, false)
from stg_auth_users s
join idmap m on m.old_id = s.id
where not m.merged
  and not exists (select 1 from auth.users e where e.id = s.id);

insert into auth.identities (
  id, provider_id, user_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
select
  coalesce(s.id, gen_random_uuid()), s.provider_id, m.new_id, s.identity_data, s.provider,
  s.last_sign_in_at, coalesce(s.created_at, now()), coalesce(s.updated_at, now())
from stg_auth_identities s
join idmap m on m.old_id = s.user_id
where not m.merged
  -- a merged user already has identities in this project; don't add stale ones
  and not exists (
    select 1 from auth.identities i
     where i.user_id = m.new_id and i.provider = s.provider
  )
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 4. Re-point every user reference in the staging rows through idmap,
--    and rewrite avatar URLs to the new project/bucket.
-- ---------------------------------------------------------------------
update stg_profiles set id = pg_temp.map_id(id), banned_by = pg_temp.map_id(banned_by);
update stg_profiles
   set avatar_url = replace(avatar_url, :'old_avatar_base', :'new_avatar_base')
 where avatar_url like :'old_avatar_base' || '%';
update stg_matches            set created_by = pg_temp.map_id(created_by);
update stg_match_participants set user_id    = pg_temp.map_id(user_id);
update stg_chat_messages      set user_id    = pg_temp.map_id(user_id),
                                  breaker_user_ids   = pg_temp.map_ids(breaker_user_ids),
                                  mentioned_user_ids = pg_temp.map_ids(mentioned_user_ids);
update stg_chat_reactions     set user_id    = pg_temp.map_id(user_id);
update stg_season_snapshots   set user_id    = pg_temp.map_id(user_id);

-- ---------------------------------------------------------------------
-- 5. Load the badminton tables. User triggers (validation, ELO
--    settlement, auto-accept, chat streak messages) are switched off so
--    historical rows land exactly as they were.
-- ---------------------------------------------------------------------
alter table public.badminton_profiles           disable trigger user;
alter table public.badminton_seasons            disable trigger user;
alter table public.badminton_matches            disable trigger user;
alter table public.badminton_match_participants disable trigger user;
alter table public.badminton_chat_messages      disable trigger user;
alter table public.badminton_chat_reactions     disable trigger user;
alter table public.badminton_season_snapshots   disable trigger user;

-- profiles: upsert (covers the anonymous row created by 0010 and any
-- merged user who already opened the badminton app on the new project).
do $$
declare
  v_set text;
begin
  select string_agg(format('%I = excluded.%I', column_name, column_name), ', ')
    into v_set
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'badminton_profiles'
     and column_name <> 'id';
  execute format(
    'insert into public.badminton_profiles select * from stg_profiles on conflict (id) do update set %s',
    v_set);
end $$;

insert into public.badminton_seasons            select * from stg_seasons            on conflict (number) do update set started_at = excluded.started_at;
insert into public.badminton_matches            select * from stg_matches            on conflict (id) do nothing;
insert into public.badminton_match_participants select * from stg_match_participants on conflict do nothing;
insert into public.badminton_chat_messages      select * from stg_chat_messages      on conflict (id) do nothing;
insert into public.badminton_chat_reactions     select * from stg_chat_reactions     on conflict do nothing;
insert into public.badminton_season_snapshots   select * from stg_season_snapshots   on conflict do nothing;

alter table public.badminton_profiles           enable trigger user;
alter table public.badminton_seasons            enable trigger user;
alter table public.badminton_matches            enable trigger user;
alter table public.badminton_match_participants enable trigger user;
alter table public.badminton_chat_messages      enable trigger user;
alter table public.badminton_chat_reactions     enable trigger user;
alter table public.badminton_season_snapshots   enable trigger user;

-- ---------------------------------------------------------------------
-- 6. Report
-- ---------------------------------------------------------------------
\echo
\echo 'Accounts MERGED into an existing user of the shared project (they keep their existing password):'
select email, old_id, new_id from idmap where merged order by email;

\echo
\echo 'Row counts in the new project after import:'
select 'badminton_profiles'           as tbl, count(*) from public.badminton_profiles
union all select 'badminton_seasons',            count(*) from public.badminton_seasons
union all select 'badminton_matches',            count(*) from public.badminton_matches
union all select 'badminton_match_participants', count(*) from public.badminton_match_participants
union all select 'badminton_chat_messages',      count(*) from public.badminton_chat_messages
union all select 'badminton_chat_reactions',     count(*) from public.badminton_chat_reactions
union all select 'badminton_season_snapshots',   count(*) from public.badminton_season_snapshots
union all select 'auth.users (total, shared)',   count(*) from auth.users;

\echo
\echo 'Staged vs imported (should match unless rows were merged/skipped):'
select 'profiles' as tbl, (select count(*) from stg_profiles) staged, (select count(*) from public.badminton_profiles) now_in_db
union all select 'matches',            (select count(*) from stg_matches),            (select count(*) from public.badminton_matches)
union all select 'match_participants', (select count(*) from stg_match_participants), (select count(*) from public.badminton_match_participants)
union all select 'chat_messages',      (select count(*) from stg_chat_messages),      (select count(*) from public.badminton_chat_messages)
union all select 'chat_reactions',     (select count(*) from stg_chat_reactions),     (select count(*) from public.badminton_chat_reactions)
union all select 'season_snapshots',   (select count(*) from stg_season_snapshots),   (select count(*) from public.badminton_season_snapshots);

commit;

\echo
\echo 'Import committed. Next: node 03_copy_avatars.mjs (see README.md).'

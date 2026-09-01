-- Export every badminton row from the OLD project as name-keyed JSON
-- inserts into staging tables. Run against the OLD project with psql
-- from this directory (see README.md):
--
--   mkdir data
--   psql "<OLD_PROJECT_CONNECTION_URI>" -f 01_export.sql
--
-- Each output line is:
--   insert into stg_<table> select * from json_populate_record(null::stg_<table>, '{...}');
-- json_populate_record matches columns BY NAME, so it does not matter if
-- the old project's physical column order differs from a fresh run of the
-- migrations (it does — the migrations were folded over time).
--
-- The anonymous system user (badminton_anonymous_user_id()) is recreated
-- by 0010 on the new project, so it is excluded from auth.users and
-- auth.identities. Its PROFILE row is exported (it carries rating state)
-- and upserted on import.

\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
\pset pager off

\o data/10_auth_users.sql
select 'insert into stg_auth_users select * from json_populate_record(null::stg_auth_users, '
       || quote_literal(row_to_json(u)::text) || ');'
  from auth.users u
 where u.id <> '00000000-0000-0000-0000-000000000001'::uuid
   and u.deleted_at is null
 order by u.created_at;

\o data/11_auth_identities.sql
select 'insert into stg_auth_identities select * from json_populate_record(null::stg_auth_identities, '
       || quote_literal(row_to_json(i)::text) || ');'
  from auth.identities i
 where i.user_id <> '00000000-0000-0000-0000-000000000001'::uuid
 order by i.created_at;

\o data/20_profiles.sql
select 'insert into stg_profiles select * from json_populate_record(null::stg_profiles, '
       || quote_literal(row_to_json(p)::text) || ');'
  from public.profiles p
 order by p.created_at;

\o data/21_seasons.sql
select 'insert into stg_seasons select * from json_populate_record(null::stg_seasons, '
       || quote_literal(row_to_json(s)::text) || ');'
  from public.seasons s
 order by s.number;

\o data/22_matches.sql
select 'insert into stg_matches select * from json_populate_record(null::stg_matches, '
       || quote_literal(row_to_json(m)::text) || ');'
  from public.matches m
 order by m.created_at;

\o data/23_match_participants.sql
select 'insert into stg_match_participants select * from json_populate_record(null::stg_match_participants, '
       || quote_literal(row_to_json(mp)::text) || ');'
  from public.match_participants mp;

\o data/24_chat_messages.sql
select 'insert into stg_chat_messages select * from json_populate_record(null::stg_chat_messages, '
       || quote_literal(row_to_json(c)::text) || ');'
  from public.chat_messages c
 order by c.created_at;

\o data/25_chat_reactions.sql
select 'insert into stg_chat_reactions select * from json_populate_record(null::stg_chat_reactions, '
       || quote_literal(row_to_json(r)::text) || ');'
  from public.chat_reactions r;

\o data/26_season_snapshots.sql
select 'insert into stg_season_snapshots select * from json_populate_record(null::stg_season_snapshots, '
       || quote_literal(row_to_json(ss)::text) || ');'
  from public.season_snapshots ss;

\o
\pset tuples_only off
\pset format aligned

\echo
\echo 'Exported row counts (old project):'
select 'auth.users'         as tbl, count(*) from auth.users where deleted_at is null and id <> '00000000-0000-0000-0000-000000000001'::uuid
union all select 'auth.identities',    count(*) from auth.identities where user_id <> '00000000-0000-0000-0000-000000000001'::uuid
union all select 'profiles',           count(*) from public.profiles
union all select 'seasons',            count(*) from public.seasons
union all select 'matches',            count(*) from public.matches
union all select 'match_participants', count(*) from public.match_participants
union all select 'chat_messages',      count(*) from public.chat_messages
union all select 'chat_reactions',     count(*) from public.chat_reactions
union all select 'season_snapshots',   count(*) from public.season_snapshots;

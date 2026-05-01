-- Add two new chat_message_kind enum values: 'system_tier_up' and
-- 'system_streak_ended'.
--
-- Postgres rule: a newly-added enum value cannot be referenced in
-- the same transaction. Supabase wraps each migration file in one
-- transaction, so the value-add and the rest of the schema work
-- (columns, check constraint, helper functions, trigger) must live
-- in separate migrations. Migration 0011 picks up from here.
--
-- Safe to rerun.

alter type chat_message_kind add value if not exists 'system_tier_up';
alter type chat_message_kind add value if not exists 'system_streak_ended';

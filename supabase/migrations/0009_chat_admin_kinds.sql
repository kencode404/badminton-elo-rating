-- Add two new chat_message_kind enum values for moderation logs:
--   * system_season_reset — emitted by reset_season() at end-of-run
--   * system_user_banned  — emitted by ban_user()
--
-- Postgres rule: a freshly-added enum value cannot be used in the
-- same transaction. Migration 0010 picks up the schema/trigger work
-- that references these kinds.
--
-- Safe to rerun.

alter type chat_message_kind add value if not exists 'system_season_reset';
alter type chat_message_kind add value if not exists 'system_user_banned';

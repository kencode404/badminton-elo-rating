// Shared "Anonymous" player constants. The UUID is hard-coded to match
// the value provisioned by supabase/migrations/0010_anonymous_player.sql
// (anonymous_user_id()). The anonymous profile may be picked multiple
// times in the same match (e.g. two anonymous opponents in doubles).
//
// Matches that include anonymous don't auto-settle — they enter
// status='awaiting_admin' and an admin must approve via /admin.

export const ANONYMOUS_ID = '00000000-0000-0000-0000-000000000001';

export function isAnonymous(id: string | null | undefined): boolean {
  return id === ANONYMOUS_ID;
}

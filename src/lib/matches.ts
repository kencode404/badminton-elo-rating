import { supabase } from './supabase';
import {
  cacheRoster,
  deleteQueuedMatch,
  deleteQueuedMatchEdit,
  getCachedRoster,
  getQueuedMatches,
  getQueuedMatchEdits,
  isOffline,
  looksLikeNetworkError,
  queueMatch,
  queueMatchEdit,
  type QueuedMatchEdit,
  type QueuedMatchInput,
} from './offline';
import { ANONYMOUS_ID } from './anonymous';
import type { Confirmation, Database, MatchType, Team } from './database.types';

type Profile = Database['public']['Tables']['badminton_profiles']['Row'];
type Match = Database['public']['Tables']['badminton_matches']['Row'];

export interface ParticipantSummary {
  user_id: string;
  team: Team;
  confirmation: Confirmation;
  profile: Pick<Profile, 'id' | 'display_name' | 'avatar_url'>;
}

export interface PendingMatchSummary {
  match: Match;
  myTeam: Team;
  participants: ParticipantSummary[];
}

export async function searchPlayers(
  query: string,
  excludeIds: string[] = [],
  limit = 100,
): Promise<Pick<Profile, 'id' | 'display_name' | 'avatar_url'>[]> {
  const trimmed = query.trim();

  async function fromNetwork() {
    // Anonymous is excluded from regular search; PlayerPicker pins it
    // separately so it can be picked multiple times.
    let q = supabase
      .from('badminton_profiles')
      .select('id, display_name, avatar_url')
      .eq('is_banned', false)
      .eq('is_anonymous', false)
      .order('display_name', { ascending: true })
      .limit(limit);
    if (trimmed) q = q.ilike('display_name', `%${trimmed}%`);
    if (excludeIds.length) {
      q = q.not('id', 'in', `(${excludeIds.join(',')})`);
    }
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  }

  function filterCached(
    rows: Pick<Profile, 'id' | 'display_name' | 'avatar_url'>[],
  ) {
    const exclude = new Set(excludeIds);
    const lower = trimmed.toLowerCase();
    return rows
      .filter((p) => !exclude.has(p.id) && p.id !== ANONYMOUS_ID)
      .filter((p) =>
        lower ? p.display_name.toLowerCase().includes(lower) : true,
      )
      .sort((a, b) => a.display_name.localeCompare(b.display_name))
      .slice(0, limit);
  }

  if (isOffline()) {
    const cached = await getCachedRoster();
    return filterCached(cached);
  }

  try {
    const rows = await fromNetwork();
    // Mirror every result into the cache — even narrowed searches
    // contribute. Users excluded from this specific call are still
    // covered by the AppShell prefetch (no exclude), so the cache
    // stays comprehensive over time.
    void cacheRoster(rows);
    return rows;
  } catch (err) {
    if (looksLikeNetworkError(err)) {
      const cached = await getCachedRoster();
      return filterCached(cached);
    }
    throw err;
  }
}

export interface CreateMatchInput {
  matchType: MatchType;
  creatorId: string;
  partnerId?: string;        // doubles: creator's teammate. singles: undefined.
  opponentIds: string[];     // singles: 1 id. doubles: 2 ids.
  scoreA: number;
  scoreB: number;
  // Optional override — used by the offline flush path so the match
  // is dated when the player actually recorded it, not when the
  // queue happened to drain. Omitted → DB default now() applies.
  playedAt?: string;
}

export async function createMatch(input: CreateMatchInput): Promise<Match> {
  const {
    matchType,
    creatorId,
    partnerId,
    opponentIds,
    scoreA,
    scoreB,
    playedAt,
  } = input;

  if (scoreA === scoreB) throw new Error('Scores cannot be tied');
  if (scoreA < 0 || scoreB < 0) throw new Error('Scores cannot be negative');

  if (matchType === 'singles') {
    if (opponentIds.length !== 1) throw new Error('Singles needs exactly 1 opponent');
    if (partnerId) throw new Error('Singles has no partner');
  } else {
    if (!partnerId) throw new Error('Doubles needs a partner');
    if (opponentIds.length !== 2) throw new Error('Doubles needs exactly 2 opponents');
    // Real players must be unique. Anonymous is allowed to repeat
    // (it's a placeholder for missing/unsigned guests).
    const realIds = [creatorId, partnerId, ...opponentIds].filter(
      (id) => id !== ANONYMOUS_ID,
    );
    if (new Set(realIds).size !== realIds.length) {
      throw new Error('Players must be unique');
    }
  }

  const { data: match, error: matchErr } = await supabase
    .from('badminton_matches')
    .insert({
      match_type: matchType,
      created_by: creatorId,
      score_a: scoreA,
      score_b: scoreB,
      ...(playedAt ? { played_at: playedAt } : {}),
    })
    .select()
    .single();
  if (matchErr) throw matchErr;
  if (!match) throw new Error('Failed to create match');

  const teamA: { user_id: string; team: Team }[] = [{ user_id: creatorId, team: 'A' }];
  if (matchType === 'doubles' && partnerId) {
    teamA.push({ user_id: partnerId, team: 'A' });
  }
  const teamB: { user_id: string; team: Team }[] = opponentIds.map((id) => ({
    user_id: id,
    team: 'B' as Team,
  }));

  // Slot is per-user-per-match. Real players always get slot 0; the
  // anonymous user gets 0, 1, 2... so it can fill multiple positions
  // in the same match (PK is match_id + user_id + slot).
  const slotCounter = new Map<string, number>();
  const rows = [...teamA, ...teamB].map((p) => {
    const slot = slotCounter.get(p.user_id) ?? 0;
    slotCounter.set(p.user_id, slot + 1);
    return {
      match_id: match.id,
      user_id: p.user_id,
      team: p.team,
      slot,
    };
  });

  const { error: partsErr } = await supabase.from('badminton_match_participants').insert(rows);
  if (partsErr) {
    // Best-effort cleanup so we don't leave an orphan match
    await supabase.from('badminton_matches').delete().eq('id', match.id);
    throw partsErr;
  }

  // Auto-accept the creator's own confirmation. (Anonymous is auto-
  // accepted server-side by the auto_accept_anonymous BEFORE INSERT
  // trigger, so we don't need to update those rows here.)
  const { error: ackErr } = await supabase
    .from('badminton_match_participants')
    .update({ confirmation: 'accepted', responded_at: new Date().toISOString() })
    .eq('match_id', match.id)
    .eq('user_id', creatorId);
  if (ackErr) throw ackErr;

  return match;
}

// Online-aware wrapper for createMatch. If the device is offline (or
// the network insert fails with what looks like a network error), the
// payload is persisted to IndexedDB and replayed by
// flushPendingMatches() when connectivity returns.
//
// Returns:
//   { kind: 'sent', match }    — successfully posted to the server
//   { kind: 'queued' }         — saved locally; will retry later
export async function recordMatchOnlineOrQueue(
  input: CreateMatchInput,
  participantNames: string[],
): Promise<{ kind: 'sent'; match: Match } | { kind: 'queued' }> {
  const queuedPayload: QueuedMatchInput = {
    type: input.matchType,
    creatorId: input.creatorId,
    partnerId: input.partnerId ?? null,
    opponentIds: input.opponentIds,
    scoreA: input.scoreA,
    scoreB: input.scoreB,
    playedAt: new Date().toISOString(),
    participantNames,
    queuedAt: new Date().toISOString(),
  };

  if (isOffline()) {
    await queueMatch(queuedPayload);
    return { kind: 'queued' };
  }
  try {
    const match = await createMatch(input);
    return { kind: 'sent', match };
  } catch (err) {
    if (looksLikeNetworkError(err)) {
      await queueMatch(queuedPayload);
      return { kind: 'queued' };
    }
    throw err;
  }
}

// Replay any matches that were queued offline. Called from AppShell
// on mount + on the browser 'online' event. Returns the count of
// matches that successfully flushed.
export async function flushPendingMatches(): Promise<number> {
  if (isOffline()) return 0;
  const queue = await getQueuedMatches();
  let sent = 0;
  for (const q of queue) {
    try {
      await createMatch({
        matchType: q.type,
        creatorId: q.creatorId,
        partnerId: q.partnerId ?? undefined,
        opponentIds: q.opponentIds,
        scoreA: q.scoreA,
        scoreB: q.scoreB,
        // Stamp the original queue-time so the match is dated when
        // it was actually played, not when the queue happened to
        // drain. Important: phones can sit offline for hours.
        playedAt: q.playedAt,
      });
      await deleteQueuedMatch(q.id);
      sent += 1;
    } catch (err) {
      if (looksLikeNetworkError(err)) {
        // Connection died mid-flush — leave the rest queued for later.
        break;
      }
      // Permanent failure (RLS, validation, etc.) — drop the row so
      // it doesn't loop forever. The user lost this submission, but
      // the alternative is replaying it indefinitely on every load.
      await deleteQueuedMatch(q.id);
    }
  }
  return sent;
}

// Online-aware wrapper for editing a pending match. Mirrors
// recordMatchOnlineOrQueue — queues to IDB on offline / network
// failure, returns 'queued' so the UI can show the user-edited
// state immediately while waiting for connectivity.
export interface EditMatchInput {
  matchId: string;
  partnerId: string | null;     // null for singles
  opponentIds: string[];
  scoreA: number;
  scoreB: number;
}

export async function updateMatchOnlineOrQueue(
  input: EditMatchInput,
  participantNames: string[],
): Promise<{ kind: 'sent' } | { kind: 'queued' }> {
  const queuedPayload: QueuedMatchEdit = {
    match_id: input.matchId,
    partner_id: input.partnerId,
    opponent_ids: input.opponentIds,
    score_a: input.scoreA,
    score_b: input.scoreB,
    participant_names: participantNames,
    queued_at: new Date().toISOString(),
  };

  async function callRpc() {
    const { error } = await supabase.rpc('badminton_update_pending_match', {
      p_match_id: input.matchId,
      p_partner_id: input.partnerId,
      p_opponent_ids: input.opponentIds,
      p_score_a: input.scoreA,
      p_score_b: input.scoreB,
    });
    if (error) throw error;
  }

  if (isOffline()) {
    await queueMatchEdit(queuedPayload);
    return { kind: 'queued' };
  }
  try {
    await callRpc();
    // If a queued edit for this match exists from an earlier offline
    // session, drop it — the latest edit just succeeded online.
    await deleteQueuedMatchEdit(input.matchId);
    return { kind: 'sent' };
  } catch (err) {
    if (looksLikeNetworkError(err)) {
      await queueMatchEdit(queuedPayload);
      return { kind: 'queued' };
    }
    throw err;
  }
}

// Replay any edits that were queued offline. Called from AppShell
// on mount + on the browser 'online' event. Failures from the
// guard checks (match no longer pending, someone accepted, etc.)
// drop the queued edit silently — the user can be notified via a
// later UI pass if needed.
export async function flushPendingMatchEdits(): Promise<{
  sent: number;
  dropped: number;
}> {
  if (isOffline()) return { sent: 0, dropped: 0 };
  const queue = await getQueuedMatchEdits();
  let sent = 0;
  let dropped = 0;
  for (const e of queue) {
    try {
      const { error } = await supabase.rpc('badminton_update_pending_match', {
        p_match_id: e.match_id,
        p_partner_id: e.partner_id,
        p_opponent_ids: e.opponent_ids,
        p_score_a: e.score_a,
        p_score_b: e.score_b,
      });
      if (error) throw error;
      await deleteQueuedMatchEdit(e.match_id);
      sent += 1;
    } catch (err) {
      if (looksLikeNetworkError(err)) {
        // Connection died mid-flush — leave the rest queued.
        break;
      }
      // Permanent failure (match no longer pending, someone
      // accepted, etc.). Drop the row so it doesn't loop forever.
      await deleteQueuedMatchEdit(e.match_id);
      dropped += 1;
    }
  }
  return { sent, dropped };
}

export async function respondToMatch(
  matchId: string,
  userId: string,
  decision: 'accepted' | 'rejected',
): Promise<void> {
  const { error } = await supabase
    .from('badminton_match_participants')
    .update({ confirmation: decision, responded_at: new Date().toISOString() })
    .eq('match_id', matchId)
    .eq('user_id', userId);
  if (error) throw error;
}

export interface MatchSummary {
  match: Match;
  myTeam: Team;
  myConfirmation: Confirmation;
  myRatingDelta: number | null;
  participants: ParticipantSummary[];
}

// All matches the current user is a participant in, newest first.
export async function getMyMatches(userId: string, limit = 50): Promise<MatchSummary[]> {
  const { data: mine, error: e1 } = await supabase
    .from('badminton_match_participants')
    .select('match_id, team, confirmation, rating_delta')
    .eq('user_id', userId);
  if (e1) throw e1;
  if (!mine || mine.length === 0) return [];

  const matchIds = mine.map((m) => m.match_id);
  const { data: matches, error: e2 } = await supabase
    .from('badminton_matches')
    .select('*')
    .in('id', matchIds)
    .order('played_at', { ascending: false })
    .limit(limit);
  if (e2) throw e2;
  if (!matches || matches.length === 0) return [];

  const liveIds = matches.map((m) => m.id);
  const { data: parts, error: e3 } = await supabase
    .from('badminton_match_participants')
    .select('match_id, user_id, team, confirmation')
    .in('match_id', liveIds);
  if (e3) throw e3;

  const userIds = Array.from(new Set((parts ?? []).map((p) => p.user_id)));
  const { data: profiles, error: e4 } = await supabase
    .from('badminton_profiles')
    .select('id, display_name, avatar_url')
    .in('id', userIds);
  if (e4) throw e4;
  const profileMap = new Map(profiles?.map((p) => [p.id, p]) ?? []);

  return matches.map((match) => {
    const me = mine.find((m) => m.match_id === match.id)!;
    const matchParts: ParticipantSummary[] = (parts ?? [])
      .filter((p) => p.match_id === match.id)
      .map((p) => ({
        user_id: p.user_id,
        team: p.team as Team,
        confirmation: p.confirmation as Confirmation,
        profile: profileMap.get(p.user_id) ?? {
          id: p.user_id,
          display_name: 'Unknown',
          avatar_url: null,
        },
      }));
    return {
      match,
      myTeam: me.team as Team,
      myConfirmation: me.confirmation as Confirmation,
      myRatingDelta: me.rating_delta ?? null,
      participants: matchParts,
    };
  });
}

// Matches where the current user has a pending confirmation.
export async function getPendingForUser(userId: string): Promise<PendingMatchSummary[]> {
  const { data: myPending, error: e1 } = await supabase
    .from('badminton_match_participants')
    .select('match_id, team')
    .eq('user_id', userId)
    .eq('confirmation', 'pending');
  if (e1) throw e1;
  if (!myPending || myPending.length === 0) return [];

  const matchIds = myPending.map((p) => p.match_id);

  const { data: matches, error: e2 } = await supabase
    .from('badminton_matches')
    .select('*')
    .in('id', matchIds)
    .eq('status', 'pending');
  if (e2) throw e2;
  if (!matches || matches.length === 0) return [];

  const liveIds = matches.map((m) => m.id);

  const { data: parts, error: e3 } = await supabase
    .from('badminton_match_participants')
    .select('match_id, user_id, team, confirmation')
    .in('match_id', liveIds);
  if (e3) throw e3;

  const userIds = Array.from(new Set((parts ?? []).map((p) => p.user_id)));
  const { data: profiles, error: e4 } = await supabase
    .from('badminton_profiles')
    .select('id, display_name, avatar_url')
    .in('id', userIds);
  if (e4) throw e4;
  const profileMap = new Map(profiles?.map((p) => [p.id, p]) ?? []);

  return matches.map((match) => {
    const me = myPending.find((p) => p.match_id === match.id)!;
    const matchParts: ParticipantSummary[] = (parts ?? [])
      .filter((p) => p.match_id === match.id)
      .map((p) => ({
        user_id: p.user_id,
        team: p.team as Team,
        confirmation: p.confirmation as Confirmation,
        profile: profileMap.get(p.user_id) ?? {
          id: p.user_id,
          display_name: 'Unknown',
          avatar_url: null,
        },
      }));
    return { match, myTeam: me.team as Team, participants: matchParts };
  });
}

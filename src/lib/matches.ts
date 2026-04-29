import { supabase } from './supabase';
import type { Database, MatchType, Team } from './database.types';

type Profile = Database['public']['Tables']['profiles']['Row'];
type Match = Database['public']['Tables']['matches']['Row'];

export interface PendingMatchSummary {
  match: Match;
  myTeam: Team;
  participants: Array<{ user_id: string; team: Team; profile: Pick<Profile, 'id' | 'display_name' | 'avatar_url'> }>;
}

export async function searchPlayers(
  query: string,
  excludeIds: string[] = [],
  limit = 8,
): Promise<Pick<Profile, 'id' | 'display_name' | 'avatar_url'>[]> {
  let q = supabase
    .from('profiles')
    .select('id, display_name, avatar_url')
    .order('display_name', { ascending: true })
    .limit(limit);

  const trimmed = query.trim();
  if (trimmed) {
    q = q.ilike('display_name', `%${trimmed}%`);
  }
  if (excludeIds.length) {
    q = q.not('id', 'in', `(${excludeIds.join(',')})`);
  }

  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export interface CreateMatchInput {
  matchType: MatchType;
  creatorId: string;
  partnerId?: string;        // doubles: creator's teammate. singles: undefined.
  opponentIds: string[];     // singles: 1 id. doubles: 2 ids.
  scoreA: number;
  scoreB: number;
}

export async function createMatch(input: CreateMatchInput): Promise<Match> {
  const { matchType, creatorId, partnerId, opponentIds, scoreA, scoreB } = input;

  if (scoreA === scoreB) throw new Error('Scores cannot be tied');
  if (scoreA < 0 || scoreB < 0) throw new Error('Scores cannot be negative');

  if (matchType === 'singles') {
    if (opponentIds.length !== 1) throw new Error('Singles needs exactly 1 opponent');
    if (partnerId) throw new Error('Singles has no partner');
  } else {
    if (!partnerId) throw new Error('Doubles needs a partner');
    if (opponentIds.length !== 2) throw new Error('Doubles needs exactly 2 opponents');
    const allIds = [creatorId, partnerId, ...opponentIds];
    if (new Set(allIds).size !== allIds.length) throw new Error('Players must be unique');
  }

  const { data: match, error: matchErr } = await supabase
    .from('matches')
    .insert({
      match_type: matchType,
      created_by: creatorId,
      score_a: scoreA,
      score_b: scoreB,
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

  const rows = [...teamA, ...teamB].map((p) => ({
    match_id: match.id,
    user_id: p.user_id,
    team: p.team,
  }));

  const { error: partsErr } = await supabase.from('match_participants').insert(rows);
  if (partsErr) {
    // Best-effort cleanup so we don't leave an orphan match
    await supabase.from('matches').delete().eq('id', match.id);
    throw partsErr;
  }

  // Auto-accept the creator's own confirmation.
  const { error: ackErr } = await supabase
    .from('match_participants')
    .update({ confirmation: 'accepted', responded_at: new Date().toISOString() })
    .eq('match_id', match.id)
    .eq('user_id', creatorId);
  if (ackErr) throw ackErr;

  return match;
}

export async function respondToMatch(
  matchId: string,
  userId: string,
  decision: 'accepted' | 'rejected',
): Promise<void> {
  const { error } = await supabase
    .from('match_participants')
    .update({ confirmation: decision, responded_at: new Date().toISOString() })
    .eq('match_id', matchId)
    .eq('user_id', userId);
  if (error) throw error;
}

export interface MatchSummary {
  match: Match;
  myTeam: Team;
  myConfirmation: 'pending' | 'accepted' | 'rejected';
  myRatingDelta: number | null;
  participants: Array<{ user_id: string; team: Team; profile: Pick<Profile, 'id' | 'display_name' | 'avatar_url'> }>;
}

// All matches the current user is a participant in, newest first.
export async function getMyMatches(userId: string, limit = 50): Promise<MatchSummary[]> {
  const { data: mine, error: e1 } = await supabase
    .from('match_participants')
    .select('match_id, team, confirmation, rating_delta')
    .eq('user_id', userId);
  if (e1) throw e1;
  if (!mine || mine.length === 0) return [];

  const matchIds = mine.map((m) => m.match_id);
  const { data: matches, error: e2 } = await supabase
    .from('matches')
    .select('*')
    .in('id', matchIds)
    .order('played_at', { ascending: false })
    .limit(limit);
  if (e2) throw e2;
  if (!matches || matches.length === 0) return [];

  const liveIds = matches.map((m) => m.id);
  const { data: parts, error: e3 } = await supabase
    .from('match_participants')
    .select('match_id, user_id, team')
    .in('match_id', liveIds);
  if (e3) throw e3;

  const userIds = Array.from(new Set((parts ?? []).map((p) => p.user_id)));
  const { data: profiles, error: e4 } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_url')
    .in('id', userIds);
  if (e4) throw e4;
  const profileMap = new Map(profiles?.map((p) => [p.id, p]) ?? []);

  return matches.map((match) => {
    const me = mine.find((m) => m.match_id === match.id)!;
    const matchParts = (parts ?? [])
      .filter((p) => p.match_id === match.id)
      .map((p) => ({
        user_id: p.user_id,
        team: p.team as Team,
        profile: profileMap.get(p.user_id) ?? {
          id: p.user_id,
          display_name: 'Unknown',
          avatar_url: null,
        },
      }));
    return {
      match,
      myTeam: me.team as Team,
      myConfirmation: me.confirmation as MatchSummary['myConfirmation'],
      myRatingDelta: me.rating_delta ?? null,
      participants: matchParts,
    };
  });
}

// Matches where the current user has a pending confirmation.
export async function getPendingForUser(userId: string): Promise<PendingMatchSummary[]> {
  const { data: myPending, error: e1 } = await supabase
    .from('match_participants')
    .select('match_id, team')
    .eq('user_id', userId)
    .eq('confirmation', 'pending');
  if (e1) throw e1;
  if (!myPending || myPending.length === 0) return [];

  const matchIds = myPending.map((p) => p.match_id);

  const { data: matches, error: e2 } = await supabase
    .from('matches')
    .select('*')
    .in('id', matchIds)
    .eq('status', 'pending');
  if (e2) throw e2;
  if (!matches || matches.length === 0) return [];

  const liveIds = matches.map((m) => m.id);

  const { data: parts, error: e3 } = await supabase
    .from('match_participants')
    .select('match_id, user_id, team')
    .in('match_id', liveIds);
  if (e3) throw e3;

  const userIds = Array.from(new Set((parts ?? []).map((p) => p.user_id)));
  const { data: profiles, error: e4 } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_url')
    .in('id', userIds);
  if (e4) throw e4;
  const profileMap = new Map(profiles?.map((p) => [p.id, p]) ?? []);

  return matches.map((match) => {
    const me = myPending.find((p) => p.match_id === match.id)!;
    const matchParts = (parts ?? [])
      .filter((p) => p.match_id === match.id)
      .map((p) => ({
        user_id: p.user_id,
        team: p.team as Team,
        profile: profileMap.get(p.user_id) ?? {
          id: p.user_id,
          display_name: 'Unknown',
          avatar_url: null,
        },
      }));
    return { match, myTeam: me.team as Team, participants: matchParts };
  });
}

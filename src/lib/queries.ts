import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
} from '@tanstack/react-query';
import { supabase } from './supabase';
import {
  getMyMatches,
  respondToMatch,
  type MatchSummary,
} from './matches';
import type { Database } from './database.types';

// Central query/mutation hooks. All hot paths route through here so:
//   * cache key naming stays consistent (qk.* below)
//   * mutations can invalidate / patch the right caches in one place
//   * pages keep last-known data on remount instead of flashing blank
//
// Cache strategy: queries have a 30s staleTime (set in main.tsx)
// so tab switches feel instant — the cached data renders while a
// background revalidation runs. Mutations either invalidate the
// affected key (refetch) or patch the cache directly (optimistic).

type Profile = Database['public']['Tables']['profiles']['Row'];
type ProfileLite = Pick<Profile, 'id' | 'display_name' | 'avatar_url'>;
type Match = Database['public']['Tables']['matches']['Row'];
type Team = 'A' | 'B';

// ---------------------------------------------------------------------------
// Key factory — single source of truth so invalidations always match
// ---------------------------------------------------------------------------

export const qk = {
  myMatches: (userId: string) => ['my-matches', userId] as const,
  myProfile: (userId: string) => ['my-profile', userId] as const,
  leaderboard: (tab: 'singles' | 'doubles') => ['leaderboard', tab] as const,
  winStreaks: () => ['win-streaks'] as const,
  awaitingAdmin: () => ['awaiting-admin'] as const,
};

// ---------------------------------------------------------------------------
// Match list for the current user (drives /record)
// ---------------------------------------------------------------------------

export function useMyMatches(userId: string | undefined) {
  return useQuery({
    queryKey: userId ? qk.myMatches(userId) : ['my-matches', 'anon'],
    queryFn: () => getMyMatches(userId!),
    enabled: !!userId,
  });
}

// Accept or reject a pending match invitation. Optimistically flips the
// caller's confirmation in cache so the invitation card disappears and
// it moves into the right lane (pending / history) without waiting for
// the round trip.
export function useRespondToMatch(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      matchId: string;
      decision: 'accepted' | 'rejected';
    }) => {
      if (!userId) throw new Error('Not signed in');
      await respondToMatch(vars.matchId, userId, vars.decision);
    },
    onMutate: async (vars) => {
      if (!userId) return;
      const key = qk.myMatches(userId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<MatchSummary[]>(key);
      // Patch our confirmation immediately. If it's a reject, also
      // flip the match status so the row leaves "pending" → history.
      qc.setQueryData<MatchSummary[]>(key, (curr) =>
        (curr ?? []).map((m) => {
          if (m.match.id !== vars.matchId) return m;
          const newStatus =
            vars.decision === 'rejected' ? 'rejected' : m.match.status;
          return {
            ...m,
            myConfirmation: vars.decision,
            match: { ...m.match, status: newStatus },
            participants: m.participants.map((p) =>
              p.user_id === userId ? { ...p, confirmation: vars.decision } : p,
            ),
          };
        }),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (!userId) return;
      // Roll back on failure
      qc.setQueryData(qk.myMatches(userId), ctx?.prev);
    },
    onSettled: () => {
      if (!userId) return;
      // Always refetch to pick up any settle-trigger side effects
      // (ELO deltas stamped onto participants, status flips, etc.)
      qc.invalidateQueries({ queryKey: qk.myMatches(userId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Current user's profile (drives ShopPage balance + armed shield)
// ---------------------------------------------------------------------------

export interface MyProfileLite {
  shards: number;
  armed_shield: 'iron' | 'aura' | null;
  armed_booster: 'shuttle' | null;
}

export function useMyProfile(userId: string | undefined) {
  return useQuery({
    queryKey: userId ? qk.myProfile(userId) : ['my-profile', 'anon'],
    queryFn: async (): Promise<MyProfileLite> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('shards, armed_shield, armed_booster')
        .eq('id', userId!)
        .maybeSingle();
      if (error) throw error;
      return {
        shards: data?.shards ?? 0,
        armed_shield: (data?.armed_shield as 'iron' | 'aura' | null) ?? null,
        armed_booster: (data?.armed_booster as 'shuttle' | null) ?? null,
      };
    },
    enabled: !!userId,
  });
}

// Buy a shield. Optimistically deducts shards and arms the slot so
// the UI changes instantly; rolls back on error.
export function useBuyShield(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (kind: 'iron' | 'aura') => {
      const { data, error } = await supabase.rpc('buy_shield', { p_kind: kind });
      if (error) throw error;
      return data as number;
    },
    onMutate: async (kind) => {
      if (!userId) return;
      const key = qk.myProfile(userId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<MyProfileLite>(key);
      const cost = kind === 'iron' ? 60 : 110;
      qc.setQueryData<MyProfileLite>(key, (curr) =>
        curr
          ? {
              ...curr,
              shards: Math.max(0, curr.shards - cost),
              armed_shield: kind,
            }
          : curr,
      );
      return { prev };
    },
    onError: (_err, _kind, ctx) => {
      if (!userId) return;
      qc.setQueryData(qk.myProfile(userId), ctx?.prev);
    },
    onSettled: () => {
      if (!userId) return;
      qc.invalidateQueries({ queryKey: qk.myProfile(userId) });
    },
  });
}

// Buy a booster. Mirrors useBuyShield — separate slot, separate cost.
export function useBuyBooster(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (kind: 'shuttle') => {
      const { data, error } = await supabase.rpc('buy_booster', { p_kind: kind });
      if (error) throw error;
      return data as number;
    },
    onMutate: async (kind) => {
      if (!userId) return;
      const key = qk.myProfile(userId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<MyProfileLite>(key);
      const cost = kind === 'shuttle' ? 50 : 0;
      qc.setQueryData<MyProfileLite>(key, (curr) =>
        curr
          ? {
              ...curr,
              shards: Math.max(0, curr.shards - cost),
              armed_booster: kind,
            }
          : curr,
      );
      return { prev };
    },
    onError: (_err, _kind, ctx) => {
      if (!userId) return;
      qc.setQueryData(qk.myProfile(userId), ctx?.prev);
    },
    onSettled: () => {
      if (!userId) return;
      qc.invalidateQueries({ queryKey: qk.myProfile(userId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Leaderboard (per mode)
// ---------------------------------------------------------------------------

export function useLeaderboard(tab: 'singles' | 'doubles') {
  return useQuery({
    queryKey: qk.leaderboard(tab),
    queryFn: async (): Promise<Profile[]> => {
      const ratingCol = tab === 'singles' ? 'singles_rating' : 'doubles_rating';
      const gamesCol =
        tab === 'singles' ? 'singles_games_played' : 'doubles_games_played';
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('is_banned', false)
        .eq('is_anonymous', false)
        .order(ratingCol, { ascending: false })
        .order(gamesCol, { ascending: false })
        .order('display_name', { ascending: true })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as Profile[];
    },
  });
}

// Per-mode win streaks for the leaderboard fire-halo badges.
export interface StreakRow {
  user_id: string;
  singles_streak: number;
  doubles_streak: number;
}

export function useWinStreaks() {
  return useQuery({
    queryKey: qk.winStreaks(),
    queryFn: async (): Promise<StreakRow[]> => {
      const { data, error } = await supabase.rpc('get_win_streaks');
      if (error) throw error;
      return (data ?? []) as StreakRow[];
    },
  });
}

// ---------------------------------------------------------------------------
// Admin: matches awaiting admin approval (anonymous-tainted matches)
// ---------------------------------------------------------------------------

export interface AwaitingAdminMatch {
  match_id: string;
  match_type: 'singles' | 'doubles';
  score_a: number;
  score_b: number;
  created_at: string;
  creator_name: string;
  team_a: { user_id: string; display_name: string }[];
  team_b: { user_id: string; display_name: string }[];
}

export function useAwaitingAdminMatches(enabled = true) {
  return useQuery({
    queryKey: qk.awaitingAdmin(),
    enabled,
    queryFn: async (): Promise<AwaitingAdminMatch[]> => {
      const { data: matches, error: e1 } = await supabase
        .from('matches')
        .select('id, match_type, score_a, score_b, played_at, created_by')
        .eq('status', 'awaiting_admin')
        .order('played_at', { ascending: false });
      if (e1) throw e1;
      if (!matches || matches.length === 0) return [];

      const ids = matches.map((m) => m.id);
      const creatorIds = Array.from(new Set(matches.map((m) => m.created_by)));

      const [{ data: parts, error: e2 }, { data: profs, error: e3 }] =
        await Promise.all([
          supabase
            .from('match_participants')
            .select('match_id, user_id, team, profiles:user_id(display_name)')
            .in('match_id', ids),
          supabase
            .from('profiles')
            .select('id, display_name')
            .in('id', creatorIds),
        ]);
      if (e2) throw e2;
      if (e3) throw e3;

      const ANON = '00000000-0000-0000-0000-000000000001';
      type PartRow = {
        match_id: string;
        user_id: string;
        team: Team;
        profiles: { display_name: string } | null;
      };
      const partsCast = (parts ?? []) as unknown as PartRow[];
      const creatorMap = new Map(
        (profs ?? []).map((p) => [p.id, p.display_name]),
      );
      return matches.map((m): AwaitingAdminMatch => {
        const mine = partsCast.filter((p) => p.match_id === m.id);
        const mapTeam = (team: Team) =>
          mine
            .filter((p) => p.team === team)
            .map((p) => ({
              user_id: p.user_id,
              display_name:
                p.user_id === ANON
                  ? 'Anonymous'
                  : p.profiles?.display_name ?? 'Unknown',
            }));
        return {
          match_id: m.id,
          match_type: m.match_type as 'singles' | 'doubles',
          score_a: m.score_a,
          score_b: m.score_b,
          created_at: m.played_at,
          creator_name: creatorMap.get(m.created_by) ?? 'Unknown',
          team_a: mapTeam('A'),
          team_b: mapTeam('B'),
        };
      });
    },
  });
}

// Approve or reject an anonymous-tainted match. Optimistically removes
// the row from the awaiting list and refetches in the background.
type AdminCtx = { prev?: AwaitingAdminMatch[] };

export function useAdminMatchAction(
  options?: UseMutationOptions<
    void,
    Error,
    { matchId: string; action: 'approve' | 'reject' },
    AdminCtx
  >,
) {
  const qc = useQueryClient();
  return useMutation<
    void,
    Error,
    { matchId: string; action: 'approve' | 'reject' },
    AdminCtx
  >({
    mutationFn: async (vars) => {
      const fn =
        vars.action === 'approve'
          ? 'approve_anonymous_match'
          : 'reject_anonymous_match';
      const { error } = await supabase.rpc(fn, { p_match_id: vars.matchId });
      if (error) throw error;
    },
    onMutate: async (vars) => {
      const key = qk.awaitingAdmin();
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<AwaitingAdminMatch[]>(key);
      qc.setQueryData<AwaitingAdminMatch[]>(key, (curr) =>
        (curr ?? []).filter((m) => m.match_id !== vars.matchId),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      qc.setQueryData(qk.awaitingAdmin(), ctx?.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.awaitingAdmin() });
    },
    ...options,
  });
}

// Re-export so consumers don't have to know whether their type lives
// here or in matches.ts.
export type { ProfileLite, Match };

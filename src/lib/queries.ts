import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
} from '@tanstack/react-query';
import { supabase } from './supabase';
import {
  getMyMatches,
  recordMatchOnlineOrQueue,
  respondToMatch,
  type CreateMatchInput,
  type MatchSummary,
} from './matches';
import { ANONYMOUS_ID } from './anonymous';
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

type Profile = Database['public']['Tables']['badminton_profiles']['Row'];
type ProfileLite = Pick<Profile, 'id' | 'display_name' | 'avatar_url'>;
type Match = Database['public']['Tables']['badminton_matches']['Row'];
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
    // Always refetch when /record mounts — catches new invitations
    // someone else submitted while we were away, and picks up
    // status flips (e.g. match moved to History after the admin
    // approved an anonymous-tainted match we were a participant in).
    refetchOnMount: 'always',
  });
}

// Submit a new match for confirmation. Wraps the existing online-or-
// queue helper and invalidates the caller's match list so the new
// pending match appears in /record immediately (instead of requiring
// a refresh).
export function useCreateMatch(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      input: CreateMatchInput;
      participantNames: string[];
    }) => {
      return recordMatchOnlineOrQueue(vars.input, vars.participantNames);
    },
    onSuccess: () => {
      if (!userId) return;
      qc.invalidateQueries({ queryKey: qk.myMatches(userId) });
    },
  });
}

// Accept or reject a pending match invitation. Predicts the post-
// settle state client-side so the row lands directly in its final
// lane (Awaiting → Pending → History) on the first render, instead
// of flashing through intermediate states from a server refetch.
//
// We deliberately do NOT invalidate the cache after success — the
// optimistic state IS the final state. The previous flow's refetch
// caused the same flicker the chat-reaction fix solved.
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

      qc.setQueryData<MatchSummary[]>(key, (curr) =>
        (curr ?? []).map((m) => {
          if (m.match.id !== vars.matchId) return m;

          // Predict the new match.status mirroring server-side
          // settle_match: one accept per team is enough to settle.
          // Anonymous tainted → awaiting_admin. Any reject kills it.
          let newStatus = m.match.status;
          if (vars.decision === 'rejected') {
            newStatus = 'rejected';
          } else {
            const myTeam = m.myTeam;
            const otherTeam = myTeam === 'A' ? 'B' : 'A';
            const otherTeamAccepted = m.participants.some(
              (p) => p.team === otherTeam && p.confirmation === 'accepted',
            );
            if (otherTeamAccepted) {
              const hasAnonymous = m.participants.some(
                (p) => p.user_id === ANONYMOUS_ID,
              );
              newStatus = hasAnonymous ? 'awaiting_admin' : 'confirmed';
            }
          }

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
      qc.setQueryData(qk.myMatches(userId), ctx?.prev);
    },
    // NOTE: no onSettled invalidate — the optimistic update is
    // authoritative. rating_delta + confirmed_at are filled on the
    // next natural refetch (page focus, navigation, or 30s staleTime).
  });
}

// ---------------------------------------------------------------------------
// Current user's profile (drives ShopPage balance + armed shield)
// ---------------------------------------------------------------------------

export type PetKind = 'doux' | 'mort' | 'tard' | 'vita';

export interface MyProfileLite {
  shards: number;
  armed_shield: 'iron' | 'aura' | null;
  armed_booster: 'shuttle' | null;
  owned_pets: PetKind[];
  equipped_pet: PetKind | null;
  // Per-mode rating + games — needed for shop tier gates and any
  // other client-side eligibility checks.
  singles_rating: number;
  singles_games_played: number;
  doubles_rating: number;
  doubles_games_played: number;
  // Used to compute pending pet shards (shown in the Pet Spaces
  // basket). Updated by claim_pet_daily() server-side.
  pets_last_payout_at: string;
}

export function useMyProfile(userId: string | undefined) {
  return useQuery({
    queryKey: userId ? qk.myProfile(userId) : ['my-profile', 'anon'],
    queryFn: async (): Promise<MyProfileLite> => {
      // Pet shards no longer auto-credit on profile read — the
      // player collects them manually via the Pet Spaces basket
      // (calls claim_pet_daily). We do still need the timestamp
      // here so the basket can show pending shards.
      const { data, error } = await supabase
        .from('badminton_profiles')
        .select('shards, armed_shield, armed_booster, owned_pets, equipped_pet, singles_rating, singles_games_played, doubles_rating, doubles_games_played, pets_last_payout_at')
        .eq('id', userId!)
        .maybeSingle();
      if (error) throw error;
      // Cast through unknown: the long .select() string trips the
      // PostgREST type inference. Fields are real columns; types are
      // correct here.
      const row = (data ?? {}) as unknown as {
        shards?: number;
        armed_shield?: 'iron' | 'aura' | null;
        armed_booster?: 'shuttle' | null;
        owned_pets?: string[];
        equipped_pet?: PetKind | null;
        singles_rating?: number;
        singles_games_played?: number;
        doubles_rating?: number;
        doubles_games_played?: number;
        pets_last_payout_at?: string;
      };
      return {
        shards: row.shards ?? 0,
        armed_shield: row.armed_shield ?? null,
        armed_booster: row.armed_booster ?? null,
        owned_pets: (row.owned_pets ?? []) as PetKind[],
        equipped_pet: row.equipped_pet ?? null,
        singles_rating: row.singles_rating ?? 1000,
        singles_games_played: row.singles_games_played ?? 0,
        doubles_rating: row.doubles_rating ?? 1000,
        doubles_games_played: row.doubles_games_played ?? 0,
        pets_last_payout_at:
          row.pets_last_payout_at ?? new Date().toISOString(),
      };
    },
    enabled: !!userId,
    // Shard balance + armed items change every time a match settles —
    // a settle from another participant's accept can move our balance
    // and consume our shield without any local action. Always refetch
    // on /shop mount so we see those.
    refetchOnMount: 'always',
  });
}

// Buy a shield. Optimistically deducts shards and arms the slot so
// the UI changes instantly; rolls back on error.
export function useBuyShield(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (kind: 'iron' | 'aura') => {
      const { data, error } = await supabase.rpc('badminton_buy_shield', { p_kind: kind });
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

const PET_COST = 150;

// Buy a pet — permanent unlock + auto-equip. Optimistically adds to
// owned_pets, sets equipped_pet, deducts shards.
export function useBuyPet(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (kind: PetKind) => {
      const { data, error } = await supabase.rpc('badminton_buy_pet', { p_kind: kind });
      if (error) throw error;
      return data as number;
    },
    onMutate: async (kind) => {
      if (!userId) return;
      const key = qk.myProfile(userId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<MyProfileLite>(key);
      qc.setQueryData<MyProfileLite>(key, (curr) =>
        curr
          ? {
              ...curr,
              shards: Math.max(0, curr.shards - PET_COST),
              owned_pets: curr.owned_pets.includes(kind)
                ? curr.owned_pets
                : [...curr.owned_pets, kind],
              // Auto-equip only when no pet currently displayed.
              equipped_pet: curr.equipped_pet ?? kind,
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

// Swap which owned pet is equipped (or unequip with null).
// Collect accumulated daily pet shards. The basket UI in Pet Spaces
// shows how many are pending (computed client-side from
// pets_last_payout_at × owned-pet count). On success the server
// credits + advances the timestamp; we refetch the profile so the
// new balance + timestamp reflect.
export function useClaimPetDaily(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('badminton_claim_pet_daily');
      if (error) throw error;
      return data as number;
    },
    onSuccess: () => {
      if (!userId) return;
      qc.invalidateQueries({ queryKey: qk.myProfile(userId) });
    },
  });
}

export function useEquipPet(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (kind: PetKind | null) => {
      const { error } = await supabase.rpc('badminton_equip_pet', { p_kind: kind });
      if (error) throw error;
    },
    onMutate: async (kind) => {
      if (!userId) return;
      const key = qk.myProfile(userId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<MyProfileLite>(key);
      qc.setQueryData<MyProfileLite>(key, (curr) =>
        curr ? { ...curr, equipped_pet: kind } : curr,
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
      const { data, error } = await supabase.rpc('badminton_buy_booster', { p_kind: kind });
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
        .from('badminton_profiles')
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
    refetchOnMount: 'always',
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
      const { data, error } = await supabase.rpc('badminton_get_win_streaks');
      if (error) throw error;
      return (data ?? []) as StreakRow[];
    },
    refetchOnMount: 'always',
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
    refetchOnMount: 'always',
    queryFn: async (): Promise<AwaitingAdminMatch[]> => {
      const { data: matches, error: e1 } = await supabase
        .from('badminton_matches')
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
            .from('badminton_match_participants')
            .select('match_id, user_id, team, profiles:user_id(display_name)')
            .in('match_id', ids),
          supabase
            .from('badminton_profiles')
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
          ? 'badminton_approve_anonymous_match'
          : 'badminton_reject_anonymous_match';
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
    // No onSettled invalidate — optimistic remove is authoritative
    // (approve → status='confirmed', reject → status='rejected',
    // either way it leaves the awaiting_admin list).
    ...options,
  });
}

// Re-export so consumers don't have to know whether their type lives
// here or in matches.ts.
export type { ProfileLite, Match };

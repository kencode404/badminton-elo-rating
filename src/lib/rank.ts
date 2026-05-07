import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { useAuth } from './auth';
import { ratingToTier, TIERS, type TierDef } from './tiers';

export interface RankDemote {
  mode: 'singles' | 'doubles';
  tier: TierDef;
}

const STORAGE_KEY_PREFIX = 'rank-baseline:';

interface Baseline {
  singles: number;
  doubles: number;
}

function tierRankOrder(rating: number): number {
  // Lookup the position of this rating's tier in the TIERS array.
  const key = ratingToTier(rating).key;
  return TIERS.findIndex((t) => t.key === key);
}

function detectDemote(
  prevSingles: number,
  prevDoubles: number,
  nextSingles: number,
  nextDoubles: number,
): RankDemote | null {
  // Doubles is the primary game mode for this club, so check it
  // first when both modes change in the same update.
  if (tierRankOrder(nextDoubles) < tierRankOrder(prevDoubles)) {
    return { mode: 'doubles', tier: ratingToTier(nextDoubles) };
  }
  if (tierRankOrder(nextSingles) < tierRankOrder(prevSingles)) {
    return { mode: 'singles', tier: ratingToTier(nextSingles) };
  }
  return null;
}

// Watches the current user's ratings and fires the demote overlay
// when their tier drops. Two paths:
//   * Catch-up: on mount, compare the freshly-fetched profile ratings
//     against the last-known ratings stored in localStorage. Catches
//     demotes that happened while the user was offline / on another
//     device.
//   * Live: realtime subscription on the user's own profiles row.
//     When an UPDATE arrives (e.g. settle_match just bumped them
//     down), compare the in-memory baseline against the new ratings.
//
// Promotions are NOT handled here — those are celebrated publicly via
// the system_tier_up chat announcement.
export function useRankDemote(): {
  demote: RankDemote | null;
  dismiss: () => void;
} {
  const { user } = useAuth();
  const [demote, setDemote] = useState<RankDemote | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const storageKey = STORAGE_KEY_PREFIX + user.id;

    // Read baseline from localStorage (may be missing on first load).
    let baseline: Baseline | null = null;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) baseline = JSON.parse(raw) as Baseline;
    } catch {
      baseline = null;
    }

    function persist(next: Baseline) {
      baseline = next;
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Storage may be full or disabled in private mode — non-fatal.
      }
    }

    // 1) Catch-up: fetch current ratings and compare to baseline.
    supabase
      .from('profiles')
      .select('singles_rating, doubles_rating')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!active || !data) return;
        if (baseline) {
          const change = detectDemote(
            baseline.singles,
            baseline.doubles,
            data.singles_rating,
            data.doubles_rating,
          );
          if (change) setDemote(change);
        }
        persist({ singles: data.singles_rating, doubles: data.doubles_rating });
      });

    // 2) Live: subscribe to UPDATE events on this user's profile row.
    const channel = supabase
      .channel(`profile-rank-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${user.id}`,
        },
        (payload) => {
          if (!active) return;
          const next = payload.new as {
            singles_rating: number;
            doubles_rating: number;
          };
          if (baseline) {
            const change = detectDemote(
              baseline.singles,
              baseline.doubles,
              next.singles_rating,
              next.doubles_rating,
            );
            if (change) setDemote(change);
          }
          persist({
            singles: next.singles_rating,
            doubles: next.doubles_rating,
          });
        },
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [user]);

  return { demote, dismiss: () => setDemote(null) };
}

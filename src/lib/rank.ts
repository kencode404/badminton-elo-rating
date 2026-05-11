import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { useAuth } from './auth';
import {
  ratingToTier,
  TIERS,
  PLACEMENT_GAMES,
  type TierDef,
} from './tiers';

export interface RankEvent {
  direction: 'up' | 'down';
  mode: 'singles' | 'doubles';
  tier: TierDef;
}

const STORAGE_KEY_PREFIX = 'rank-baseline:';

interface Baseline {
  singles: number;
  singles_games: number;
  doubles: number;
  doubles_games: number;
}

function tierRankOrder(rating: number): number {
  return TIERS.findIndex((t) => t.key === ratingToTier(rating).key);
}

// Two events can fire the overlay:
//   * Placement complete — games crossed from < 5 to >= 5 in this
//     mode. Direction is 'up'; tier is the revealed final tier.
//   * Demote — both before and after are post-placement, and the
//     tier rank dropped.
// Promotions outside of placement-complete are intentionally NOT
// surfaced here; those are celebrated publicly via the system_tier_up
// chat announcement.
function detectRankEvent(prev: Baseline, next: Baseline): RankEvent | null {
  for (const mode of ['doubles', 'singles'] as const) {
    const prevRating = mode === 'singles' ? prev.singles : prev.doubles;
    const prevGames = mode === 'singles' ? prev.singles_games : prev.doubles_games;
    const nextRating = mode === 'singles' ? next.singles : next.doubles;
    const nextGames = mode === 'singles' ? next.singles_games : next.doubles_games;

    // Placement just completed in this mode.
    if (prevGames < PLACEMENT_GAMES && nextGames >= PLACEMENT_GAMES) {
      return { direction: 'up', mode, tier: ratingToTier(nextRating) };
    }

    // Demote (both sides post-placement, tier rank decreased).
    if (
      prevGames >= PLACEMENT_GAMES &&
      nextGames >= PLACEMENT_GAMES &&
      tierRankOrder(nextRating) < tierRankOrder(prevRating)
    ) {
      return { direction: 'down', mode, tier: ratingToTier(nextRating) };
    }
  }
  return null;
}

// Watches the current user's own ratings + games-played and fires a
// rank-change overlay on:
//   * placement completion (direction='up') — first time games >= 5
//   * demote (direction='down') — tier dropped while post-placement
// Two paths:
//   * Catch-up: on mount, compare freshly-fetched profile against
//     localStorage baseline.
//   * Live: realtime subscription on the user's own profiles row.
export function useRankChange(): {
  event: RankEvent | null;
  dismiss: () => void;
} {
  const { user } = useAuth();
  const [event, setEvent] = useState<RankEvent | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const storageKey = STORAGE_KEY_PREFIX + user.id;

    let baseline: Baseline | null = null;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Old baseline format only had ratings — treat as missing so
        // we re-establish on first fetch instead of mis-firing.
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          typeof parsed.singles_games === 'number' &&
          typeof parsed.doubles_games === 'number'
        ) {
          baseline = parsed as Baseline;
        }
      }
    } catch {
      baseline = null;
    }

    function persist(next: Baseline) {
      baseline = next;
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // ignore
      }
    }

    function snapshot(row: {
      singles_rating: number;
      doubles_rating: number;
      singles_games_played: number;
      doubles_games_played: number;
    }): Baseline {
      return {
        singles: row.singles_rating,
        doubles: row.doubles_rating,
        singles_games: row.singles_games_played,
        doubles_games: row.doubles_games_played,
      };
    }

    // 1) Catch-up
    supabase
      .from('profiles')
      .select(
        'singles_rating, doubles_rating, singles_games_played, doubles_games_played',
      )
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!active || !data) return;
        const next = snapshot(data);
        if (baseline) {
          const change = detectRankEvent(baseline, next);
          if (change) setEvent(change);
        }
        persist(next);
      });

    // 2) Live
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
          const next = snapshot(
            payload.new as {
              singles_rating: number;
              doubles_rating: number;
              singles_games_played: number;
              doubles_games_played: number;
            },
          );
          if (baseline) {
            const change = detectRankEvent(baseline, next);
            if (change) setEvent(change);
          }
          persist(next);
        },
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [user]);

  return { event, dismiss: () => setEvent(null) };
}

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

// How recent a match must be (in ms) for us to surface a "missed"
// rank event when no localStorage baseline exists. Caps stale events
// from popping up when a player installs the PWA weeks after the
// fact — only matches in the last hour are considered "I just
// played this and probably haven't seen the overlay yet".
const MISSED_EVENT_WINDOW_MS = 60 * 60 * 1000;

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

    // Reconstruct the user's pre-match state from their most recent
    // confirmed match (if within the missed-event window). Used when
    // no localStorage baseline exists — covers PWA fresh installs,
    // new devices, and cleared browser data, which were silently
    // missing the placement-complete / demote overlay.
    async function detectFromLatestMatch(
      current: Baseline,
    ): Promise<RankEvent | null> {
      const cutoff = new Date(
        Date.now() - MISSED_EVENT_WINDOW_MS,
      ).toISOString();
      const { data: matches } = await supabase
        .from('matches')
        .select('id, match_type, confirmed_at')
        .eq('status', 'confirmed')
        .gte('confirmed_at', cutoff)
        .order('confirmed_at', { ascending: false })
        .limit(5);
      if (!matches || matches.length === 0) return null;

      const { data: parts } = await supabase
        .from('match_participants')
        .select('match_id, rating_before')
        .eq('user_id', user!.id)
        .in(
          'match_id',
          matches.map((m) => m.id),
        );
      if (!parts || parts.length === 0) return null;

      // Pair each participant row with its match, sort newest first,
      // pick the most recent the user actually participated in.
      const matchById = new Map(matches.map((m) => [m.id, m]));
      const userMatches = parts
        .map((p) => ({ ...p, match: matchById.get(p.match_id) }))
        .filter(
          (r): r is typeof r & { match: NonNullable<typeof r.match> } =>
            Boolean(r.match?.confirmed_at),
        )
        .sort((a, b) =>
          (b.match.confirmed_at ?? '').localeCompare(a.match.confirmed_at ?? ''),
        );
      if (userMatches.length === 0) return null;

      const latest = userMatches[0];
      const before: Baseline = { ...current };
      if (latest.match.match_type === 'singles') {
        before.singles = latest.rating_before ?? before.singles;
        before.singles_games = Math.max(0, before.singles_games - 1);
      } else {
        before.doubles = latest.rating_before ?? before.doubles;
        before.doubles_games = Math.max(0, before.doubles_games - 1);
      }
      return detectRankEvent(before, current);
    }

    // 1) Catch-up
    supabase
      .from('profiles')
      .select(
        'singles_rating, doubles_rating, singles_games_played, doubles_games_played',
      )
      .eq('id', user.id)
      .maybeSingle()
      .then(async ({ data }) => {
        if (!active || !data) return;
        const next = snapshot(data);
        if (baseline) {
          const change = detectRankEvent(baseline, next);
          if (change) setEvent(change);
        } else {
          // No prior baseline (fresh install / new device / cleared
          // storage). Reconstruct from the latest match to catch any
          // missed placement-complete or demote.
          const change = await detectFromLatestMatch(next);
          if (!active) return;
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

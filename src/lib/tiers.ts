// Rating → tier mapping. Tiers are pure presentation; the underlying
// ELO is the source of truth. Brackets are aligned to the 1000
// starting rating, so fresh signups land in Bronze and climb up.

export type TierKey = 'bronze' | 'silver' | 'gold' | 'diamond' | 'predator';

export interface TierDef {
  key: TierKey;
  name: string;
  minRating: number;
  // Primary tint used for badge gradient and leaderboard row accent
  fromColor: string;
  toColor: string;
  // Border / accent for the leaderboard row
  rowBorder: string;
  rowBg: string;
}

export const TIERS: TierDef[] = [
  {
    key: 'bronze',
    name: 'Bronze',
    minRating: 0,
    fromColor: '#cd7f32',
    toColor: '#5d2e0a',
    rowBorder: 'rgba(180, 95, 39, 0.35)',
    rowBg: 'rgba(120, 65, 25, 0.06)',
  },
  {
    key: 'silver',
    name: 'Silver',
    minRating: 1100,
    fromColor: '#e7eaee',
    toColor: '#7a8190',
    rowBorder: 'rgba(160, 170, 185, 0.40)',
    rowBg: 'rgba(170, 180, 195, 0.06)',
  },
  {
    key: 'gold',
    name: 'Gold',
    minRating: 1250,
    fromColor: '#ffd96a',
    toColor: '#a17314',
    rowBorder: 'rgba(218, 165, 32, 0.50)',
    rowBg: 'rgba(218, 165, 32, 0.08)',
  },
  {
    key: 'diamond',
    name: 'Diamond',
    minRating: 1400,
    fromColor: '#a5f3fc',
    toColor: '#0e7490',
    rowBorder: 'rgba(34, 211, 238, 0.55)',
    rowBg: 'rgba(34, 211, 238, 0.08)',
  },
  {
    key: 'predator',
    name: 'Predator',
    minRating: 1600,
    fromColor: '#fecaca',
    toColor: '#991b1b',
    rowBorder: 'rgba(239, 68, 68, 0.65)',
    rowBg: 'rgba(220, 38, 38, 0.10)',
  },
];

export const PLACEMENT_GAMES = 5;

export type RatingStatus =
  | { kind: 'placement'; gamesPlayed: number; gamesNeeded: number }
  | { kind: 'tier'; tier: TierDef };

// Walks the TIERS array (sorted ascending by minRating) and picks the
// highest tier whose minRating <= the player's rating.
export function ratingToTier(rating: number): TierDef {
  let current = TIERS[0];
  for (const t of TIERS) {
    if (rating >= t.minRating) current = t;
  }
  return current;
}

// Combined: returns 'placement' status if the player still has fewer
// than PLACEMENT_GAMES in this mode, otherwise their tier.
export function ratingStatus(rating: number, gamesPlayed: number): RatingStatus {
  if (gamesPlayed < PLACEMENT_GAMES) {
    return {
      kind: 'placement',
      gamesPlayed,
      gamesNeeded: PLACEMENT_GAMES,
    };
  }
  return { kind: 'tier', tier: ratingToTier(rating) };
}

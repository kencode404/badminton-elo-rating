import { TierBadge } from './TierBadge';
import { ratingToTier } from '../lib/tiers';

export interface PastSeasonSnapshot {
  season_number: number;
  singles_rating: number;
  doubles_rating: number;
  singles_games_played: number;
  doubles_games_played: number;
  singles_wins: number;
  doubles_wins: number;
  singles_rank: number | null;
  doubles_rank: number | null;
}

// Tier-tinted card showing one past season for one user. Doubles is
// shown first (matches the rest of the app's mode order). Used by
// the Profile page and the Profile-detail modal.
export function PastSeasonRow({ snapshot }: { snapshot: PastSeasonSnapshot }) {
  return (
    <li className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
      <div className="flex items-baseline justify-between mb-2">
        <div className="font-display tracking-widest uppercase text-cyan2-500 dark:text-cyan2-300 text-xs">
          Season {snapshot.season_number}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <PastSeasonModeStat
          label="Doubles"
          rating={snapshot.doubles_rating}
          games={snapshot.doubles_games_played}
          wins={snapshot.doubles_wins}
          rank={snapshot.doubles_rank}
        />
        <PastSeasonModeStat
          label="Singles"
          rating={snapshot.singles_rating}
          games={snapshot.singles_games_played}
          wins={snapshot.singles_wins}
          rank={snapshot.singles_rank}
        />
      </div>
    </li>
  );
}

function PastSeasonModeStat({
  label,
  rating,
  games,
  wins,
  rank,
}: {
  label: string;
  rating: number;
  games: number;
  wins: number;
  rank: number | null;
}) {
  const playedAny = games > 0;
  const tier = playedAny ? ratingToTier(rating) : null;
  const winRate = games > 0 ? Math.round((wins / games) * 100) : null;
  const tintStyle: React.CSSProperties = tier
    ? {
        borderColor: tier.rowBorder,
        background: `linear-gradient(135deg, ${tier.rowBg} 0%, transparent 60%)`,
      }
    : {};
  return (
    <div
      className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-2.5"
      style={tintStyle}
    >
      <div className="text-[10px] font-display uppercase tracking-wider text-cyan2-500 dark:text-cyan2-300 flex items-baseline justify-between gap-1">
        <span>{label}</span>
        {rank !== null && (
          <span
            className="font-display tracking-wider"
            style={tier ? { color: tier.toColor } : undefined}
          >
            #{rank}
          </span>
        )}
      </div>
      {playedAny && tier ? (
        <>
          <div className="mt-1">
            <TierBadge status={{ kind: 'tier', tier }} size={20} showName />
          </div>
          <div className="text-[10px] text-zinc-700 dark:text-zinc-300 mt-1 font-display tracking-wider">
            {wins} wins · {winRate}%
          </div>
        </>
      ) : (
        <div className="text-[10px] text-zinc-500 dark:text-zinc-500 mt-1 uppercase tracking-wider">
          — no games
        </div>
      )}
    </div>
  );
}

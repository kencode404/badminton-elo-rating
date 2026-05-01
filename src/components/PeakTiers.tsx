import { TierBadge } from './TierBadge';
import { ratingToTier } from '../lib/tiers';
import type { PastSeasonSnapshot } from './PastSeasonRow';

interface Props {
  profile: {
    singles_rating: number;
    doubles_rating: number;
    singles_games_played: number;
    doubles_games_played: number;
  } | null;
  snapshots: PastSeasonSnapshot[] | null;
  // sm = profile page (slightly larger label + badge)
  // xs = leaderboard modal (compact)
  size?: 'sm' | 'xs';
}

// Renders a "Peak Doubles · TIER" / "Peak Singles · TIER" pair using
// the highest rating the player has ever held in each mode (current
// rating + all past-season snapshots). A mode only renders if the
// player has actually played at least one game in it.
export function PeakTiers({ profile, snapshots, size = 'sm' }: Props) {
  if (!profile || snapshots === null) return null;

  const doublesPeak = peakRating(
    profile.doubles_rating,
    profile.doubles_games_played,
    snapshots,
    'doubles',
  );
  const singlesPeak = peakRating(
    profile.singles_rating,
    profile.singles_games_played,
    snapshots,
    'singles',
  );

  // Nothing to show — player has never played a confirmed match.
  if (doublesPeak === null && singlesPeak === null) return null;

  const labelClass =
    size === 'xs'
      ? 'text-[9px] tracking-widest'
      : 'text-[10px] tracking-widest';
  const badgeSize = size === 'xs' ? 14 : 16;
  const gapClass = size === 'xs' ? 'gap-y-0.5' : 'gap-y-1';

  return (
    <div
      className={`flex flex-col items-start ${gapClass} ${
        size === 'xs' ? 'mt-1' : 'mt-2'
      }`}
    >
      {doublesPeak !== null && (
        <PeakLine
          label="Peak Doubles"
          rating={doublesPeak}
          labelClass={labelClass}
          badgeSize={badgeSize}
        />
      )}
      {singlesPeak !== null && (
        <PeakLine
          label="Peak Singles"
          rating={singlesPeak}
          labelClass={labelClass}
          badgeSize={badgeSize}
        />
      )}
    </div>
  );
}

function PeakLine({
  label,
  rating,
  labelClass,
  badgeSize,
}: {
  label: string;
  rating: number;
  labelClass: string;
  badgeSize: number;
}) {
  const tier = ratingToTier(rating);
  // Render icon + tier name inline manually because TierBadge with
  // showName stacks them vertically (the leaderboard column needs
  // that, but a peak chip wants a single horizontal row).
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`font-display uppercase text-zinc-500 dark:text-zinc-500 ${labelClass}`}
      >
        {label}
      </span>
      <TierBadge
        status={{ kind: 'tier', tier }}
        size={badgeSize}
        showName={false}
      />
      <span
        className={`font-display uppercase ${labelClass}`}
        style={{ color: tier.toColor }}
      >
        {tier.name}
      </span>
    </div>
  );
}

function peakRating(
  currentRating: number,
  currentGames: number,
  snapshots: PastSeasonSnapshot[],
  mode: 'singles' | 'doubles',
): number | null {
  const ratings: number[] = [];
  if (currentGames > 0) ratings.push(currentRating);
  for (const s of snapshots) {
    const games =
      mode === 'singles' ? s.singles_games_played : s.doubles_games_played;
    if (games > 0) {
      ratings.push(mode === 'singles' ? s.singles_rating : s.doubles_rating);
    }
  }
  if (ratings.length === 0) return null;
  return Math.max(...ratings);
}

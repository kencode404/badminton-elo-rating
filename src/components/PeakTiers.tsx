import { TierBadge } from './TierBadge';
import { ratingToTier } from '../lib/tiers';

interface Props {
  profile: {
    peak_singles_rating: number;
    peak_doubles_rating: number;
  } | null;
  // sm = profile page (slightly larger label + badge)
  // xs = leaderboard modal (compact)
  size?: 'sm' | 'xs';
}

const STARTING_RATING = 1000;

// Renders a "Peak Doubles · TIER" / "Peak Singles · TIER" pair using
// the lifetime peak rating per mode stored directly on the profile.
// settle_match keeps these monotonic; reset_season() doesn't touch
// them, so a player's all-time best tier survives season resets and
// past-season snapshot trimming.
export function PeakTiers({ profile, size = 'sm' }: Props) {
  if (!profile) return null;

  const showDoubles = profile.peak_doubles_rating > STARTING_RATING;
  const showSingles = profile.peak_singles_rating > STARTING_RATING;
  if (!showDoubles && !showSingles) return null;

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
      {showDoubles && (
        <PeakLine
          label="Peak Doubles"
          rating={profile.peak_doubles_rating}
          labelClass={labelClass}
          badgeSize={badgeSize}
        />
      )}
      {showSingles && (
        <PeakLine
          label="Peak Singles"
          rating={profile.peak_singles_rating}
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

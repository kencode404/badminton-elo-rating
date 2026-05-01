import { useId } from 'react';
import type { RatingStatus, TierKey } from '../lib/tiers';

// Per-tier idle animations. Lower tiers stay static (a busy list with
// every row twitching reads as noise); Gold gets a quiet glint and the
// top two tiers earn the big shimmer / pulse.
const TIER_ANIMATION: Record<TierKey, string | undefined> = {
  bronze: undefined,
  silver: undefined,
  gold: 'tier-glint-gold 3.8s ease-in-out infinite',
  diamond: 'tier-shimmer-diamond 2.6s ease-in-out infinite',
  predator: 'tier-pulse-predator 2.2s ease-in-out infinite',
};

// Per-tier custom artwork. Tiers in this map use the PNG instead of
// the procedurally-drawn SVG. Useful for hand-crafted badges that
// would be too detailed to draw with primitives.
const TIER_IMAGE: Partial<Record<TierKey, string>> = {
  bronze: '/bronze-tier.png',
  silver: '/silver-tier.png',
  gold: '/gold-tier.png',
  diamond: '/diamond-tier.png',
  predator: '/predator-tier.png',
};

interface Props {
  status: RatingStatus;
  size?: number;        // px, default 22
  showName?: boolean;   // render the tier text alongside
  className?: string;
}

// LoL-style tier badge. Hex for Bronze/Silver/Gold, faceted rhombus for
// Diamond, crown for Predator, with metallic gradients + a subtle inner
// highlight to give the icon depth on flat backgrounds.
export function TierBadge({ status, size = 22, showName = false, className = '' }: Props) {
  if (status.kind === 'placement') {
    // Vertical stack when a label is requested so the "Placement X/Y"
    // text never overflows the column width.
    const wrapperClass = showName
      ? `inline-flex flex-col items-center gap-1 ${className}`
      : `inline-flex items-center gap-1 ${className}`;
    return (
      <span
        className={wrapperClass}
        title={`Placement match ${status.gamesPlayed}/${status.gamesNeeded}`}
      >
        <PlacementIcon size={size} />
        {showName && (
          <span className="text-[10px] font-display uppercase tracking-widest leading-none text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
            Placement {status.gamesPlayed}/{status.gamesNeeded}
          </span>
        )}
      </span>
    );
  }
  const t = status.tier;
  const imageSrc = TIER_IMAGE[t.key];
  const animation = TIER_ANIMATION[t.key];
  // When showName is true the layout switches to a vertical stack —
  // icon on top, label underneath. That way long labels (e.g.
  // "Predator") never overflow the parent column.
  const wrapperClass = showName
    ? `inline-flex flex-col items-center gap-0.5 ${className}`
    : `inline-flex items-center gap-1 ${className}`;
  return (
    <span className={wrapperClass} title={t.name}>
      {imageSrc ? (
        <img
          src={imageSrc}
          alt=""
          width={size}
          height={size}
          className="shrink-0 object-contain"
          style={animation ? { animation } : undefined}
        />
      ) : (
        <TierIcon tierKey={t.key} fromColor={t.fromColor} toColor={t.toColor} size={size} />
      )}
      {showName && (
        <span
          className="text-[10px] font-display uppercase tracking-widest leading-none"
          style={{ color: t.toColor }}
        >
          {t.name}
        </span>
      )}
    </span>
  );
}

function TierIcon({
  tierKey,
  fromColor,
  toColor,
  size,
}: {
  tierKey: TierKey;
  fromColor: string;
  toColor: string;
  size: number;
}) {
  const idBase = useId().replace(/:/g, '');
  const gradId = `tg-${idBase}-${tierKey}`;
  const innerId = `ti-${idBase}-${tierKey}`;
  const glowId = `gl-${idBase}-${tierKey}`;

  const animation = TIER_ANIMATION[tierKey];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      className="shrink-0"
      style={animation ? { animation } : undefined}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fromColor} />
          <stop offset="55%" stopColor={fromColor} stopOpacity="0.85" />
          <stop offset="100%" stopColor={toColor} />
        </linearGradient>
        <linearGradient id={innerId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="white" stopOpacity="0.7" />
          <stop offset="40%" stopColor="white" stopOpacity="0.15" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={glowId} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor={fromColor} stopOpacity="0.6" />
          <stop offset="100%" stopColor={fromColor} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Soft outer glow for higher tiers */}
      {(tierKey === 'diamond' || tierKey === 'predator') && (
        <circle cx="12" cy="12" r="11" fill={`url(#${glowId})`} />
      )}

      {tierKey === 'bronze' && <BronzeShape gradId={gradId} innerId={innerId} />}
      {tierKey === 'silver' && <SilverShape gradId={gradId} innerId={innerId} />}
      {tierKey === 'gold' && <GoldShape gradId={gradId} innerId={innerId} />}
      {tierKey === 'diamond' && <DiamondShape gradId={gradId} />}
      {tierKey === 'predator' && <PredatorShape gradId={gradId} innerId={innerId} />}
    </svg>
  );
}

// Hexagonal shield, a bit pointed at the bottom — bronze era.
function BronzeShape({ gradId, innerId }: { gradId: string; innerId: string }) {
  return (
    <g>
      <polygon
        points="12,2 21,7 21,15 12,22 3,15 3,7"
        fill={`url(#${gradId})`}
        stroke="#3d1e08"
        strokeWidth="0.6"
      />
      {/* inset cut for depth */}
      <polygon
        points="12,4.2 19,8 19,14.5 12,20 5,14.5 5,8"
        fill="none"
        stroke="rgba(0,0,0,0.25)"
        strokeWidth="0.5"
      />
      {/* top highlight */}
      <polygon
        points="12,3 20,7.4 20,11 12,7 4,11 4,7.4"
        fill={`url(#${innerId})`}
      />
    </g>
  );
}

function SilverShape({ gradId, innerId }: { gradId: string; innerId: string }) {
  return (
    <g>
      <polygon
        points="12,2 21,7 21,15 12,22 3,15 3,7"
        fill={`url(#${gradId})`}
        stroke="#3a4150"
        strokeWidth="0.6"
      />
      <polygon
        points="12,4.2 19,8 19,14.5 12,20 5,14.5 5,8"
        fill="none"
        stroke="rgba(0,0,0,0.18)"
        strokeWidth="0.5"
      />
      <polygon
        points="12,3 20,7.4 20,11 12,7 4,11 4,7.4"
        fill={`url(#${innerId})`}
      />
    </g>
  );
}

// Gold shield with a small star pip for that "ranked" feel.
function GoldShape({ gradId, innerId }: { gradId: string; innerId: string }) {
  return (
    <g>
      <polygon
        points="12,2 21,7 21,15 12,22 3,15 3,7"
        fill={`url(#${gradId})`}
        stroke="#5a3d05"
        strokeWidth="0.6"
      />
      <polygon
        points="12,4.2 19,8 19,14.5 12,20 5,14.5 5,8"
        fill="none"
        stroke="rgba(0,0,0,0.30)"
        strokeWidth="0.5"
      />
      {/* inner star */}
      <polygon
        points="12,9 13,11.5 15.6,11.6 13.5,13.3 14.2,15.8 12,14.4 9.8,15.8 10.5,13.3 8.4,11.6 11,11.5"
        fill="rgba(255, 255, 230, 0.85)"
        stroke="rgba(120, 70, 5, 0.6)"
        strokeWidth="0.3"
      />
      <polygon
        points="12,3 20,7.4 20,11 12,7 4,11 4,7.4"
        fill={`url(#${innerId})`}
      />
    </g>
  );
}

// Faceted rhombus crystal.
function DiamondShape({ gradId }: { gradId: string }) {
  return (
    <g>
      <polygon
        points="12,2 21,12 12,22 3,12"
        fill={`url(#${gradId})`}
        stroke="#0e7490"
        strokeWidth="0.6"
      />
      {/* facets */}
      <polyline
        points="12,2 12,22"
        stroke="rgba(255,255,255,0.45)"
        strokeWidth="0.5"
        fill="none"
      />
      <polyline
        points="3,12 21,12"
        stroke="rgba(255,255,255,0.25)"
        strokeWidth="0.5"
        fill="none"
      />
      <polygon
        points="12,2 16,12 12,12"
        fill="white"
        opacity="0.18"
      />
      <polygon
        points="12,2 12,12 8,12"
        fill="white"
        opacity="0.32"
      />
    </g>
  );
}

// Crown silhouette in fiery gradient — top tier (used as fallback if
// the Predator image is unavailable).
function PredatorShape({ gradId, innerId }: { gradId: string; innerId: string }) {
  return (
    <g>
      {/* Crown body: zigzag top, flat base, with three points */}
      <path
        d="M 4 9
           L 7 14
           L 9 7
           L 12 14
           L 15 7
           L 17 14
           L 20 9
           L 20 18
           L 4 18
           Z"
        fill={`url(#${gradId})`}
        stroke="#3a0a4a"
        strokeWidth="0.6"
      />
      {/* gem dots */}
      <circle cx="9" cy="6.4" r="1" fill="#fde047" stroke="#7c3aed" strokeWidth="0.3" />
      <circle cx="12" cy="5" r="1.1" fill="#f97316" stroke="#7c3aed" strokeWidth="0.3" />
      <circle cx="15" cy="6.4" r="1" fill="#a78bfa" stroke="#7c3aed" strokeWidth="0.3" />
      {/* base band highlight */}
      <rect x="4" y="16" width="16" height="2" fill="rgba(0,0,0,0.18)" />
      <path
        d="M 4 9 L 7 14 L 9 7 L 12 14 L 15 7 L 17 14 L 20 9"
        fill={`url(#${innerId})`}
      />
    </g>
  );
}

function PlacementIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeDasharray="3 2"
        opacity="0.6"
      />
      <text
        x="12"
        y="15.5"
        textAnchor="middle"
        fontFamily="system-ui, sans-serif"
        fontSize="10"
        fontWeight="700"
        fill="currentColor"
      >
        ?
      </text>
    </svg>
  );
}

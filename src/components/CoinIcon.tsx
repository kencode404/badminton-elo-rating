import { useId } from 'react';

// In-app currency icon — ethereum silhouette in two-tone transparent
// blue. Glass-crystal aesthetic.
//
// Geometry:
//   * Upper diamond (kite) — top point, widest at upper-middle,
//     bottom point. Split vertically into left half (light) and
//     right half (dark).
//   * Horizontal gap.
//   * Lower pyramid — narrow at top, point at bottom. Same vertical
//     left/right split.
//
// Only TWO colors used (light + dark blue) so the icon reads as one
// faceted object rather than a noisy color palette. Fill-opacity ~0.6
// gives it the see-through crystal feel against any dark panel.

interface Props {
  size?: number;
  className?: string;
  /** Soft glow halo behind the icon. Default true. */
  glow?: boolean;
}

// Two-tone palette
const LIGHT = '#7dd3fc'; // sky-300
const DARK = '#1d4ed8';  // blue-700
const EDGE = '#bae6fd';  // sky-200, thin stroke for facet definition

export function CoinIcon({ size = 24, className, glow = true }: Props) {
  const u = useId().replace(/:/g, '');
  const idGlow = `coin-${u}-g`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      aria-hidden
    >
      {glow && (
        <defs>
          <filter id={idGlow} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="1.4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      )}

      <g filter={glow ? `url(#${idGlow})` : undefined}>
        {/* ---- Upper diamond (kite) ---- */}
        {/* Left half: top (32,3) → mid-left (7,28) → bottom (32,40) */}
        <polygon
          points="32,3 7,28 32,40"
          fill={LIGHT}
          fillOpacity="0.6"
          stroke={EDGE}
          strokeOpacity="0.7"
          strokeWidth="0.5"
          strokeLinejoin="round"
        />
        {/* Right half: top (32,3) → mid-right (57,28) → bottom (32,40) */}
        <polygon
          points="32,3 57,28 32,40"
          fill={DARK}
          fillOpacity="0.55"
          stroke={EDGE}
          strokeOpacity="0.55"
          strokeWidth="0.5"
          strokeLinejoin="round"
        />

        {/* ---- Lower pyramid ---- */}
        {/* Left half: top-left (7,42) → seam-top (32,39) → bottom (32,61) */}
        <polygon
          points="7,42 32,39 32,61"
          fill={LIGHT}
          fillOpacity="0.55"
          stroke={EDGE}
          strokeOpacity="0.6"
          strokeWidth="0.5"
          strokeLinejoin="round"
        />
        {/* Right half: seam-top (32,39) → top-right (57,42) → bottom (32,61) */}
        <polygon
          points="32,39 57,42 32,61"
          fill={DARK}
          fillOpacity="0.55"
          stroke={EDGE}
          strokeOpacity="0.55"
          strokeWidth="0.5"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

import { useId } from 'react';

// In-app currency icon — canonical ethereum geometry rendered in
// transparent blue. Each of the six facets uses the same base blue
// at a different fill-opacity, mirroring the original mark's
// white-with-opacity recipe. The varying opacities produce the
// faceted "lit crystal" effect against a dark panel.

interface Props {
  size?: number;
  className?: string;
  /** Soft glow halo behind the icon. Default true. */
  glow?: boolean;
}

const BLUE = '#7dd3fc'; // sky-300 — the "shining transparent blue"

export function CoinIcon({ size = 24, className, glow = true }: Props) {
  const u = useId().replace(/:/g, '');
  const idGlow = `coin-${u}-g`;

  return (
    <svg
      width={size}
      height={size}
      // Natural ethereum aspect is 256×417 (taller than wide). Pad the
      // viewBox horizontally so the mark sits centered in a square
      // bounding box, and extend bottom by 24 to accommodate the
      // lower pyramid's downward shift that widens the middle gap.
      viewBox="-80 0 416 441"
      className={className}
      aria-hidden
    >
      {glow && (
        <defs>
          <filter id={idGlow} x="-20%" y="-10%" width="140%" height="120%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      )}

      <g filter={glow ? `url(#${idGlow})` : undefined}>
        {/* ---- Upper diamond (kite + back faces) ---- */}
        {/* Upper-right front face (brightest) */}
        <path
          d="M127.961 0L125.166 9.5v275.668l2.795 2.79 127.962-75.638z"
          fill={BLUE}
          fillOpacity="0.7"
        />
        {/* Upper-left front face */}
        <path
          d="M127.962 0L0 212.32l127.962 75.639V154.158z"
          fill={BLUE}
          fillOpacity="0.4"
        />
        {/* Inner back-right (peeks above the horizontal seam) */}
        <path
          d="M127.961 287.958l127.962-75.637-127.962-58.162z"
          fill={BLUE}
          fillOpacity="0.5"
        />
        {/* Inner back-left */}
        <path
          d="M0 212.32l127.96 75.638v-133.8z"
          fill={BLUE}
          fillOpacity="0.32"
        />

        {/* ---- Lower pyramid ----
            Shifted down 24 units to widen the seam gap between the
            upper kite (bottom at y≈288) and the lower pyramid (top
            originally at y≈312, now at y≈336). */}
        <g transform="translate(0, 24)">
          {/* Lower-right pyramid face */}
          <path
            d="M127.961 312.187l-1.575 1.92v98.199l1.575 4.6L256 236.587z"
            fill={BLUE}
            fillOpacity="0.62"
          />
          {/* Lower-left pyramid face */}
          <path
            d="M127.962 416.905v-104.72L0 236.585z"
            fill={BLUE}
            fillOpacity="0.25"
          />
        </g>
      </g>
    </svg>
  );
}

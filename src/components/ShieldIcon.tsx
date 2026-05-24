import { useId } from 'react';

// Shield icons for the shop.
//   * iron — solid metallic shield with a steel frame, center boss
//     and corner rivets. Physical/heavy feel. No animation.
//   * aura — holo HUD: thin cyan outline, internal grid, pulsing
//     outer glow, scanline that sweeps bottom→top on loop. Magical
//     feel.
// Both share the same heater silhouette and the same 3D tilt
// (CSS perspective on the SVG plane + drop-shadow for depth).

interface Props {
  kind: 'iron' | 'aura';
  size?: number;
  className?: string;
}

// Heater-shield silhouette in an 80×80 viewBox.
const SHIELD_PATH =
  'M 14 14 L 66 14 L 66 38 Q 66 60 40 72 Q 14 60 14 38 Z';

// Shared 3D tilt — applied to the SVG plane via CSS perspective so
// animations inside the SVG (Aura's scanline) tilt with it too.
function tiltStyle(glowColor: string): React.CSSProperties {
  return {
    transform: 'perspective(280px) rotateY(-22deg) rotateX(8deg)',
    transformOrigin: 'center',
    filter: `drop-shadow(0 6px 10px ${glowColor})`,
  };
}

export function ShieldIcon({ kind, size = 56, className }: Props) {
  return kind === 'iron' ? (
    <IronShield size={size} className={className} />
  ) : (
    <AuraShield size={size} className={className} />
  );
}

// ---------------------------------------------------------------------------
// Iron — solid metallic shield with frame, center boss, and rivets
// ---------------------------------------------------------------------------

function IronShield({ size, className }: { size: number; className?: string }) {
  const u = useId().replace(/:/g, '');
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      className={className}
      aria-hidden
      style={tiltStyle('rgba(15, 23, 42, 0.55)')}
    >
      <defs>
        {/* Body: RADIAL gradient — bright catch-light at upper-left
            falling off to dark slate at the edges. Reads as a convex
            (domed) metallic surface lit from upper-left. */}
        <radialGradient
          id={`iron-${u}-body`}
          cx="0.35" cy="0.3" r="0.85"
        >
          <stop offset="0%" stopColor="#f1f5f9" />
          <stop offset="22%" stopColor="#cbd5e1" />
          <stop offset="55%" stopColor="#64748b" />
          <stop offset="100%" stopColor="#1e293b" />
        </radialGradient>
        {/* Frame: deeper gradient for the outer ring */}
        <linearGradient id={`iron-${u}-frame`} x1="0.5" y1="0" x2="0.5" y2="1">
          <stop offset="0%" stopColor="#475569" />
          <stop offset="100%" stopColor="#0f172a" />
        </linearGradient>
        {/* Soft glossy highlight blob on the upper-left of the dome */}
        <radialGradient
          id={`iron-${u}-gloss`}
          cx="0.3" cy="0.25" r="0.45"
        >
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        {/* Subtle shadow at the bottom-right of the dome — sells the
            curve rolling away from the light */}
        <radialGradient
          id={`iron-${u}-shadow`}
          cx="0.72" cy="0.78" r="0.5"
        >
          <stop offset="0%" stopColor="#000000" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
        {/* Clip so the highlight/shadow stay inside the body */}
        <clipPath id={`iron-${u}-body-clip`}>
          <path d="M 19 19 L 61 19 L 61 38 Q 61 56 40 66 Q 19 56 19 38 Z" />
        </clipPath>
      </defs>

      {/* Outer frame — drawn as a thick stroke under the body fill */}
      <path
        d={SHIELD_PATH}
        fill={`url(#iron-${u}-frame)`}
        stroke="#0f172a"
        strokeWidth="2"
        strokeLinejoin="round"
      />

      {/* Inset shield body (domed) */}
      <path
        d="M 19 19 L 61 19 L 61 38 Q 61 56 40 66 Q 19 56 19 38 Z"
        fill={`url(#iron-${u}-body)`}
        stroke="#94a3b8"
        strokeOpacity="0.5"
        strokeWidth="0.8"
        strokeLinejoin="round"
      />

      {/* Gloss + shadow layers on top of the body to enhance the
          convex impression */}
      <g clipPath={`url(#iron-${u}-body-clip)`}>
        <rect x="19" y="19" width="42" height="47" fill={`url(#iron-${u}-shadow)`} />
        <rect x="19" y="19" width="42" height="47" fill={`url(#iron-${u}-gloss)`} />
      </g>

      {/* Curved specular streak along the upper area — follows the
          dome rather than being a straight line */}
      <path
        d="M 24 23 Q 40 18 56 23"
        fill="none"
        stroke="#f1f5f9"
        strokeOpacity="0.55"
        strokeWidth="1.2"
        strokeLinecap="round"
      />

      {/* Center boss (raised dome) */}
      <circle cx="40" cy="40" r="5.5" fill="#1e293b" />
      <circle cx="40" cy="40" r="4.2" fill="#64748b" />
      <circle cx="38.5" cy="38.5" r="1.6" fill="#e2e8f0" fillOpacity="0.8" />

      {/* Corner rivets on the frame */}
      <circle cx="20" cy="20" r="1.6" fill="#0f172a" />
      <circle cx="60" cy="20" r="1.6" fill="#0f172a" />
      <circle cx="20" cy="20" r="0.6" fill="#94a3b8" fillOpacity="0.7" />
      <circle cx="60" cy="20" r="0.6" fill="#94a3b8" fillOpacity="0.7" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Aura — holo HUD shield with pulse + scanline
// ---------------------------------------------------------------------------

const CYAN = '#22d3ee';
const SCAN = '#7dd3fc';

function AuraShield({ size, className }: { size: number; className?: string }) {
  const u = useId().replace(/:/g, '');
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      className={className}
      aria-hidden
      style={tiltStyle('rgba(125, 211, 252, 0.45)')}
    >
      <defs>
        <clipPath id={`aura-${u}-clip`}>
          <path d={SHIELD_PATH} />
        </clipPath>
        <linearGradient id={`aura-${u}-scan`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={SCAN} stopOpacity="0" />
          <stop offset="50%" stopColor={SCAN} stopOpacity="0.85" />
          <stop offset="100%" stopColor={SCAN} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Outer glow ring — pulses opacity */}
      <path
        d={SHIELD_PATH}
        fill="none"
        stroke={CYAN}
        strokeWidth="2.5"
        strokeOpacity="0.4"
        style={{ filter: 'blur(3px)' }}
      >
        <animate
          attributeName="stroke-opacity"
          values="0.3;0.85;0.3"
          dur="2s"
          repeatCount="indefinite"
        />
      </path>

      {/* Main outline + dim fill */}
      <path
        d={SHIELD_PATH}
        fill="#0c4a6e"
        fillOpacity="0.35"
        stroke={CYAN}
        strokeWidth="1.5"
        strokeOpacity="0.9"
      />

      {/* Internal HUD grid */}
      <g clipPath={`url(#aura-${u}-clip)`}>
        <line
          x1="14" y1="32" x2="66" y2="32"
          stroke={CYAN} strokeOpacity="0.6" strokeWidth="0.7"
        />
        <line
          x1="40" y1="14" x2="40" y2="72"
          stroke={CYAN} strokeOpacity="0.5" strokeWidth="0.7"
        />
        <line
          x1="27" y1="14" x2="27" y2="60"
          stroke={CYAN} strokeOpacity="0.28" strokeWidth="0.5"
        />
        <line
          x1="53" y1="14" x2="53" y2="60"
          stroke={CYAN} strokeOpacity="0.28" strokeWidth="0.5"
        />

        {/* Scanline */}
        <rect x="14" y="-8" width="52" height="6" fill={`url(#aura-${u}-scan)`}>
          <animate
            attributeName="y"
            values="72;-8"
            dur="2.4s"
            repeatCount="indefinite"
          />
        </rect>
      </g>
    </svg>
  );
}

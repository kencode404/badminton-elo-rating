import { useEffect, useState } from 'react';
import { TierBadge } from './TierBadge';
import type { TierDef } from '../lib/tiers';

interface Props {
  direction: 'up' | 'down';
  tier: TierDef;
  onDismiss: () => void;
}

const FADE_OUT_MS = 400;

// Full-screen tier promotion / demotion celebration. Renders a dark
// backdrop with the tier badge floating huge in the center, animated
// in with bounce (up) or fall (down), tier-colored sparks for
// promotions, and an explicit OK button to return to the app.
//
// No auto-dismiss — the player decides when to close it. Refresh the
// page to replay the animation from scratch (useful for previewing).
export function RankChangeOverlay({ direction, tier, onDismiss }: Props) {
  const [closing, setClosing] = useState(false);
  const isUp = direction === 'up';

  // Esc dismisses (a11y)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setClosing(true);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // After fade-out animation, call dismiss
  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(onDismiss, FADE_OUT_MS);
    return () => clearTimeout(t);
  }, [closing, onDismiss]);

  const headerText = isUp ? 'RANK UP!' : 'RANK DOWN';
  const subtitle = isUp ? 'You reached' : 'Demoted to';
  const message = isUp ? 'Keep climbing.' : 'Climb back up.';
  const buttonLabel = isUp ? "LET'S GO" : 'OK';

  const headerColor = isUp ? tier.toColor : '#fb7185'; // tier color up; rose for down
  const iconAnim = isUp
    ? 'rank-up-icon-rise 0.85s cubic-bezier(0.34, 1.56, 0.64, 1) both'
    : 'rank-down-icon-fall 0.95s ease-out both';

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md transition-opacity ${
        closing ? 'opacity-0' : 'opacity-100'
      }`}
      style={{ transitionDuration: `${FADE_OUT_MS}ms` }}
      role="dialog"
      aria-modal="true"
      aria-label={isUp ? 'Rank up' : 'Rank down'}
    >
      <div className="flex flex-col items-center gap-6 px-6 select-none text-center">
        <h2
          className="font-display tracking-[0.4em] text-2xl sm:text-3xl pointer-events-none"
          style={{
            color: headerColor,
            textShadow: `0 0 20px ${headerColor}99, 0 0 50px ${headerColor}55`,
            animation: 'rank-text-fade-in 0.5s ease-out 0.1s both',
          }}
        >
          {headerText}
        </h2>

        <div
          className="relative pointer-events-none"
          style={{ animation: iconAnim }}
        >
          {/* Soft radial halo behind icon */}
          <div
            className="absolute pointer-events-none rounded-full"
            style={{
              inset: '-60px',
              background: `radial-gradient(circle, ${tier.toColor}66 0%, ${tier.toColor}22 35%, transparent 70%)`,
              animation: isUp
                ? 'rank-glow-pulse 1.8s ease-in-out infinite'
                : 'rank-down-dim-pulse 2.4s ease-in-out infinite',
              filter: !isUp ? 'saturate(0.4)' : undefined,
            }}
            aria-hidden
          />
          {/* Tier badge — uses the same TierBadge users see elsewhere */}
          <div
            style={{
              filter: !isUp ? 'saturate(0.55) brightness(0.85)' : undefined,
            }}
          >
            <TierBadge
              status={{ kind: 'tier', tier }}
              size={200}
              showName={false}
            />
          </div>
          {/* Sparks for rank up only */}
          {isUp && <SparkBurst color={tier.toColor} />}
        </div>

        <div
          className="pointer-events-none"
          style={{ animation: 'rank-text-fade-in 0.6s ease-out 0.5s both' }}
        >
          <div className="text-xs font-display tracking-widest uppercase text-zinc-400 mb-2">
            {subtitle}
          </div>
          <div
            className="font-display text-5xl sm:text-6xl tracking-widest uppercase"
            style={{
              color: tier.toColor,
              textShadow: `0 0 30px ${tier.toColor}cc, 0 0 60px ${tier.toColor}66`,
            }}
          >
            {tier.name}
          </div>
        </div>

        <div
          className="text-sm font-display tracking-widest uppercase text-zinc-300 mt-2 pointer-events-none"
          style={{ animation: 'rank-text-fade-in 0.6s ease-out 0.9s both' }}
        >
          {message}
        </div>

        <button
          type="button"
          onClick={() => setClosing(true)}
          className="mt-8 px-8 py-3 rounded-full font-display tracking-[0.25em] uppercase text-sm transition active:scale-95"
          style={{
            background: isUp
              ? `linear-gradient(135deg, ${tier.fromColor}, ${tier.toColor})`
              : 'linear-gradient(135deg, #52525b, #27272a)',
            color: isUp ? '#0a0a0c' : '#e4e4e7',
            boxShadow: isUp
              ? `0 0 24px ${tier.toColor}99, inset 0 1px 0 rgba(255,255,255,0.25)`
              : '0 4px 14px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.08)',
            border: isUp
              ? `1px solid ${tier.toColor}`
              : '1px solid rgba(255,255,255,0.15)',
            animation: 'rank-text-fade-in 0.6s ease-out 1.4s both',
          }}
          autoFocus
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}

// 16-spike spark ring radiating from the icon center.
function SparkBurst({ color }: { color: string }) {
  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden>
      {Array.from({ length: 16 }).map((_, i) => {
        const angle = (i * 360) / 16 + (i % 2) * 11;
        const dist = 140 + ((i * 13) % 50);
        const dur = 1.4 + ((i * 7) % 8) * 0.08;
        const delay = ((i * 17) % 100) / 100 * 0.5;
        const size = 3 + ((i * 5) % 4);
        return (
          <span
            key={i}
            className="absolute top-1/2 left-1/2 w-0 h-0"
            style={
              {
                '--spark-rotate': `${angle}deg`,
                '--spark-end': `-${dist}px`,
                animation: `rank-spark-burst ${dur.toFixed(2)}s ease-out ${delay.toFixed(2)}s infinite`,
              } as React.CSSProperties
            }
          >
            <span
              style={{
                position: 'absolute',
                left: -size / 2,
                top: -size / 2,
                width: size,
                height: size,
                borderRadius: '50%',
                background: color,
                boxShadow: `0 0 ${size + 4}px ${color}, 0 0 ${size + 9}px ${color}`,
              }}
            />
          </span>
        );
      })}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { formatError } from '../lib/errors';
import { ProfileDetailModal } from '../components/ProfileDetailModal';
import { TierBadge } from '../components/TierBadge';
import { ratingStatus, PLACEMENT_GAMES, TIERS, type RatingStatus } from '../lib/tiers';
import type { Database } from '../lib/database.types';

type Tab = 'singles' | 'doubles';
type Profile = Database['public']['Tables']['profiles']['Row'];

export function LeaderboardPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const previewMode = searchParams.get('preview') === 'tiers';
  const [tab, setTab] = useState<Tab>('doubles');
  const [rows, setRows] = useState<Profile[] | null>(null);
  const [streaks, setStreaks] = useState<Map<string, { singles: number; doubles: number }>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [openUserId, setOpenUserId] = useState<string | null>(null);

  const displayedRows = useMemo(() => {
    if (!rows) return null;
    if (!previewMode) return rows;
    // Prepend mock players (one per tier + a placement player) so all
    // row styling can be inspected on a freshly-seeded club. Real
    // rows still render below the mocks.
    return [...buildPreviewRows(tab), ...rows];
  }, [rows, tab, previewMode]);

  useEffect(() => {
    let active = true;
    setRows(null);
    setError(null);
    const ratingCol = tab === 'singles' ? 'singles_rating' : 'doubles_rating';
    const gamesCol = tab === 'singles' ? 'singles_games_played' : 'doubles_games_played';
    supabase
      .from('profiles')
      .select('*')
      .order(ratingCol, { ascending: false })
      .order(gamesCol, { ascending: false })
      .order('display_name', { ascending: true })
      .limit(100)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setError(formatError(error));
        else setRows(data ?? []);
      });
    return () => {
      active = false;
    };
  }, [tab]);

  // Streaks are computed per mode by the RPC; fetch once.
  useEffect(() => {
    let active = true;
    supabase
      .rpc('get_win_streaks')
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          // Non-fatal — leaderboard still works without streak badges.
          return;
        }
        const map = new Map<string, { singles: number; doubles: number }>();
        for (const row of (data ?? []) as {
          user_id: string;
          singles_streak: number;
          doubles_streak: number;
        }[]) {
          map.set(row.user_id, {
            singles: row.singles_streak ?? 0,
            doubles: row.doubles_streak ?? 0,
          });
        }
        setStreaks(map);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="p-4 space-y-4">
      <div className="section-title text-base mb-1">Leaderboard</div>

      <div className="flex glass-panel p-1">
        {(['doubles', 'singles'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-lg text-xs font-display tracking-wider uppercase transition ${
              tab === t
                ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                : 'text-zinc-500 dark:text-zinc-400'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {error && (
        <div className="text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/40 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {previewMode && (
        <div className="text-[10px] font-display tracking-widest uppercase text-cyan2-500 dark:text-cyan2-300 bg-cyan2-500/5 border border-cyan2-400/30 rounded-md px-3 py-2">
          Preview mode · mock players prepended for tier styling check
        </div>
      )}

      {displayedRows === null ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-500">Loading…</p>
      ) : displayedRows.length === 0 ? (
        <section className="glass-panel p-6 text-center">
          <div className="text-3xl mb-2 text-cyan2-400" aria-hidden>✦</div>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            No players yet. Once members sign up, rankings will appear here.
          </p>
        </section>
      ) : (
        <ol className="space-y-2">
          {orderForTab(displayedRows, tab).map((p, i) => {
            const s = streaks.get(p.id);
            const streak = s ? (tab === 'singles' ? s.singles : s.doubles) : 0;
            return (
              <Row
                key={p.id}
                rank={i + 1}
                profile={p}
                tab={tab}
                isMe={user?.id === p.id}
                streak={streak}
                onClick={() => setOpenUserId(p.id)}
              />
            );
          })}
        </ol>
      )}

      {openUserId && (
        <ProfileDetailModal userId={openUserId} onClose={() => setOpenUserId(null)} />
      )}
    </div>
  );
}

function Row({
  rank,
  profile,
  tab,
  isMe,
  streak,
  onClick,
}: {
  rank: number;
  profile: Profile;
  tab: Tab;
  isMe: boolean;
  streak: number;
  onClick: () => void;
}) {
  const rating = tab === 'singles' ? profile.singles_rating : profile.doubles_rating;
  const games = tab === 'singles' ? profile.singles_games_played : profile.doubles_games_played;
  const status = ratingStatus(rating, games);
  const showMedal = (rank === 1 || rank === 2 || rank === 3) && status.kind === 'tier';

  // Per-tier row tint + accent border. Predator rows also pulse, and
  // Diamond/Predator rows get an electric sweep band traveling
  // left-to-right.
  const rowTintStyle: React.CSSProperties = {};
  let extraClass = '';
  let sweepGradient: string | null = null;
  let sweepDelay = '0s';
  if (status.kind === 'tier') {
    rowTintStyle.background = `linear-gradient(135deg, ${status.tier.rowBg} 0%, transparent 60%)`;
    rowTintStyle.borderColor = status.tier.rowBorder;
    if (status.tier.key === 'predator') {
      extraClass = 'animate-pulse-glow';
      rowTintStyle.boxShadow = '0 0 14px rgba(239, 68, 68, 0.30)';
      sweepGradient =
        'linear-gradient(90deg, transparent 0%, rgba(252, 165, 165, 0) 25%, rgba(252, 165, 165, 0.60) 50%, rgba(239, 68, 68, 0) 75%, transparent 100%)';
      sweepDelay = '1.2s';
    } else if (status.tier.key === 'diamond') {
      rowTintStyle.boxShadow = '0 0 8px rgba(34, 211, 238, 0.18)';
      sweepGradient =
        'linear-gradient(90deg, transparent 0%, rgba(165, 243, 252, 0) 25%, rgba(165, 243, 252, 0.55) 50%, rgba(34, 211, 238, 0) 75%, transparent 100%)';
    }
  }

  return (
    <li
      className={`glass-panel relative ${extraClass} ${
        isMe ? 'ring-1 ring-cyan2-400/60' : ''
      }`}
      style={rowTintStyle}
    >
      {sweepGradient && (
        <div
          className="absolute inset-0 overflow-hidden pointer-events-none"
          style={{ borderRadius: 'inherit' }}
          aria-hidden
        >
          <span
            className="row-sweep-band"
            style={{
              background: sweepGradient,
              animationDelay: sweepDelay,
            }}
          />
        </div>
      )}
      <button
        type="button"
        onClick={onClick}
        className="w-full p-3 flex items-center gap-3 text-left active:scale-[0.99] transition rounded-2xl"
        aria-label={`View ${profile.display_name}'s profile`}
      >
        {showMedal ? (
          <Medal rank={rank as 1 | 2 | 3} />
        ) : (
          <div className="w-12 text-center font-display text-sm text-zinc-500 dark:text-zinc-400 shrink-0">
            #{rank}
          </div>
        )}

      <Avatar profile={profile} streak={streak} />

      <div className="flex-1 min-w-0">
        <div
          className={`text-sm truncate flex items-center gap-1 ${
            isMe
              ? 'font-display tracking-wide uppercase text-cyan2-600 dark:text-cyan2-300'
              : 'text-zinc-900 dark:text-zinc-100'
          }`}
        >
          <span className="truncate">{profile.display_name}</span>
          {streak >= 2 && (
            <span
              className={`text-[10px] font-display tracking-wider px-1.5 py-0.5 rounded shrink-0 ${
                streak >= 3
                  ? 'bg-orange-500/15 text-orange-500'
                  : 'bg-amber-500/10 text-amber-500'
              }`}
              title={`${streak}-win streak`}
              style={{
                animation: `pill-pulse ${
                  streak >= 4 ? '1.4s' : streak >= 3 ? '2s' : '2.6s'
                } ease-in-out infinite`,
              }}
            >
              {streak} wins
            </span>
          )}
          {isMe && <span className="text-[9px] tracking-widest ml-1">· you</span>}
        </div>
        <div className="text-[10px] text-zinc-500 dark:text-zinc-500 tracking-wider uppercase mt-0.5">
          {games} {games === 1 ? 'game' : 'games'}
        </div>
      </div>

        <div className="shrink-0 w-[92px] flex flex-col items-center gap-2 self-start">
          <TierBadge status={status} size={tierBadgeSize(status)} showName />
          <TierProgress status={status} rating={rating} />
        </div>
      </button>
    </li>
  );
}

function Avatar({ profile, streak }: { profile: Profile; streak: number }) {
  const showRing = streak >= 2;
  const showSparks = streak >= 4;
  const ringColor = streak >= 3 ? '#f97316' : '#fbbf24'; // amber → orange
  const sparkColor = ringColor;
  // Pulse speed steps down by streak: 2-win calm, 3-win mild bump,
  // 4+-win full intensity.
  const ringDur =
    streak >= 4 ? '1.2s' : streak >= 3 ? '1.7s' : '2s';
  const boltCount = streak >= 5 ? 12 : 8;

  return (
    <div className="relative shrink-0 w-9 h-9">
      {showRing && (
        <span
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            border: `2px solid ${ringColor}`,
            boxShadow: `0 0 8px ${ringColor}`,
            animation: `ring-grow ${ringDur} ease-in-out infinite`,
          }}
          aria-hidden
        />
      )}
      {showSparks &&
        Array.from({ length: boltCount }).map((_, i) => {
            const baseAngle = (i * 360) / boltCount;
            const jitter = ((i * 47) % 30) - 15;            // ±15°
            const angle = baseAngle + jitter;
            const endDist = 26 + ((i * 13) % 14);            // 26–39 px out
            const dur = 0.85 + ((i * 11) % 7) * 0.06;        // ~0.85–1.21s
            const delay = ((i * 31) % 100) / 100;            // 0–1.0s
            const size = 1 + ((i * 7) % 3) * 0.5;            // 1, 1.5, or 2px
            return (
              <span
                key={i}
                className="absolute top-1/2 left-1/2 w-0 h-0 pointer-events-none"
                style={
                  {
                    '--spark-rotate': `${angle}deg`,
                    '--spark-end': `-${endDist}px`,
                    animation: `spark-burst ${dur.toFixed(2)}s ease-out infinite`,
                    animationDelay: `${delay.toFixed(2)}s`,
                  } as React.CSSProperties
                }
                aria-hidden
              >
                <span
                  style={{
                    position: 'absolute',
                    left: -size / 2,
                    top: -size / 2,
                    width: size,
                    height: size,
                    borderRadius: '50%',
                    background: sparkColor,
                    boxShadow: `0 0 ${size + 3}px ${sparkColor}, 0 0 ${size + 6}px ${sparkColor}`,
                  }}
                />
              </span>
            );
        })}
      <div className="relative z-10 w-9 h-9">
        {profile.avatar_url ? (
          <img
            src={profile.avatar_url}
            alt=""
            className="w-9 h-9 rounded-full object-cover border border-zinc-200 dark:border-zinc-700"
          />
        ) : (
          <div className="w-9 h-9 rounded-full bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 flex items-center justify-center font-semibold">
            {profile.display_name?.[0]?.toUpperCase() ?? '?'}
          </div>
        )}
      </div>
    </div>
  );
}

// Thin progress bar showing how far the player is through their current
// tier (or placement window). Replaces the raw rating number on the row
// so the leaderboard reads as "progression toward the next badge"
// rather than a numeric ranking.
function TierProgress({ status, rating }: { status: RatingStatus; rating: number }) {
  if (status.kind === 'placement') {
    const pct = (status.gamesPlayed / status.gamesNeeded) * 100;
    return <ProgressBar pct={pct} />;
  }
  const tier = status.tier;
  const next = TIERS.find((t) => t.minRating > tier.minRating);
  if (!next) {
    // Predator / max tier — full bar in predator red gradient.
    return (
      <div className="w-full h-1 rounded-full overflow-hidden">
        <div
          className="h-full w-full"
          style={{
            background: 'linear-gradient(90deg, #fca5a5, #991b1b)',
            boxShadow: '0 0 6px rgba(239, 68, 68, 0.55)',
          }}
        />
      </div>
    );
  }
  const span = next.minRating - tier.minRating;
  const pct = Math.min(100, Math.max(0, ((rating - tier.minRating) / span) * 100));
  return <ProgressBar pct={pct} />;
}

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="w-full h-1 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
      <div
        className="h-full rounded-full"
        style={{
          width: `${pct}%`,
          background: 'linear-gradient(90deg, #38bdf8, #0ea5e9)',
          boxShadow: '0 0 6px rgba(56, 189, 248, 0.55)',
        }}
      />
    </div>
  );
}

// Per-tier badge size on the leaderboard row. Higher tiers render
// bigger so the climb is visible at a glance — Predator stands out,
// Bronze/placement stay modest.
function tierBadgeSize(status: RatingStatus): number {
  if (status.kind === 'placement') return 36;
  switch (status.tier.key) {
    case 'bronze':   return 38;
    case 'silver':   return 42;
    case 'gold':     return 46;
    case 'diamond':  return 50;
    case 'predator': return 54;
  }
}

// Mock leaderboard rows used by ?preview=tiers — one player per tier
// (Bronze → Predator) plus a placement player, so all row styling can
// be inspected even when the real leaderboard only has Silver players.
function buildPreviewRows(tab: Tab): Profile[] {
  const samples: Array<{ id: string; name: string; rating: number; games: number }> = [
    { id: 'preview-predator', name: '[Preview] Predator', rating: 1780, games: 80 },
    { id: 'preview-diamond',  name: '[Preview] Diamond', rating: 1500, games: 50 },
    { id: 'preview-gold',     name: '[Preview] Gold',    rating: 1325, games: 30 },
    { id: 'preview-silver',   name: '[Preview] Silver',  rating: 1175, games: 18 },
    { id: 'preview-bronze',   name: '[Preview] Bronze',  rating: 1040, games: 12 },
    { id: 'preview-placement',name: '[Preview] Newbie',  rating: 1000, games: 2 },
  ];
  const isSingles = tab === 'singles';
  return samples.map((s) => ({
    id: s.id,
    display_name: s.name,
    avatar_url: null,
    singles_rating: isSingles ? s.rating : 1000,
    doubles_rating: isSingles ? 1000 : s.rating,
    singles_games_played: isSingles ? s.games : 0,
    doubles_games_played: isSingles ? 0 : s.games,
    created_at: new Date().toISOString(),
    chat_last_seen_at: new Date().toISOString(),
  }));
}

// Tiered players come first (sorted by rating desc — already done by SQL),
// placement players are grouped at the bottom. Within each group the
// original SQL order is preserved.
function orderForTab(rows: Profile[], tab: Tab): Profile[] {
  const tiered: Profile[] = [];
  const placement: Profile[] = [];
  for (const p of rows) {
    const games =
      tab === 'singles' ? p.singles_games_played : p.doubles_games_played;
    if (games < PLACEMENT_GAMES) placement.push(p);
    else tiered.push(p);
  }
  return [...tiered, ...placement];
}

// Futuristic rank medal: faceted hex frame with metallic gradient,
// inset bevel, top highlight strip, and a bold display numeral.
// Sizes step down by rank so the podium hierarchy reads at a glance.
const MEDAL_PALETTES: Record<
  1 | 2 | 3,
  { from: string; mid: string; to: string; stroke: string; glow: string }
> = {
  1: {
    from: '#fff3b0',
    mid: '#facc15',
    to: '#a16207',
    stroke: '#5a3d05',
    glow: 'rgba(251, 191, 36, 0.65)',
  },
  2: {
    from: '#fafafa',
    mid: '#d4d4d8',
    to: '#52525b',
    stroke: '#3f3f46',
    glow: 'rgba(212, 212, 216, 0.55)',
  },
  3: {
    from: '#ffe4cc',
    mid: '#fb923c',
    to: '#7c2d12',
    stroke: '#5b1d08',
    glow: 'rgba(251, 146, 60, 0.55)',
  },
};
const MEDAL_PX: Record<1 | 2 | 3, number> = { 1: 44, 2: 38, 3: 36 };

function Medal({ rank }: { rank: 1 | 2 | 3 }) {
  const p = MEDAL_PALETTES[rank];
  const px = MEDAL_PX[rank];
  // Reserve a fixed-width slot so all leaderboard rows align even
  // when the medal SVG itself shrinks for #2/#3.
  const idBase = `medal-${rank}`;
  return (
    <div
      className="w-12 flex items-center justify-center shrink-0"
      style={{ height: 44 }}
      aria-label={`Rank ${rank}`}
    >
      <svg
        width={px}
        height={px}
        viewBox="0 0 48 48"
        style={{
          filter: `drop-shadow(0 0 6px ${p.glow})`,
          animation:
            rank === 1 ? 'pill-pulse 2.4s ease-in-out infinite' : undefined,
        }}
        aria-hidden
      >
        <defs>
          <linearGradient id={`${idBase}-frame`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={p.from} />
            <stop offset="55%" stopColor={p.mid} />
            <stop offset="100%" stopColor={p.to} />
          </linearGradient>
          <linearGradient id={`${idBase}-hi`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="white" stopOpacity="0.7" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Outer hex frame, pointy top/bottom */}
        <polygon
          points="24,3 41,13 41,35 24,45 7,35 7,13"
          fill={`url(#${idBase}-frame)`}
          stroke={p.stroke}
          strokeWidth="0.9"
        />
        {/* Inset bevel */}
        <polygon
          points="24,7 37.5,15 37.5,33 24,41 10.5,33 10.5,15"
          fill="none"
          stroke="rgba(0,0,0,0.30)"
          strokeWidth="0.6"
        />
        {/* Top highlight strip */}
        <polygon
          points="24,4.5 39.5,13.5 39.5,19 24,11 8.5,19 8.5,13.5"
          fill={`url(#${idBase}-hi)`}
        />
        {/* Side facet lines for the sci-fi vibe */}
        <line
          x1="7"
          y1="13"
          x2="11"
          y2="15.5"
          stroke="rgba(255,255,255,0.35)"
          strokeWidth="0.5"
        />
        <line
          x1="41"
          y1="13"
          x2="37"
          y2="15.5"
          stroke="rgba(0,0,0,0.30)"
          strokeWidth="0.5"
        />
        <line
          x1="7"
          y1="35"
          x2="11"
          y2="32.5"
          stroke="rgba(0,0,0,0.30)"
          strokeWidth="0.5"
        />
        <line
          x1="41"
          y1="35"
          x2="37"
          y2="32.5"
          stroke="rgba(255,255,255,0.20)"
          strokeWidth="0.5"
        />
        {/* Rank numeral. paintOrder: stroke draws the stroke first, then
            the fill on top — gives a clean outlined character. */}
        <text
          x="24"
          y="33"
          textAnchor="middle"
          fontFamily="'Orbitron', 'Rajdhani', system-ui, sans-serif"
          fontSize="22"
          fontWeight="900"
          fill="white"
          stroke="rgba(0, 0, 0, 0.85)"
          strokeWidth="2"
          strokeLinejoin="round"
          style={{
            paintOrder: 'stroke',
            letterSpacing: '0.5px',
          }}
        >
          {rank}
        </text>
      </svg>
    </div>
  );
}

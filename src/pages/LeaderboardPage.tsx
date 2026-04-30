import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { formatError } from '../lib/errors';
import type { Database } from '../lib/database.types';

type Tab = 'singles' | 'doubles';
type Profile = Database['public']['Tables']['profiles']['Row'];

export function LeaderboardPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('doubles');
  const [rows, setRows] = useState<Profile[] | null>(null);
  const [streaks, setStreaks] = useState<Map<string, { singles: number; doubles: number }>>(new Map());
  const [error, setError] = useState<string | null>(null);

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

      {rows === null ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-500">Loading…</p>
      ) : rows.length === 0 ? (
        <section className="glass-panel p-6 text-center">
          <div className="text-3xl mb-2 text-cyan2-400" aria-hidden>✦</div>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            No players yet. Once members sign up, rankings will appear here.
          </p>
        </section>
      ) : (
        <ol className="space-y-2">
          {rows.map((p, i) => {
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
              />
            );
          })}
        </ol>
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
}: {
  rank: number;
  profile: Profile;
  tab: Tab;
  isMe: boolean;
  streak: number;
}) {
  const rating = tab === 'singles' ? profile.singles_rating : profile.doubles_rating;
  const games = tab === 'singles' ? profile.singles_games_played : profile.doubles_games_played;
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null;

  return (
    <li
      className={`glass-panel p-3 flex items-center gap-3 ${
        isMe ? 'ring-1 ring-cyan2-400/60' : ''
      }`}
    >
      <div className="w-7 text-center font-display text-sm text-zinc-500 dark:text-zinc-400 shrink-0">
        {medal ?? `#${rank}`}
      </div>

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
            >
              {streak} wins
            </span>
          )}
          {isMe && <span className="text-[9px] tracking-widest ml-1">· you</span>}
        </div>
        <div className="text-[10px] text-zinc-500 dark:text-zinc-500 tracking-wider uppercase">
          {games} {games === 1 ? 'game' : 'games'}
        </div>
      </div>

      <div className="text-right shrink-0">
        <div className="font-display text-lg leading-none text-zinc-900 dark:text-zinc-100">
          {rating}
        </div>
        <div className="text-[9px] text-zinc-500 dark:text-zinc-500 tracking-widest uppercase mt-0.5">
          Rating
        </div>
      </div>
    </li>
  );
}

function Avatar({ profile, streak }: { profile: Profile; streak: number }) {
  const intense = streak >= 3;
  const showRing = streak >= 2;
  const showSparks = streak >= 4;
  const ringColor = intense ? '#f97316' : '#fbbf24';
  const sparkColor = ringColor;
  const boltCount = streak >= 5 ? 12 : 8;

  return (
    <div className="relative shrink-0 w-9 h-9">
      {showRing && (
        <span
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            border: `2px solid ${ringColor}`,
            boxShadow: `0 0 8px ${ringColor}`,
            animation: intense
              ? 'ring-grow 1.2s ease-in-out infinite'
              : 'ring-grow 2s ease-in-out infinite',
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


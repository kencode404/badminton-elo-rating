import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { formatError } from '../lib/errors';
import { TierBadge } from './TierBadge';
import { ratingStatus } from '../lib/tiers';
import { PastSeasonRow, type PastSeasonSnapshot } from './PastSeasonRow';
import type { Database, MatchType, Team } from '../lib/database.types';

type Profile = Database['public']['Tables']['profiles']['Row'];

interface RecentOther {
  user_id: string;
  display_name: string;
  team: Team;
}

interface RecentMatch {
  match_id: string;
  match_type: MatchType;
  played_at: string;
  user_team: Team;
  score_a: number;
  score_b: number;
  rating_delta: number | null;
  others: RecentOther[];
}

interface Props {
  userId: string;
  onClose: () => void;
}

export function ProfileDetailModal({ userId, onClose }: Props) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [winCounts, setWinCounts] = useState<{ singles: number; doubles: number } | null>(null);
  const [matches, setMatches] = useState<RecentMatch[] | null>(null);
  const [snapshots, setSnapshots] = useState<PastSeasonSnapshot[] | null>(null);
  const [historyTab, setHistoryTab] = useState<'matches' | 'seasons'>('matches');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setError(formatError(error));
        else setProfile(data);
      });

    supabase
      .rpc('get_user_win_counts', { p_user_id: userId })
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setError(formatError(error));
          return;
        }
        const row = (data ?? [])[0] as
          | { singles_wins: number; doubles_wins: number }
          | undefined;
        setWinCounts({
          singles: row?.singles_wins ?? 0,
          doubles: row?.doubles_wins ?? 0,
        });
      });

    supabase
      .rpc('get_recent_matches', { p_user_id: userId, p_limit: 5 })
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setError(formatError(error));
          return;
        }
        setMatches((data ?? []) as RecentMatch[]);
      });

    supabase
      .from('season_snapshots')
      .select(
        'season_number, archived_at, singles_rating, doubles_rating, singles_games_played, doubles_games_played, singles_wins, doubles_wins, singles_rank, doubles_rank',
      )
      .eq('user_id', userId)
      .order('season_number', { ascending: false })
      .limit(5)
      .then(({ data }) => {
        if (!active) return;
        setSnapshots((data ?? []) as PastSeasonSnapshot[]);
      });

    return () => {
      active = false;
    };
  }, [userId]);

  // Esc closes
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm p-4"
      style={{
        paddingTop: 'max(2rem, env(safe-area-inset-top))',
        paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
      }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Player details"
    >
      <div
        className="glass-panel w-full max-w-md flex flex-col rounded-2xl overflow-hidden"
        style={{
          maxHeight:
            'calc(100dvh - 3rem - env(safe-area-inset-top) - env(safe-area-inset-bottom))',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-200/60 dark:border-zinc-800/60">
          <div className="font-display text-[11px] uppercase tracking-widest text-zinc-700 dark:text-zinc-200">
            Player
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md w-7 h-7 flex items-center justify-center text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
          >
            ✕
          </button>
        </header>

        {error && (
          <div className="m-3 text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/40 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        {/* Identity */}
        <section className="p-4 flex items-center gap-3 border-b border-zinc-200/60 dark:border-zinc-800/60">
          <Avatar profile={profile} />
          <div className="flex-1 min-w-0">
            <div className="text-base text-zinc-900 dark:text-zinc-100 font-display tracking-wide truncate">
              {profile?.display_name ?? '—'}
            </div>
            <div className="text-[10px] text-zinc-500 dark:text-zinc-500 uppercase tracking-widest">
              Member since {profile?.created_at ? formatYearMonth(profile.created_at) : '—'}
            </div>
          </div>
        </section>

        {/* Per-mode stats */}
        <section className="p-4 grid grid-cols-2 gap-3 border-b border-zinc-200/60 dark:border-zinc-800/60">
          <ModeStat
            label="Doubles"
            rating={profile?.doubles_rating ?? null}
            games={profile?.doubles_games_played ?? 0}
            wins={winCounts?.doubles ?? null}
          />
          <ModeStat
            label="Singles"
            rating={profile?.singles_rating ?? null}
            games={profile?.singles_games_played ?? 0}
            wins={winCounts?.singles ?? null}
          />
        </section>

        {/* History — toggle between Last 5 Matches and Last 5 Seasons.
            Scrolls internally so the modal stays compact. */}
        <section className="px-4 pb-4 pt-3 flex flex-col min-h-0 flex-1">
          <div className="flex items-center gap-1 mb-2 shrink-0 p-0.5 rounded-md bg-zinc-100 dark:bg-zinc-900/60 border border-zinc-200/60 dark:border-zinc-800/60">
            {(['matches', 'seasons'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setHistoryTab(tab)}
                className={`flex-1 py-1.5 rounded text-[10px] font-display tracking-widest uppercase transition ${
                  historyTab === tab
                    ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                    : 'text-zinc-500 dark:text-zinc-400'
                }`}
              >
                {tab === 'matches' ? 'Last 5 Matches' : 'Last 5 Seasons'}
              </button>
            ))}
          </div>
          {historyTab === 'matches' ? (
            matches === null ? (
              <p className="text-xs text-zinc-500 dark:text-zinc-500">Loading…</p>
            ) : matches.length === 0 ? (
              <p className="text-xs text-zinc-500 dark:text-zinc-500">
                No confirmed matches yet.
              </p>
            ) : (
              <ul className="space-y-1.5 overflow-y-auto" style={{ maxHeight: '11rem' }}>
                {matches.map((m) => (
                  <RecentMatchRow key={m.match_id} match={m} />
                ))}
              </ul>
            )
          ) : snapshots === null ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-500">Loading…</p>
          ) : snapshots.length === 0 ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-500">
              No archived seasons yet.
            </p>
          ) : (
            <ul className="space-y-2 overflow-y-auto" style={{ maxHeight: '14rem' }}>
              {snapshots.map((s) => (
                <PastSeasonRow key={s.season_number} snapshot={s} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function ModeStat({
  label,
  rating,
  games,
  wins,
}: {
  label: string;
  rating: number | null;
  games: number;
  wins: number | null;
}) {
  const winRate = wins !== null && games > 0 ? Math.round((wins / games) * 100) : null;
  const status = rating !== null ? ratingStatus(rating, games) : null;
  const tintStyle: React.CSSProperties =
    status?.kind === 'tier'
      ? {
          borderColor: status.tier.rowBorder,
          background: `linear-gradient(135deg, ${status.tier.rowBg} 0%, transparent 60%)`,
        }
      : {};
  return (
    <div
      className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3"
      style={tintStyle}
    >
      <div className="text-[10px] font-display uppercase tracking-wider text-cyan2-500 dark:text-cyan2-300">
        {label}
      </div>
      <div className="font-display text-2xl mt-1 text-zinc-900 dark:text-zinc-100">
        {rating ?? '—'}
      </div>
      {status && (
        <div className="mt-1">
          <TierBadge status={status} size={18} showName />
        </div>
      )}
      <div className="text-[10px] text-zinc-500 dark:text-zinc-500 mt-1 uppercase tracking-wider">
        {games} games
      </div>
      <div className="text-[10px] text-zinc-700 dark:text-zinc-300 mt-0.5 font-display tracking-wider">
        {winRate !== null ? `${wins} wins · ${winRate}%` : '—'}
      </div>
    </div>
  );
}

function RecentMatchRow({ match }: { match: RecentMatch }) {
  const myScore = match.user_team === 'A' ? match.score_a : match.score_b;
  const oppScore = match.user_team === 'A' ? match.score_b : match.score_a;
  const won = myScore > oppScore;

  const partners = match.others.filter((o) => o.team === match.user_team);
  const opponents = match.others.filter((o) => o.team !== match.user_team);
  const oppLabel = opponents.map((o) => o.display_name).join(' & ') || '—';
  const partnerLabel = partners.map((p) => p.display_name).join(' & ');

  return (
    <li className="flex items-center justify-between gap-3 text-xs rounded-md bg-zinc-50 dark:bg-zinc-900/60 px-2.5 py-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 text-[10px] font-display uppercase tracking-widest text-cyan2-500 dark:text-cyan2-300">
          <span>{match.match_type}</span>
          <span className="text-zinc-400 dark:text-zinc-600">·</span>
          <span className="text-zinc-500 dark:text-zinc-500">
            {formatDate(match.played_at)}
          </span>
        </div>
        <div className="text-zinc-900 dark:text-zinc-100 truncate mt-0.5">
          {partnerLabel && (
            <span className="text-zinc-500 dark:text-zinc-500">w/ {partnerLabel} </span>
          )}
          vs <span className="font-semibold">{oppLabel}</span>
        </div>
      </div>
      <div className="text-right shrink-0">
        <div
          className={`font-display tracking-wider text-sm ${
            won ? 'text-emerald-500' : 'text-red-400'
          }`}
        >
          {myScore}–{oppScore}
        </div>
        {match.rating_delta !== null && (
          <div
            className={`text-[10px] font-display tracking-wider ${
              match.rating_delta > 0
                ? 'text-emerald-500'
                : match.rating_delta < 0
                  ? 'text-red-400'
                  : 'text-zinc-500'
            }`}
          >
            {match.rating_delta > 0 ? '+' : ''}
            {match.rating_delta}
          </div>
        )}
      </div>
    </li>
  );
}

function Avatar({ profile }: { profile: Profile | null }) {
  if (profile?.avatar_url) {
    return (
      <img
        src={profile.avatar_url}
        alt=""
        className="w-12 h-12 rounded-full object-cover border border-zinc-200 dark:border-zinc-700 shrink-0"
      />
    );
  }
  return (
    <div className="w-12 h-12 rounded-full bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 flex items-center justify-center font-semibold shrink-0">
      {profile?.display_name?.[0]?.toUpperCase() ?? '?'}
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

function formatYearMonth(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

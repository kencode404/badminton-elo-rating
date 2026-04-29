import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { getMyMatches, type MatchSummary } from '../lib/matches';
import type { MatchStatus } from '../lib/database.types';

export function RecordMatchPage() {
  const { user } = useAuth();
  const [matches, setMatches] = useState<MatchSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const data = await getMyMatches(user.id);
      setMatches(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load matches');
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="p-4 space-y-4">
      <div className="section-title text-base">Match History</div>

      {error && (
        <div className="text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/40 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {matches === null ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-500">Loading…</p>
      ) : matches.length === 0 ? (
        <section className="glass-panel p-6 text-center">
          <div className="text-3xl mb-2 text-cyan2-400" aria-hidden>◈</div>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            No matches yet. Tap the + button to record your first one.
          </p>
        </section>
      ) : (
        <div className="space-y-2">
          {matches.map((m) => (
            <MatchRow key={m.match.id} summary={m} />
          ))}
        </div>
      )}

      <Link
        to="/record/new"
        aria-label="Record new match"
        className="fixed right-5 z-20 w-14 h-14 rounded-full flex items-center justify-center text-white text-2xl border border-cyan2-400/60 active:scale-95 transition"
        style={{
          bottom: 'calc(5.5rem + env(safe-area-inset-bottom))',
          background: 'linear-gradient(135deg, #18181b 0%, #27272a 100%)',
          boxShadow: '0 0 22px rgba(34, 211, 238, 0.55)',
        }}
      >
        +
      </Link>
    </div>
  );
}

function MatchRow({ summary }: { summary: MatchSummary }) {
  const { match, myTeam, myConfirmation, myRatingDelta, participants } = summary;
  const teamA = participants.filter((p) => p.team === 'A');
  const teamB = participants.filter((p) => p.team === 'B');
  const myScore = myTeam === 'A' ? match.score_a : match.score_b;
  const oppScore = myTeam === 'A' ? match.score_b : match.score_a;
  const isWin = match.status === 'confirmed' && myScore > oppScore;
  const isLoss = match.status === 'confirmed' && myScore < oppScore;

  return (
    <article className="glass-panel p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-display uppercase tracking-widest text-cyan2-500 dark:text-cyan2-300">
            {match.match_type}
          </span>
          <StatusPill status={match.status} myConfirmation={myConfirmation} />
        </div>
        <span className="text-[10px] text-zinc-500 dark:text-zinc-500 tracking-wider">
          {formatDate(match.played_at)}
        </span>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <TeamCol players={teamA} mine={myTeam === 'A'} />
        <div className="text-center">
          <div className="font-display text-2xl text-zinc-900 dark:text-zinc-100 leading-none whitespace-nowrap">
            {match.score_a}
            <span className="text-zinc-400 dark:text-zinc-600 mx-1">:</span>
            {match.score_b}
          </div>
        </div>
        <TeamCol players={teamB} mine={myTeam === 'B'} alignRight />
      </div>

      {(isWin || isLoss || (myRatingDelta !== null && match.status === 'confirmed')) && (
        <div className="mt-2 flex items-center justify-between text-[11px]">
          <span
            className={
              isWin
                ? 'text-emerald-500 font-display uppercase tracking-widest'
                : isLoss
                  ? 'text-red-400 font-display uppercase tracking-widest'
                  : 'text-zinc-500 dark:text-zinc-500'
            }
          >
            {isWin ? 'Win' : isLoss ? 'Loss' : ''}
          </span>
          {myRatingDelta !== null && match.status === 'confirmed' && (
            <span
              className={`font-display tracking-wider ${
                myRatingDelta > 0
                  ? 'text-emerald-500'
                  : myRatingDelta < 0
                    ? 'text-red-400'
                    : 'text-zinc-500'
              }`}
            >
              {myRatingDelta > 0 ? '+' : ''}
              {myRatingDelta}
            </span>
          )}
        </div>
      )}
    </article>
  );
}

function StatusPill({
  status,
  myConfirmation,
}: {
  status: MatchStatus;
  myConfirmation: 'pending' | 'accepted' | 'rejected';
}) {
  const label =
    status === 'pending' && myConfirmation === 'pending'
      ? 'awaiting you'
      : status === 'pending'
        ? 'awaiting others'
        : status;
  const color =
    status === 'confirmed'
      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30'
      : status === 'rejected'
        ? 'bg-red-500/15 text-red-500 dark:text-red-300 border-red-500/30'
        : status === 'expired'
          ? 'bg-zinc-500/15 text-zinc-500 dark:text-zinc-400 border-zinc-500/30'
          : myConfirmation === 'pending'
            ? 'bg-cyan2-400/15 text-cyan2-600 dark:text-cyan2-300 border-cyan2-400/40'
            : 'bg-zinc-500/15 text-zinc-500 dark:text-zinc-400 border-zinc-500/30';

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-display uppercase tracking-widest border ${color}`}
    >
      {label}
    </span>
  );
}

function TeamCol({
  players,
  mine,
  alignRight = false,
}: {
  players: { user_id: string; profile: { display_name: string; avatar_url: string | null } }[];
  mine: boolean;
  alignRight?: boolean;
}) {
  return (
    <div className={alignRight ? 'text-right' : ''}>
      {mine && (
        <div className="text-[9px] font-display uppercase tracking-widest text-cyan2-500 dark:text-cyan2-300 mb-0.5">
          You
        </div>
      )}
      <div className="space-y-0.5">
        {players.map((p) => (
          <div
            key={p.user_id}
            className="text-xs text-zinc-900 dark:text-zinc-100 truncate"
            title={p.profile.display_name}
          >
            {p.profile.display_name}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

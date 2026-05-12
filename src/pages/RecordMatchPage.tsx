import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { getMyMatches, respondToMatch, type MatchSummary } from '../lib/matches';
import { formatError } from '../lib/errors';
import type { MatchStatus } from '../lib/database.types';

export function RecordMatchPage() {
  const { user } = useAuth();
  const [matches, setMatches] = useState<MatchSummary[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const data = await getMyMatches(user.id);
      setMatches(data);
    } catch (err) {
      setError(formatError(err));
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  async function respond(matchId: string, decision: 'accepted' | 'rejected') {
    if (!user) return;
    setBusyId(matchId);
    setError(null);
    try {
      await respondToMatch(matchId, user.id, decision);
      await load();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusyId(null);
    }
  }

  const invitations =
    matches?.filter(
      (m) => m.match.status === 'pending' && m.myConfirmation === 'pending',
    ) ?? [];
  const pending =
    matches?.filter(
      (m) => m.match.status === 'pending' && m.myConfirmation === 'accepted',
    ) ?? [];
  const history = matches?.filter((m) => m.match.status !== 'pending') ?? [];

  return (
    <div className="p-4 space-y-5">
      {error && (
        <div className="text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/40 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {matches === null ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-500">Loading…</p>
      ) : (
        <>
          {invitations.length > 0 && (
            <section className="space-y-2">
              <div className="section-title">Awaiting Your Response</div>
              {invitations.map((m) => (
                <InvitationCard
                  key={m.match.id}
                  summary={m}
                  busy={busyId === m.match.id}
                  onRespond={respond}
                />
              ))}
            </section>
          )}

          {pending.length > 0 && (
            <section className="space-y-2">
              <div className="section-title">Pending Matches</div>
              {pending.map((m) => {
                // Edit allowed only when I'm the creator AND nobody
                // else has accepted yet (matches the server-side guard
                // in update_pending_match).
                const isMine = m.match.created_by === user?.id;
                const noOneElseAccepted = !m.participants.some(
                  (p) => p.user_id !== user?.id && p.confirmation === 'accepted',
                );
                const editHref =
                  isMine && noOneElseAccepted
                    ? `/record/${m.match.id}/edit`
                    : undefined;
                return (
                  <MatchRow key={m.match.id} summary={m} editHref={editHref} />
                );
              })}
            </section>
          )}

          <section className="space-y-2">
            <div className="section-title">Match History</div>
            {history.length === 0 ? (
              <div className="glass-panel p-6 text-center">
                <div className="text-3xl mb-2 text-cyan2-400" aria-hidden>◈</div>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  No settled matches yet. Tap the SMASH button to record one.
                </p>
              </div>
            ) : (
              history.map((m) => <MatchRow key={m.match.id} summary={m} />)
            )}
          </section>
        </>
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

function InvitationCard({
  summary,
  busy,
  onRespond,
}: {
  summary: MatchSummary;
  busy: boolean;
  onRespond: (matchId: string, decision: 'accepted' | 'rejected') => void;
}) {
  const { match, myTeam, participants } = summary;
  const teamA = participants.filter((p) => p.team === 'A');
  const teamB = participants.filter((p) => p.team === 'B');
  const myScore = myTeam === 'A' ? match.score_a : match.score_b;
  const oppScore = myTeam === 'A' ? match.score_b : match.score_a;
  const claimedWin = myScore > oppScore;

  return (
    <article
      className="glass-panel p-4 space-y-3 ring-1 ring-cyan2-400/40"
      style={{ boxShadow: '0 0 0 1px rgba(34,211,238,0.1), 0 6px 18px -6px rgba(34,211,238,0.25)' }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-display uppercase tracking-widest text-cyan2-500 dark:text-cyan2-300">
          {match.match_type}
        </span>
        <span
          className={`text-[10px] font-display uppercase tracking-widest ${
            claimedWin ? 'text-emerald-500' : 'text-red-400'
          }`}
        >
          {claimedWin ? 'win' : 'loss'} (your team)
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

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={() => onRespond(match.id, 'rejected')}
          disabled={busy}
          className="cosmic-button-ghost flex-1 text-xs"
        >
          Reject
        </button>
        <button
          type="button"
          onClick={() => onRespond(match.id, 'accepted')}
          disabled={busy}
          className="cosmic-button flex-1 text-xs"
        >
          {busy ? 'Saving…' : 'Accept'}
        </button>
      </div>
    </article>
  );
}

function MatchRow({
  summary,
  editHref,
}: {
  summary: MatchSummary;
  editHref?: string;
}) {
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
        <div className="flex items-center gap-2">
          {editHref && (
            <Link
              to={editHref}
              className="text-[10px] font-display uppercase tracking-widest px-2 py-0.5 rounded border border-cyan2-400/40 text-cyan2-500 dark:text-cyan2-300 hover:bg-cyan2-500/10 transition"
            >
              ✎ Edit
            </Link>
          )}
          <span className="text-[10px] text-zinc-500 dark:text-zinc-500 tracking-wider">
            {formatDate(match.played_at)}
          </span>
        </div>
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
  players: {
    user_id: string;
    confirmation: 'pending' | 'accepted' | 'rejected';
    profile: { display_name: string; avatar_url: string | null };
  }[];
  mine: boolean;
  alignRight?: boolean;
}) {
  return (
    <div className={alignRight ? 'text-right' : ''}>
      <div
        className={`text-[9px] font-display uppercase tracking-widest mb-0.5 ${
          mine
            ? 'text-cyan2-500 dark:text-cyan2-300'
            : 'text-zinc-500 dark:text-zinc-500'
        }`}
      >
        {mine ? 'Your Team' : 'Opponent'}
      </div>
      <div className="space-y-0.5">
        {players.map((p) => (
          <div
            key={p.user_id}
            className={`flex items-center gap-1.5 ${alignRight ? 'flex-row-reverse' : ''}`}
            title={`${p.profile.display_name} — ${p.confirmation}`}
          >
            <ConfirmationDot confirmation={p.confirmation} />
            <span className="text-xs text-zinc-900 dark:text-zinc-100 truncate">
              {p.profile.display_name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConfirmationDot({
  confirmation,
}: {
  confirmation: 'pending' | 'accepted' | 'rejected';
}) {
  if (confirmation === 'accepted') {
    return (
      <span
        aria-label="accepted"
        className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-500 shrink-0"
      >
        <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M2 6.5 L5 9.5 L10 3.5" />
        </svg>
      </span>
    );
  }
  if (confirmation === 'rejected') {
    return (
      <span
        aria-label="rejected"
        className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-red-500/20 text-red-500 shrink-0"
      >
        <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
          <path d="M3 3 L9 9 M9 3 L3 9" />
        </svg>
      </span>
    );
  }
  return (
    <span
      aria-label="pending"
      className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-zinc-400 dark:border-zinc-600 shrink-0"
    />
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

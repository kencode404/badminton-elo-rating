import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { getPendingForUser, respondToMatch, type PendingMatchSummary } from '../lib/matches';
import { formatError } from '../lib/errors';
import type { Database } from '../lib/database.types';

type Profile = Database['public']['Tables']['profiles']['Row'];

export function HomePage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [pending, setPending] = useState<PendingMatchSummary[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadPending = useCallback(async () => {
    if (!user) return;
    try {
      const list = await getPendingForUser(user.id);
      setPending(list);
    } catch (err) {
      setError(formatError(err));
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setProfile(data);
      });
    loadPending();
    return () => {
      active = false;
    };
  }, [user, loadPending]);

  async function respond(matchId: string, decision: 'accepted' | 'rejected') {
    if (!user) return;
    setBusyId(matchId);
    setError(null);
    try {
      await respondToMatch(matchId, user.id, decision);
      await loadPending();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="p-4 space-y-4">
      <section className="glass-panel p-5 relative overflow-hidden">
        <div className="absolute -top-6 -right-6 text-7xl opacity-5 dark:opacity-10 select-none" aria-hidden>
          ◆
        </div>
        <h2 className="font-display tracking-[0.15em] text-base text-zinc-900 dark:text-zinc-100 mb-1">
          WELCOME, COMMANDER
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
          Track your singles & doubles ratings. Record matches, await all-player
          confirmation, and ascend the leaderboard.
        </p>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <div className="glass-panel p-4 panel-stripe pl-6">
          <div className="text-[10px] font-display uppercase tracking-wider text-cyan2-500 dark:text-cyan2-300">
            Doubles
          </div>
          <div className="font-display text-3xl mt-1 text-zinc-900 dark:text-zinc-100">
            {profile?.doubles_rating ?? '—'}
          </div>
          <div className="text-[10px] text-zinc-500 dark:text-zinc-500 mt-1 tracking-wider uppercase">
            Rating
          </div>
        </div>
        <div className="glass-panel p-4 panel-stripe pl-6">
          <div className="text-[10px] font-display uppercase tracking-wider text-cyan2-500 dark:text-cyan2-300">
            Singles
          </div>
          <div className="font-display text-3xl mt-1 text-zinc-900 dark:text-zinc-100">
            {profile?.singles_rating ?? '—'}
          </div>
          <div className="text-[10px] text-zinc-500 dark:text-zinc-500 mt-1 tracking-wider uppercase">
            Rating
          </div>
        </div>
      </section>

      {pending.length > 0 && (
        <section className="space-y-2">
          <div className="section-title">Pending Confirmations</div>
          {pending.map(({ match, myTeam, participants }) => {
            const teamA = participants.filter((p) => p.team === 'A');
            const teamB = participants.filter((p) => p.team === 'B');
            const iWon =
              (myTeam === 'A' && match.score_a > match.score_b) ||
              (myTeam === 'B' && match.score_b > match.score_a);
            return (
              <article
                key={match.id}
                className="glass-panel p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-display uppercase tracking-widest text-cyan2-500 dark:text-cyan2-300">
                    {match.match_type}
                  </span>
                  <span
                    className={`text-[10px] font-display uppercase tracking-widest ${
                      iWon ? 'text-emerald-500' : 'text-red-400'
                    }`}
                  >
                    {iWon ? 'win' : 'loss'} (your team)
                  </span>
                </div>
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                  <TeamColumn label="Team A" players={teamA} mine={myTeam === 'A'} />
                  <div className="text-center">
                    <div className="font-display text-2xl text-zinc-900 dark:text-zinc-100 leading-none">
                      {match.score_a}
                      <span className="text-zinc-400 dark:text-zinc-600 mx-1">:</span>
                      {match.score_b}
                    </div>
                    <div className="text-[9px] text-zinc-500 dark:text-zinc-500 mt-1 tracking-widest uppercase">
                      Score
                    </div>
                  </div>
                  <TeamColumn label="Team B" players={teamB} mine={myTeam === 'B'} alignRight />
                </div>
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => respond(match.id, 'rejected')}
                    disabled={busyId === match.id}
                    className="cosmic-button-ghost flex-1 text-xs"
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    onClick={() => respond(match.id, 'accepted')}
                    disabled={busyId === match.id}
                    className="cosmic-button flex-1 text-xs"
                  >
                    {busyId === match.id ? 'Saving…' : 'Accept'}
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {error && (
        <div className="text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/40 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      <section className="glass-panel p-5">
        <div className="section-title mb-4">Quick Action</div>
        <div className="grid grid-cols-2 gap-3">
          <Link to="/record" className="cosmic-button text-sm">
            <span aria-hidden>◈</span> Record
          </Link>
          <Link to="/leaderboard" className="cosmic-button-ghost text-sm">
            <span aria-hidden>✦</span> Ranks
          </Link>
        </div>
      </section>
    </div>
  );
}

function TeamColumn({
  label,
  players,
  mine,
  alignRight = false,
}: {
  label: string;
  players: { user_id: string; profile: { display_name: string; avatar_url: string | null } }[];
  mine: boolean;
  alignRight?: boolean;
}) {
  return (
    <div className={alignRight ? 'text-right' : ''}>
      <div className="text-[9px] font-display uppercase tracking-widest text-zinc-500 dark:text-zinc-500 mb-1">
        {label}
        {mine && <span className="text-cyan2-500 dark:text-cyan2-300"> · you</span>}
      </div>
      <div className="space-y-1">
        {players.map((p) => (
          <div
            key={p.user_id}
            className={`text-xs text-zinc-900 dark:text-zinc-100 truncate ${
              alignRight ? 'text-right' : ''
            }`}
            title={p.profile.display_name}
          >
            {p.profile.display_name}
          </div>
        ))}
      </div>
    </div>
  );
}

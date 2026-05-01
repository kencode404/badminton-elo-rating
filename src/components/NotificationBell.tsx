import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { getPendingForUser, type PendingMatchSummary } from '../lib/matches';
import { formatError } from '../lib/errors';

// Notification bell.
// - Realtime subscription on match_participants drives the badge count.
// - Click opens a popover with the user's pending match invitations.
// - Tapping an item closes the popover and navigates to /record.

export function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<PendingMatchSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  // Live count via realtime
  useEffect(() => {
    if (!user) return;
    let active = true;

    async function refresh() {
      // Inner-join matches so we only count pending participants on
      // matches that are still themselves pending. Otherwise rows
      // orphaned by a rejection / expiry inflate the badge while the
      // popover (which joins to matches.status='pending') stays empty.
      const { count } = await supabase
        .from('match_participants')
        .select('*, matches!inner(status)', { count: 'exact', head: true })
        .eq('user_id', user!.id)
        .eq('confirmation', 'pending')
        .eq('matches.status', 'pending');
      if (active) setCount(count ?? 0);
    }

    refresh();

    const channel = supabase
      .channel(`mp-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'match_participants',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          refresh();
        },
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [user]);

  // Fetch the actual notification list when the popover opens
  useEffect(() => {
    if (!open || !user) return;
    let active = true;
    setItems(null);
    setError(null);
    getPendingForUser(user.id)
      .then((list) => {
        if (active) setItems(list);
      })
      .catch((err) => {
        if (active) setError(formatError(err));
      });
    return () => {
      active = false;
    };
  }, [open, user]);

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function gotoMatchTab() {
    setOpen(false);
    navigate('/record');
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications, ${count} pending`}
        aria-expanded={open}
        className="relative rounded-lg w-9 h-9 flex items-center justify-center bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 hover:border-cyan2-400 transition active:scale-90"
      >
        <BellIcon />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-cyan2-400 text-zinc-900 text-[10px] flex items-center justify-center font-bold">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-1.5rem)] glass-panel z-50 overflow-hidden"
          role="dialog"
          aria-label="Notifications"
        >
          <div className="px-3 py-2.5 border-b border-zinc-200/60 dark:border-zinc-800/60 flex items-center justify-between">
            <div className="font-display text-[11px] uppercase tracking-widest text-zinc-700 dark:text-zinc-200">
              Notifications
            </div>
            {count > 0 && (
              <span className="text-[10px] font-display uppercase tracking-widest text-cyan2-500 dark:text-cyan2-300">
                {count} pending
              </span>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {error && (
              <div className="p-3 text-xs text-red-500 dark:text-red-400">{error}</div>
            )}
            {items === null && !error ? (
              <div className="p-4 text-center text-xs text-zinc-500 dark:text-zinc-500">
                Loading…
              </div>
            ) : items && items.length === 0 ? (
              <div className="px-3 py-6 text-center">
                <div className="text-2xl mb-2 text-zinc-300 dark:text-zinc-700" aria-hidden>
                  ◇
                </div>
                <div className="text-xs text-zinc-500 dark:text-zinc-500">
                  You're all caught up.
                </div>
              </div>
            ) : (
              items?.map((m) => (
                <NotificationItem key={m.match.id} summary={m} onClick={gotoMatchTab} />
              ))
            )}
          </div>

          {items && items.length > 0 && (
            <button
              type="button"
              onClick={gotoMatchTab}
              className="w-full px-3 py-2.5 text-[10px] font-display uppercase tracking-widest text-cyan2-500 dark:text-cyan2-300 border-t border-zinc-200/60 dark:border-zinc-800/60 hover:bg-cyan2-50 dark:hover:bg-cyan2-500/10 transition"
            >
              Open Match tab →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function NotificationItem({
  summary,
  onClick,
}: {
  summary: PendingMatchSummary;
  onClick: () => void;
}) {
  const { match, myTeam, participants } = summary;
  const others = participants.filter((p) => p.team !== myTeam);
  const opponentNames = others
    .map((p) => p.profile.display_name)
    .join(', ');
  const myScore = myTeam === 'A' ? match.score_a : match.score_b;
  const oppScore = myTeam === 'A' ? match.score_b : match.score_a;
  const claimedWin = myScore > oppScore;

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left px-3 py-2.5 border-b border-zinc-200/60 dark:border-zinc-800/60 last:border-b-0 hover:bg-cyan2-50 dark:hover:bg-cyan2-500/10 transition"
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-display uppercase tracking-widest text-cyan2-500 dark:text-cyan2-300">
          Match Invitation
        </span>
        <span className="text-[10px] text-zinc-500 dark:text-zinc-500">
          {formatRelative(match.played_at)}
        </span>
      </div>
      <div className="text-xs text-zinc-900 dark:text-zinc-100">
        <span className="capitalize">{match.match_type}</span> vs{' '}
        <span className="font-semibold">{opponentNames || 'opponents'}</span>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <span className="font-display text-sm text-zinc-900 dark:text-zinc-100">
          {match.score_a}
          <span className="text-zinc-400 dark:text-zinc-600 mx-1">:</span>
          {match.score_b}
        </span>
        <span
          className={`text-[10px] font-display uppercase tracking-widest ${
            claimedWin ? 'text-emerald-500' : 'text-red-400'
          }`}
        >
          {claimedWin ? 'win' : 'loss'} (your team)
        </span>
      </div>
    </button>
  );
}

function BellIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-zinc-700 dark:text-zinc-200"
      aria-hidden
    >
      <path d="M6 8a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </svg>
  );
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { markChatSeen } from '../lib/chat';
import type { Database, MatchType } from '../lib/database.types';

interface AnnouncementRow {
  id: string;
  user_id: string;
  match_type: MatchType;
  streak_count: number;
  created_at: string;
  display_name: string;
  avatar_url: string | null;
}

export function HomePage() {
  const { user } = useAuth();
  const [announcements, setAnnouncements] = useState<AnnouncementRow[] | null>(null);

  // Mark chat as seen for the current user (clears the home-button badge).
  useEffect(() => {
    if (user) markChatSeen(user.id);
  }, [user]);

  useEffect(() => {
    let active = true;
    supabase
      .from('chat_messages')
      .select('id, user_id, match_type, streak_count, created_at, profiles:user_id(display_name, avatar_url)')
      .eq('kind', 'system_streak')
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (!active) return;
        type Joined = {
          id: string;
          user_id: string;
          match_type: MatchType;
          streak_count: number;
          created_at: string;
          profiles: Pick<
            Database['public']['Tables']['profiles']['Row'],
            'display_name' | 'avatar_url'
          > | null;
        };
        const flattened = ((data ?? []) as unknown as Joined[]).map((r) => ({
          id: r.id,
          user_id: r.user_id,
          match_type: r.match_type,
          streak_count: r.streak_count,
          created_at: r.created_at,
          display_name: r.profiles?.display_name ?? 'Player',
          avatar_url: r.profiles?.avatar_url ?? null,
        }));
        setAnnouncements(flattened);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="p-4 space-y-4">
      <section className="glass-panel p-5 relative overflow-hidden">
        <div className="absolute -top-6 -right-6 text-7xl opacity-5 dark:opacity-10 select-none" aria-hidden>
          ◆
        </div>
        <h2 className="font-display tracking-[0.15em] text-base text-zinc-900 dark:text-zinc-100 mb-1">
          WELCOME, PLAYER
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
          Track your singles & doubles ratings. Record matches, await all-player
          confirmation, and ascend the leaderboard.
        </p>
      </section>

      <section className="glass-panel overflow-hidden">
        <header className="flex items-center justify-between px-3 py-2 border-b border-zinc-200/60 dark:border-zinc-800/60">
          <div className="flex items-center gap-2">
            <span className="text-cyan2-500 dark:text-cyan2-300 text-base" aria-hidden>
              💬
            </span>
            <span className="font-display text-[11px] uppercase tracking-widest text-zinc-700 dark:text-zinc-200">
              Club Chat
            </span>
          </div>
          <span className="text-[9px] uppercase tracking-widest font-display text-zinc-400 dark:text-zinc-600">
            beta · system only
          </span>
        </header>

        <ul className="space-y-2 max-h-80 overflow-y-auto px-3 py-3">
          {announcements && announcements.length > 0 ? (
            announcements.map((a) => <SystemAnnouncement key={a.id} a={a} />)
          ) : (
            <li className="text-center text-[11px] text-zinc-500 dark:text-zinc-500 py-6">
              No streaks right now — be the first to start one.
            </li>
          )}
        </ul>

        <footer className="border-t border-zinc-200/60 dark:border-zinc-800/60 px-3 py-2">
          <div
            className="w-full px-3 py-2 rounded-lg text-xs text-zinc-400 dark:text-zinc-600 bg-zinc-100/70 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 select-none cursor-not-allowed"
            aria-disabled
          >
            Chat coming soon…
          </div>
        </footer>
      </section>
    </div>
  );
}

// System (bot) announcement message — centred chat style, distinct
// from future user messages.
function SystemAnnouncement({ a }: { a: AnnouncementRow }) {
  const challenge = a.streak_count >= 3;
  const message = challenge
    ? `${a.display_name} won ${a.streak_count} ${a.match_type} matches in a row 🔥 Who can beat them?`
    : `${a.display_name} won 2 ${a.match_type} matches in a row 🔥`;
  const accent = challenge
    ? 'text-orange-500 dark:text-orange-400'
    : 'text-amber-500 dark:text-amber-400';

  return (
    <li className="flex justify-start">
      <div className="max-w-[88%] flex flex-col items-start gap-0.5">
        <div className={`text-[9px] font-display uppercase tracking-widest ${accent}`}>
          System · {formatRelative(a.created_at)}
        </div>
        <div
          className={`rounded-2xl rounded-bl-md px-3 py-1.5 text-[12px] leading-snug ${
            challenge
              ? 'bg-orange-500/10 dark:bg-orange-500/15 text-zinc-800 dark:text-zinc-100'
              : 'bg-amber-500/10 dark:bg-amber-500/15 text-zinc-800 dark:text-zinc-100'
          }`}
        >
          {message}
        </div>
      </div>
    </li>
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
  if (day < 30) return `${day}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
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
  const [announcements, setAnnouncements] = useState<AnnouncementRow[] | null>(null);

  useEffect(() => {
    let active = true;
    supabase
      .from('streak_announcements')
      .select('id, user_id, match_type, streak_count, created_at, profiles:user_id(display_name, avatar_url)')
      .gt('expires_at', new Date().toISOString())
      .order('streak_count', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(20)
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

      {announcements && announcements.length > 0 && (
        <section className="glass-panel p-3">
          <div className="section-title px-1 pb-2 text-[11px]">Streak Feed</div>
          <ul className="space-y-1 max-h-72 overflow-y-auto pr-1">
            {announcements.map((a) => (
              <AnnouncementItem key={a.id} a={a} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function AnnouncementItem({ a }: { a: AnnouncementRow }) {
  const challenge = a.streak_count >= 3;
  const message = challenge
    ? `${a.streak_count}-match ${a.match_type} streak 🔥 who's gonna stop them?`
    : `2-match ${a.match_type} streak — nice 🔥`;

  return (
    <li className="flex items-start gap-2 px-1 py-1.5">
      <Avatar
        avatarUrl={a.avatar_url}
        displayName={a.display_name}
        intense={challenge}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5">
          <span className="text-xs font-display tracking-wider text-zinc-900 dark:text-zinc-100 truncate">
            {a.display_name}
          </span>
          <span className="text-[9px] uppercase tracking-widest text-zinc-400 dark:text-zinc-600 shrink-0">
            {formatRelative(a.created_at)}
          </span>
        </div>
        <div
          className={`text-[12px] leading-snug mt-0.5 ${
            challenge
              ? 'text-zinc-800 dark:text-zinc-200'
              : 'text-zinc-700 dark:text-zinc-300'
          }`}
        >
          {message}
        </div>
      </div>
    </li>
  );
}

function Avatar({
  avatarUrl,
  displayName,
  intense,
}: {
  avatarUrl: string | null;
  displayName: string;
  intense: boolean;
}) {
  const ringColor = intense ? '#f97316' : '#fbbf24';
  return (
    <div className="relative shrink-0 w-7 h-7 mt-0.5">
      <span
        className="absolute inset-0 rounded-full pointer-events-none"
        style={{
          border: `1.5px solid ${ringColor}`,
          boxShadow: `0 0 4px ${ringColor}`,
        }}
        aria-hidden
      />
      <div className="relative z-10 w-7 h-7">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            className="w-7 h-7 rounded-full object-cover border border-zinc-200 dark:border-zinc-700"
          />
        ) : (
          <div className="w-7 h-7 rounded-full bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 flex items-center justify-center text-[11px] font-semibold">
            {displayName?.[0]?.toUpperCase() ?? '?'}
          </div>
        )}
      </div>
    </div>
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

import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';

type Profile = Database['public']['Tables']['profiles']['Row'];

export function ProfilePage() {
  const { user, signOut } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true);
    supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setError(error.message);
        else setProfile(data);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user]);

  const displayName =
    profile?.display_name ??
    (user?.user_metadata?.display_name as string | undefined) ??
    user?.email?.split('@')[0] ??
    'Player';

  return (
    <div className="p-4 space-y-4">
      <section className="glass-panel p-6 text-center relative overflow-hidden">
        <div
          className="mx-auto w-20 h-20 rounded-2xl flex items-center justify-center text-3xl text-white border border-cyan2-400/40"
          style={{
            background: 'linear-gradient(135deg, #18181b 0%, #27272a 100%)',
            boxShadow: '0 0 18px rgba(34, 211, 238, 0.4)',
          }}
        >
          ◆
        </div>
        <h2 className="font-display tracking-[0.2em] text-base text-zinc-900 dark:text-zinc-100 mt-4 uppercase">
          {displayName}
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-1">{user?.email}</p>
      </section>

      <section className="glass-panel p-5">
        <div className="section-title mb-3">Ratings</div>
        {loading ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-500">Loading…</p>
        ) : error ? (
          <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
        ) : profile ? (
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Singles" rating={profile.singles_rating} games={profile.singles_games_played} />
            <Stat label="Doubles" rating={profile.doubles_rating} games={profile.doubles_games_played} />
          </div>
        ) : (
          <p className="text-sm text-zinc-500 dark:text-zinc-500">
            No profile found. Run the database migration if you haven't yet.
          </p>
        )}
      </section>

      <section className="glass-panel p-5">
        <div className="section-title mb-3">Match History</div>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Past matches and rating changes will appear here.
        </p>
      </section>

      <button
        type="button"
        onClick={() => signOut()}
        className="cosmic-button-ghost w-full text-sm"
      >
        Sign out
      </button>
    </div>
  );
}

function Stat({ label, rating, games }: { label: string; rating: number; games: number }) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
      <div className="text-[10px] font-display uppercase tracking-wider text-cyan2-500 dark:text-cyan2-300">
        {label}
      </div>
      <div className="font-display text-2xl mt-1 text-zinc-900 dark:text-zinc-100">{rating}</div>
      <div className="text-[10px] text-zinc-500 dark:text-zinc-500 mt-0.5 uppercase tracking-wider">
        {games} games
      </div>
    </div>
  );
}

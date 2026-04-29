import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';

// Pending-confirmation notification bell.
// Subscribes via Supabase Realtime to match_participants for the current user
// so the badge stays live without polling.

export function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!user) return;

    let active = true;

    async function refresh() {
      const { count } = await supabase
        .from('match_participants')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user!.id)
        .eq('confirmation', 'pending');
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

  return (
    <button
      type="button"
      onClick={() => navigate('/')}
      aria-label={`${count} pending match confirmations`}
      className="relative rounded-lg w-9 h-9 flex items-center justify-center bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 hover:border-cyan2-400 transition active:scale-90"
    >
      <span aria-hidden className="text-base text-zinc-700 dark:text-zinc-200">✉</span>
      {count > 0 && (
        <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-cyan2-400 text-zinc-900 text-[10px] flex items-center justify-center font-bold">
          {count}
        </span>
      )}
    </button>
  );
}

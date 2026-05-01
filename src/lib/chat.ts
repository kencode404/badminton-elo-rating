import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { useAuth } from './auth';

// In-tab signal so the badge can zero out instantly without waiting
// for the Realtime round-trip from the profile UPDATE.
const CHAT_SEEN_EVENT = 'badminton-chat-seen';

// Counts chat_messages created since the user's chat_last_seen_at.
// Includes both system streak announcements and (future) user messages.
// Live-updates via Supabase Realtime when chat rows change or when the
// user's last-seen timestamp changes; also reacts immediately to the
// in-tab CHAT_SEEN_EVENT.
export function useChatUnread(): number {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!user) {
      setCount(0);
      return;
    }
    let active = true;

    async function refresh() {
      const { data: profile } = await supabase
        .from('profiles')
        .select('chat_last_seen_at')
        .eq('id', user!.id)
        .maybeSingle();
      const lastSeen = profile?.chat_last_seen_at ?? '1970-01-01';

      const nowIso = new Date().toISOString();
      const { count: c } = await supabase
        .from('chat_messages')
        .select('*', { count: 'exact', head: true })
        .gt('created_at', lastSeen)
        .or(`expires_at.is.null,expires_at.gt.${nowIso}`);
      if (active) setCount(c ?? 0);
    }

    refresh();

    function onSeen() {
      if (active) setCount(0);
    }
    window.addEventListener(CHAT_SEEN_EVENT, onSeen);

    const channel = supabase
      .channel(`chat-unread-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_messages' },
        () => refresh(),
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${user.id}`,
        },
        () => refresh(),
      )
      .subscribe();

    return () => {
      active = false;
      window.removeEventListener(CHAT_SEEN_EVENT, onSeen);
      supabase.removeChannel(channel);
    };
  }, [user]);

  return count;
}

// Mark the chat as seen for the current user. Fires the in-tab event
// for an instant badge clear, then persists via DB so other tabs/
// devices catch up via Realtime.
export async function markChatSeen(userId: string): Promise<void> {
  window.dispatchEvent(new Event(CHAT_SEEN_EVENT));
  await supabase
    .from('profiles')
    .update({ chat_last_seen_at: new Date().toISOString() })
    .eq('id', userId);
}

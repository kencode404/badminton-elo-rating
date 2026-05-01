import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { useAuth } from './auth';

// Counts chat_messages created since the user's chat_last_seen_at.
// Includes both system streak announcements and (future) user messages.
// Live-updates via Supabase Realtime when chat rows change or when the
// user's last-seen timestamp changes.
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

      // Active = expires_at is null (user messages) OR not yet expired.
      const nowIso = new Date().toISOString();
      const { count: c } = await supabase
        .from('chat_messages')
        .select('*', { count: 'exact', head: true })
        .gt('created_at', lastSeen)
        .or(`expires_at.is.null,expires_at.gt.${nowIso}`);
      if (active) setCount(c ?? 0);
    }

    refresh();

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
      supabase.removeChannel(channel);
    };
  }, [user]);

  return count;
}

// Mark the chat as seen for the current user (call from HomePage on mount).
export async function markChatSeen(userId: string): Promise<void> {
  await supabase
    .from('profiles')
    .update({ chat_last_seen_at: new Date().toISOString() })
    .eq('id', userId);
}

import { supabase } from './supabase';

// Three streams that count toward the bell badge:
//   * mention — a user message whose mentioned_user_ids contains me
//   * reply   — a user message whose parent (reply_to_message_id) is
//               authored by me, and the parent itself is a user kind
//   * reaction — a chat_reactions row on one of MY user messages
// All filter out self-actions and are bounded by the user's
// profiles.notifications_last_seen_at cutoff.

export interface ChatNotification {
  key: string;
  kind: 'mention' | 'reply' | 'reaction';
  actor_user_id: string;
  actor_name: string;
  actor_avatar: string | null;
  message_id: string;
  preview: string;
  created_at: string;
  emoji?: string;
}

type ProfileLite = {
  display_name: string;
  avatar_url: string | null;
} | null;

interface MentionRow {
  id: string;
  user_id: string;
  body: string | null;
  created_at: string;
  profiles: ProfileLite;
}

interface ReplyRow {
  id: string;
  user_id: string;
  body: string | null;
  created_at: string;
  reply_to_message_id: string;
  profiles: ProfileLite;
  parent: { user_id: string; kind: string } | null;
}

interface ReactionRow {
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
  profiles: ProfileLite;
  msg: { user_id: string; kind: string; body: string | null } | null;
}

export async function fetchChatNotifications(
  userId: string,
  sinceIso: string,
): Promise<ChatNotification[]> {
  const [mentionsRes, repliesRes, reactionsRes] = await Promise.all([
    supabase
      .from('badminton_chat_messages')
      .select(
        'id, user_id, body, created_at, profiles:user_id(display_name, avatar_url)',
      )
      .eq('kind', 'user')
      .neq('user_id', userId)
      .contains('mentioned_user_ids', [userId])
      .gt('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('badminton_chat_messages')
      .select(
        'id, user_id, body, created_at, reply_to_message_id, profiles:user_id(display_name, avatar_url), parent:reply_to_message_id!inner(user_id, kind)',
      )
      .eq('parent.user_id', userId)
      .eq('parent.kind', 'user')
      .neq('user_id', userId)
      .gt('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('badminton_chat_reactions')
      .select(
        'message_id, user_id, emoji, created_at, profiles:user_id(display_name, avatar_url), msg:message_id!inner(user_id, kind, body)',
      )
      .eq('msg.user_id', userId)
      .eq('msg.kind', 'user')
      .neq('user_id', userId)
      .gt('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  const out: ChatNotification[] = [];

  for (const r of (mentionsRes.data ?? []) as unknown as MentionRow[]) {
    out.push({
      key: `mention-${r.id}`,
      kind: 'mention',
      actor_user_id: r.user_id,
      actor_name: r.profiles?.display_name ?? 'Player',
      actor_avatar: r.profiles?.avatar_url ?? null,
      message_id: r.id,
      preview: r.body ?? '',
      created_at: r.created_at,
    });
  }

  for (const r of (repliesRes.data ?? []) as unknown as ReplyRow[]) {
    out.push({
      key: `reply-${r.id}`,
      kind: 'reply',
      actor_user_id: r.user_id,
      actor_name: r.profiles?.display_name ?? 'Player',
      actor_avatar: r.profiles?.avatar_url ?? null,
      message_id: r.id,
      preview: r.body ?? '',
      created_at: r.created_at,
    });
  }

  for (const r of (reactionsRes.data ?? []) as unknown as ReactionRow[]) {
    out.push({
      key: `reaction-${r.message_id}-${r.user_id}-${r.emoji}`,
      kind: 'reaction',
      actor_user_id: r.user_id,
      actor_name: r.profiles?.display_name ?? 'Player',
      actor_avatar: r.profiles?.avatar_url ?? null,
      message_id: r.message_id,
      preview: r.msg?.body ?? '',
      created_at: r.created_at,
      emoji: r.emoji,
    });
  }

  out.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return out.slice(0, 30);
}

// Stamp profiles.notifications_last_seen_at = now() so future bell
// fetches don't surface the same events again.
export async function markNotificationsSeen(userId: string): Promise<void> {
  await supabase
    .from('badminton_profiles')
    .update({ notifications_last_seen_at: new Date().toISOString() })
    .eq('id', userId);
}

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { markChatSeen } from '../lib/chat';
import { formatError } from '../lib/errors';
import type { ChatMessageKind, MatchType } from '../lib/database.types';

const REACTION_PALETTE = ['🔥', '👏', '😂', '❤️', '💪', '🤝'];
const LONG_PRESS_MS = 450;

function useLongPress(callback: () => void) {
  const timer = useRef<number | null>(null);

  const start = (e: ReactPointerEvent) => {
    // Ignore right-click on desktop
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    timer.current = window.setTimeout(callback, LONG_PRESS_MS);
  };
  const cancel = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  return {
    onPointerDown: start,
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    style: { touchAction: 'manipulation' as const },
  };
}

interface ChatMsg {
  id: string;
  kind: ChatMessageKind;
  user_id: string;
  body: string | null;
  match_type: MatchType | null;
  streak_count: number | null;
  created_at: string;
  display_name: string;
  avatar_url: string | null;
}

interface Reaction {
  message_id: string;
  user_id: string;
  emoji: string;
}

export function ClubChat() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMsg[] | null>(null);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerForMsg, setPickerForMsg] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);

  // Fetch messages (system + user) and reactions, then subscribe.
  useEffect(() => {
    if (!user) return;
    let active = true;

    async function loadMessages() {
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from('chat_messages')
        .select(
          'id, kind, user_id, body, match_type, streak_count, created_at, profiles:user_id(display_name, avatar_url)',
        )
        .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
        .order('created_at', { ascending: false })
        .limit(80);
      if (!active) return;
      if (error) {
        setError(formatError(error));
        return;
      }
      type Joined = ChatMsg & {
        profiles:
          | { display_name: string; avatar_url: string | null }
          | null;
      };
      const flattened: ChatMsg[] = ((data ?? []) as unknown as Joined[])
        .map((r) => ({
          id: r.id,
          kind: r.kind,
          user_id: r.user_id,
          body: r.body,
          match_type: r.match_type,
          streak_count: r.streak_count,
          created_at: r.created_at,
          display_name: r.profiles?.display_name ?? 'Player',
          avatar_url: r.profiles?.avatar_url ?? null,
        }))
        .reverse(); // oldest first → newest at bottom
      setMessages(flattened);
    }

    async function loadReactions() {
      const { data, error } = await supabase
        .from('chat_reactions')
        .select('message_id, user_id, emoji');
      if (!active) return;
      if (error) {
        // Non-fatal; keep going without reactions
        return;
      }
      setReactions((data ?? []) as Reaction[]);
    }

    loadMessages();
    loadReactions();

    const channel = supabase
      .channel(`club-chat-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_messages' },
        () => loadMessages(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_reactions' },
        () => loadReactions(),
      )
      .subscribe((status) => {
        // Surface subscription status so we can spot a misconfigured
        // realtime publication in the console without crashing.
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[ClubChat] realtime status:', status);
        }
      });

    // Polling fallback — realtime should drive updates instantly, but
    // poll every 8s as a safety net if events are dropped or the
    // table isn't in the supabase_realtime publication.
    const poll = window.setInterval(() => {
      loadMessages();
      loadReactions();
    }, 8000);

    return () => {
      active = false;
      window.clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [user]);

  // Auto-scroll to bottom when messages list changes.
  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  // Close the reaction picker on any outside tap or Escape.
  useEffect(() => {
    if (!pickerForMsg) return;
    function maybeClose(e: PointerEvent) {
      const t = e.target as HTMLElement | null;
      if (t && t.closest('[data-reaction-picker]')) return;
      setPickerForMsg(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setPickerForMsg(null);
    }
    document.addEventListener('pointerdown', maybeClose);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', maybeClose);
      document.removeEventListener('keydown', onKey);
    };
  }, [pickerForMsg]);

  // Mark chat seen on mount and whenever the message list updates while
  // the user is on this page.
  useEffect(() => {
    if (!user) return;
    markChatSeen(user.id);
  }, [user, messages]);

  // Group reactions by message_id and emoji for fast lookup.
  const reactionsByMessage = useMemo(() => {
    const map = new Map<string, Map<string, Reaction[]>>();
    for (const r of reactions) {
      let perMsg = map.get(r.message_id);
      if (!perMsg) {
        perMsg = new Map();
        map.set(r.message_id, perMsg);
      }
      const list = perMsg.get(r.emoji) ?? [];
      list.push(r);
      perMsg.set(r.emoji, list);
    }
    return map;
  }, [reactions]);

  const onSend = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!user) return;
      const body = input.trim();
      if (!body) return;
      setSending(true);
      setError(null);
      const { error } = await supabase.from('chat_messages').insert({
        kind: 'user',
        user_id: user.id,
        body,
      });
      setSending(false);
      if (error) {
        setError(formatError(error));
        return;
      }
      setInput('');
    },
    [input, user],
  );

  // One reaction per user per message: tapping the same emoji removes
  // your reaction; tapping a different emoji replaces it.
  const toggleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!user) return;
      const mine = reactions.find(
        (r) => r.message_id === messageId && r.user_id === user.id,
      );
      if (mine && mine.emoji === emoji) {
        await supabase
          .from('chat_reactions')
          .delete()
          .eq('message_id', messageId)
          .eq('user_id', user.id);
      } else {
        await supabase
          .from('chat_reactions')
          .upsert(
            { message_id: messageId, user_id: user.id, emoji },
            { onConflict: 'message_id,user_id' },
          );
      }
      setPickerForMsg(null);
    },
    [user, reactions],
  );

  return (
    <section className="glass-panel overflow-hidden flex flex-col">
      <header className="flex items-center justify-between px-3 py-2 border-b border-zinc-200/60 dark:border-zinc-800/60">
        <div className="flex items-center gap-2">
          <span className="text-cyan2-500 dark:text-cyan2-300 text-base" aria-hidden>
            💬
          </span>
          <span className="font-display text-[11px] uppercase tracking-widest text-zinc-700 dark:text-zinc-200">
            Club Chat
          </span>
        </div>
      </header>

      <div
        ref={listRef}
        className="px-3 py-3 space-y-2 overflow-y-auto"
        style={{ maxHeight: '22rem' }}
      >
        {messages === null ? (
          <p className="text-center text-[11px] text-zinc-500 dark:text-zinc-500 py-6">
            Loading…
          </p>
        ) : messages.length === 0 ? (
          <p className="text-center text-[11px] text-zinc-500 dark:text-zinc-500 py-6">
            No messages yet — say hi 👋
          </p>
        ) : (
          messages.map((m) => (
            <MessageRow
              key={m.id}
              msg={m}
              isMine={m.user_id === user?.id}
              reactions={reactionsByMessage.get(m.id) ?? new Map()}
              currentUserId={user?.id ?? null}
              pickerOpen={pickerForMsg === m.id}
              onTogglePicker={() => setPickerForMsg((id) => (id === m.id ? null : m.id))}
              onToggleReaction={(emoji) => toggleReaction(m.id, emoji)}
            />
          ))
        )}
      </div>

      {error && (
        <div className="mx-3 mb-2 text-[11px] text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/40 rounded-md px-3 py-1.5">
          {error}
        </div>
      )}

      <form
        onSubmit={onSend}
        className="border-t border-zinc-200/60 dark:border-zinc-800/60 px-3 py-2 flex items-center gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={500}
          placeholder="Message the club…"
          className="flex-1 px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-cyan2-400 focus:ring-1 focus:ring-cyan2-400/40 transition"
          disabled={sending}
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="cosmic-button text-xs px-4 py-2 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </section>
  );
}

function MessageRow({
  msg,
  isMine,
  reactions,
  currentUserId,
  pickerOpen,
  onTogglePicker,
  onToggleReaction,
}: {
  msg: ChatMsg;
  isMine: boolean;
  reactions: Map<string, Reaction[]>;
  currentUserId: string | null;
  pickerOpen: boolean;
  onTogglePicker: () => void;
  onToggleReaction: (emoji: string) => void;
}) {
  if (msg.kind === 'system_streak') {
    return <SystemStreakRow msg={msg} reactions={reactions} currentUserId={currentUserId} pickerOpen={pickerOpen} onTogglePicker={onTogglePicker} onToggleReaction={onToggleReaction} />;
  }
  return <UserMessageRow msg={msg} isMine={isMine} reactions={reactions} currentUserId={currentUserId} pickerOpen={pickerOpen} onTogglePicker={onTogglePicker} onToggleReaction={onToggleReaction} />;
}

function SystemStreakRow({
  msg,
  reactions,
  currentUserId,
  pickerOpen,
  onTogglePicker,
  onToggleReaction,
}: {
  msg: ChatMsg;
  reactions: Map<string, Reaction[]>;
  currentUserId: string | null;
  pickerOpen: boolean;
  onTogglePicker: () => void;
  onToggleReaction: (emoji: string) => void;
}) {
  const challenge = (msg.streak_count ?? 0) >= 3;
  const text = challenge
    ? `${msg.display_name} won ${msg.streak_count} ${msg.match_type} matches in a row 🔥 Who can beat them?`
    : `${msg.display_name} won 2 ${msg.match_type} matches in a row 🔥`;
  const accent = challenge
    ? 'text-orange-500 dark:text-orange-400'
    : 'text-amber-500 dark:text-amber-400';
  const bubbleRef = useRef<HTMLDivElement>(null);
  const longPress = useLongPress(onTogglePicker);

  return (
    <div className="flex justify-start">
      <div className="max-w-[88%] flex flex-col items-start gap-1">
        <div className={`text-[9px] font-display uppercase tracking-widest ${accent}`}>
          System · {formatRelative(msg.created_at)}
        </div>
        <div
          ref={bubbleRef}
          {...longPress}
          className={`rounded-2xl rounded-bl-md px-3 py-1.5 text-[12px] leading-snug select-none cursor-pointer ${
            challenge
              ? 'bg-orange-500/10 dark:bg-orange-500/15 text-zinc-800 dark:text-zinc-100'
              : 'bg-amber-500/10 dark:bg-amber-500/15 text-zinc-800 dark:text-zinc-100'
          }`}
        >
          {text}
        </div>
        {pickerOpen && (
          <ReactionPicker anchorRef={bubbleRef} alignRight={false} onPick={onToggleReaction} />
        )}
        <ReactionsBar
          reactions={reactions}
          currentUserId={currentUserId}
          onTogglePicker={onTogglePicker}
        />
      </div>
    </div>
  );
}

function UserMessageRow({
  msg,
  isMine,
  reactions,
  currentUserId,
  pickerOpen,
  onTogglePicker,
  onToggleReaction,
}: {
  msg: ChatMsg;
  isMine: boolean;
  reactions: Map<string, Reaction[]>;
  currentUserId: string | null;
  pickerOpen: boolean;
  onTogglePicker: () => void;
  onToggleReaction: (emoji: string) => void;
}) {
  const align = isMine ? 'justify-end' : 'justify-start';
  const bubbleClass = isMine
    ? 'bg-cyan2-500/15 text-zinc-900 dark:text-zinc-100 rounded-2xl rounded-br-md'
    : 'bg-zinc-200/70 dark:bg-zinc-800/60 text-zinc-900 dark:text-zinc-100 rounded-2xl rounded-bl-md';
  const headerColor = isMine
    ? 'text-cyan2-600 dark:text-cyan2-300'
    : 'text-zinc-600 dark:text-zinc-400';
  const bubbleRef = useRef<HTMLDivElement>(null);
  const longPress = useLongPress(onTogglePicker);

  return (
    <div className={`flex ${align}`}>
      <div className={`max-w-[80%] flex flex-col ${isMine ? 'items-end' : 'items-start'} gap-1`}>
        <div className={`text-[9px] font-display tracking-widest ${headerColor}`}>
          {!isMine && <span className="uppercase">{msg.display_name} · </span>}
          <span className="text-zinc-500 dark:text-zinc-500">
            {formatRelative(msg.created_at)}
          </span>
        </div>
        <div
          ref={bubbleRef}
          {...longPress}
          className={`px-3 py-1.5 text-[13px] leading-snug select-none cursor-pointer ${bubbleClass}`}
        >
          {msg.body}
        </div>
        {pickerOpen && (
          <ReactionPicker anchorRef={bubbleRef} alignRight={isMine} onPick={onToggleReaction} />
        )}
        <ReactionsBar
          reactions={reactions}
          currentUserId={currentUserId}
          onTogglePicker={onTogglePicker}
          alignRight={isMine}
        />
      </div>
    </div>
  );
}

// Single pill grouping all unique emojis on a message + total count,
// WhatsApp style. Overlaps the bubble's bottom edge slightly. Tap
// opens the reaction picker so the user can add / change / remove
// their own reaction.
function ReactionsBar({
  reactions,
  currentUserId,
  onTogglePicker,
  alignRight = false,
}: {
  reactions: Map<string, Reaction[]>;
  currentUserId: string | null;
  onTogglePicker: () => void;
  alignRight?: boolean;
}) {
  const entries = Array.from(reactions.entries());
  if (entries.length === 0) return null;

  const total = entries.reduce((sum, [, list]) => sum + list.length, 0);
  const myReaction = currentUserId
    ? Array.from(reactions.values())
        .flat()
        .find((r) => r.user_id === currentUserId)
    : null;

  return (
    <div
      className={`relative -mt-3 z-10 ${alignRight ? 'self-end mr-2' : 'self-start ml-2'}`}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={onTogglePicker}
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 border shadow-sm transition ${
          myReaction
            ? 'bg-cyan2-500/15 border-cyan2-400/60'
            : 'bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 hover:border-cyan2-400/40'
        }`}
        aria-label={`${total} ${total === 1 ? 'reaction' : 'reactions'}`}
      >
        <span className="flex items-center gap-0.5">
          {entries.map(([emoji]) => (
            <span key={emoji} className="text-[13px] leading-none">
              {emoji}
            </span>
          ))}
        </span>
        <span className="text-[11px] leading-none text-zinc-700 dark:text-zinc-300 font-display tracking-wider">
          {total}
        </span>
      </button>
    </div>
  );
}

// Floating emoji palette shown after long-press. Uses position:fixed
// + computed coordinates anchored to the bubble so it isn't clipped
// by the chat panel's overflow boundary. Flips above/below depending
// on which side has more room.
function ReactionPicker({
  anchorRef,
  alignRight,
  onPick,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  alignRight: boolean;
  onPick: (emoji: string) => void;
}) {
  const PICKER_HEIGHT = 48;
  const PICKER_WIDTH_EST = 240;
  const PADDING = 8;

  const computePos = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const above = r.top - PICKER_HEIGHT - PADDING;
    const below = r.bottom + PADDING;
    const top = above >= PADDING ? above : below;
    const left = alignRight
      ? Math.max(PADDING, r.right - PICKER_WIDTH_EST)
      : Math.min(window.innerWidth - PICKER_WIDTH_EST - PADDING, Math.max(PADDING, r.left));
    return { top, left };
  }, [anchorRef, alignRight]);

  const [pos, setPos] = useState<{ top: number; left: number } | null>(computePos);

  useEffect(() => {
    setPos(computePos());
    function update() {
      setPos(computePos());
    }
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [computePos]);

  if (!pos) return null;

  return (
    <div
      data-reaction-picker
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        zIndex: 60,
      }}
      className="flex gap-1 rounded-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-lg p-1"
    >
      {REACTION_PALETTE.map((e) => (
        <button
          key={e}
          type="button"
          onClick={() => onPick(e)}
          className="inline-flex items-center justify-center w-8 h-8 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 transition text-lg"
          aria-label={`React with ${e}`}
        >
          {e}
        </button>
      ))}
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

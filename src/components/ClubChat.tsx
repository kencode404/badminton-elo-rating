import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { markChatSeen } from '../lib/chat';
import { formatError } from '../lib/errors';
import { TierBadge } from './TierBadge';
import { TIERS, type TierKey } from '../lib/tiers';
import type { ChatMessageKind, MatchType } from '../lib/database.types';

const REACTION_PALETTE = ['🔥', '👏', '😂', '❤️', '💪', '🤝', '😠', '😢'];
const LONG_PRESS_MS = 450;
const UNSEND_WINDOW_MS = 10 * 60 * 1000;

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
  tier_key: string | null;
  breaker_user_ids: string[] | null;
  created_at: string;
  display_name: string;
  avatar_url: string | null;
}

interface Reaction {
  message_id: string;
  user_id: string;
  emoji: string;
  display_name: string;
  avatar_url: string | null;
}

export function ClubChat() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const previewMode = searchParams.get('preview') === 'announcements';
  const [messages, setMessages] = useState<ChatMsg[] | null>(null);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  // Display-name lookup for users referenced in breaker_user_ids on
  // streak-ended messages. Populated lazily as messages load.
  const [breakerNames, setBreakerNames] = useState<Record<string, string>>({});

  // ?preview=announcements: prepend a set of fake system messages
  // covering every tier-up + streak-broken variant so the styling
  // can be inspected without waiting for real matches.
  const displayedMessages = useMemo(() => {
    if (!messages) return null;
    if (!previewMode) return messages;
    return [...buildPreviewAnnouncements(), ...messages];
  }, [messages, previewMode]);
  const previewBreakerNames: Record<string, string> = previewMode
    ? {
        'preview-breaker-1': 'Carol',
        'preview-breaker-2': 'Dave',
      }
    : {};
  const effectiveBreakerNames = { ...breakerNames, ...previewBreakerNames };
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerForMsg, setPickerForMsg] = useState<string | null>(null);
  const [reactorsForMsg, setReactorsForMsg] = useState<string | null>(null);

  // Snapshot of the user's last-seen timestamp BEFORE this visit, used
  // once on first render so we can scroll to where they left off.
  const [initialLastSeen, setInitialLastSeen] = useState<string | null>(null);
  const initialScrollDoneRef = useRef(false);

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
          'id, kind, user_id, body, match_type, streak_count, tier_key, breaker_user_ids, created_at, profiles:user_id(display_name, avatar_url)',
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
          tier_key: r.tier_key ?? null,
          breaker_user_ids: r.breaker_user_ids ?? null,
          created_at: r.created_at,
          display_name: r.profiles?.display_name ?? 'Player',
          avatar_url: r.profiles?.avatar_url ?? null,
        }))
        .reverse(); // oldest first → newest at bottom
      setMessages(flattened);

      // Fetch display names for breakers referenced in any
      // system_streak_ended message in this batch.
      const breakerIds = new Set<string>();
      for (const m of flattened) {
        if (m.breaker_user_ids) for (const id of m.breaker_user_ids) breakerIds.add(id);
      }
      if (breakerIds.size > 0) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, display_name')
          .in('id', Array.from(breakerIds));
        if (active && profs) {
          setBreakerNames((prev) => {
            const next = { ...prev };
            for (const p of profs as { id: string; display_name: string }[]) {
              next[p.id] = p.display_name;
            }
            return next;
          });
        }
      }
    }

    async function loadReactions() {
      const { data, error } = await supabase
        .from('chat_reactions')
        .select('message_id, user_id, emoji, profiles:user_id(display_name, avatar_url)');
      if (!active) return;
      if (error) {
        return;
      }
      type Joined = {
        message_id: string;
        user_id: string;
        emoji: string;
        profiles: { display_name: string; avatar_url: string | null } | null;
      };
      const flattened: Reaction[] = ((data ?? []) as unknown as Joined[]).map(
        (r) => ({
          message_id: r.message_id,
          user_id: r.user_id,
          emoji: r.emoji,
          display_name: r.profiles?.display_name ?? 'Player',
          avatar_url: r.profiles?.avatar_url ?? null,
        }),
      );
      setReactions(flattened);
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

  // Snapshot the user's chat_last_seen_at BEFORE marking it. Used once
  // on first render to scroll to where they left off.
  useEffect(() => {
    if (!user) return;
    let active = true;
    supabase
      .from('profiles')
      .select('chat_last_seen_at')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setInitialLastSeen(data?.chat_last_seen_at ?? null);
      });
    return () => {
      active = false;
    };
  }, [user]);

  // First-render scroll: jump to the user's first unread message (so their
  // last-read sits at the top of the visible area). If everything is
  // read, fall back to scrolling to the bottom (latest).
  useEffect(() => {
    if (initialScrollDoneRef.current) return;
    if (!listRef.current || !messages || messages.length === 0) return;
    if (initialLastSeen === null) return;

    const firstUnreadIdx = messages.findIndex(
      (m) => m.created_at > initialLastSeen,
    );
    const el = listRef.current;
    if (firstUnreadIdx === -1) {
      // Everything already read → bottom
      el.scrollTop = el.scrollHeight;
    } else {
      const target = el.querySelector(
        `[data-msg-id="${messages[firstUnreadIdx].id}"]`,
      ) as HTMLElement | null;
      if (target) {
        // Position the first-unread message near the top with a small
        // offset so the previous (last-read) message is still in view.
        el.scrollTop = Math.max(0, target.offsetTop - 36);
      } else {
        el.scrollTop = el.scrollHeight;
      }
    }
    initialScrollDoneRef.current = true;
    // Now safe to mark seen (we've used the snapshot for scroll positioning).
    if (user) markChatSeen(user.id);
  }, [messages, initialLastSeen, user]);

  // For subsequent message updates, only auto-scroll to bottom if the
  // user is already near it (i.e. they're "live" reading). If they've
  // scrolled up to view history, don't yank them back.
  useEffect(() => {
    if (!initialScrollDoneRef.current) return;
    if (!listRef.current || !messages) return;
    const el = listRef.current;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distFromBottom < 60) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  // Close any open popover (picker or reactors) on outside tap or Escape.
  useEffect(() => {
    if (!pickerForMsg && !reactorsForMsg) return;
    function maybeClose(e: PointerEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('[data-reaction-picker]') || t.closest('[data-reactors-popover]'))) {
        return;
      }
      setPickerForMsg(null);
      setReactorsForMsg(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setPickerForMsg(null);
        setReactorsForMsg(null);
      }
    }
    document.addEventListener('pointerdown', maybeClose);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', maybeClose);
      document.removeEventListener('keydown', onKey);
    };
  }, [pickerForMsg, reactorsForMsg]);

  // (markChatSeen now fires once after the first-render scroll, see above.)

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

  const unsendMessage = useCallback(
    async (messageId: string) => {
      const { error } = await supabase
        .from('chat_messages')
        .delete()
        .eq('id', messageId);
      if (error) {
        setError(formatError(error));
        return;
      }
      setPickerForMsg(null);
    },
    [],
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
        {previewMode && (
          <div className="text-[10px] font-display tracking-widest uppercase text-cyan2-500 dark:text-cyan2-300 bg-cyan2-500/5 border border-cyan2-400/30 rounded-md px-3 py-2 mb-1">
            Preview · mock announcements prepended
          </div>
        )}
        {displayedMessages === null ? (
          <p className="text-center text-[11px] text-zinc-500 dark:text-zinc-500 py-6">
            Loading…
          </p>
        ) : displayedMessages.length === 0 ? (
          <p className="text-center text-[11px] text-zinc-500 dark:text-zinc-500 py-6">
            No messages yet — say hi 👋
          </p>
        ) : (
          displayedMessages.map((m) => (
            <MessageRow
              key={m.id}
              msg={m}
              isMine={m.user_id === user?.id}
              reactions={reactionsByMessage.get(m.id) ?? new Map()}
              currentUserId={user?.id ?? null}
              breakerNames={effectiveBreakerNames}
              pickerOpen={pickerForMsg === m.id}
              reactorsOpen={reactorsForMsg === m.id}
              onTogglePicker={() => {
                setReactorsForMsg(null);
                setPickerForMsg((id) => (id === m.id ? null : m.id));
              }}
              onShowReactors={() => {
                setPickerForMsg(null);
                setReactorsForMsg((id) => (id === m.id ? null : m.id));
              }}
              onToggleReaction={(emoji) => toggleReaction(m.id, emoji)}
              onUnsend={() => unsendMessage(m.id)}
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

interface RowProps {
  msg: ChatMsg;
  isMine: boolean;
  reactions: Map<string, Reaction[]>;
  currentUserId: string | null;
  breakerNames: Record<string, string>;
  pickerOpen: boolean;
  reactorsOpen: boolean;
  onTogglePicker: () => void;
  onShowReactors: () => void;
  onToggleReaction: (emoji: string) => void;
  onUnsend: () => void;
}

function MessageRow(props: RowProps) {
  if (props.msg.kind === 'system_streak') {
    return <SystemStreakRow {...props} />;
  }
  if (props.msg.kind === 'system_tier_up') {
    return <SystemTierUpRow {...props} />;
  }
  if (props.msg.kind === 'system_streak_ended') {
    return <SystemStreakEndedRow {...props} />;
  }
  if (
    props.msg.kind === 'system_season_reset' ||
    props.msg.kind === 'system_user_banned'
  ) {
    return <SystemLogRow msg={props.msg} />;
  }
  return <UserMessageRow {...props} />;
}

// Quiet centered log line for moderation events (season reset, ban).
// Intentionally less prominent than the streak/tier announcements.
function SystemLogRow({ msg }: { msg: ChatMsg }) {
  return (
    <div className="flex justify-center" data-msg-id={msg.id}>
      <div className="text-[10px] text-zinc-500 dark:text-zinc-500 italic px-3 py-1 max-w-[88%] text-center">
        · {msg.body} · {formatRelative(msg.created_at)}
      </div>
    </div>
  );
}

function SystemStreakRow({
  msg,
  reactions,
  currentUserId,
  pickerOpen,
  reactorsOpen,
  onTogglePicker,
  onShowReactors,
  onToggleReaction,
}: RowProps) {
  const challenge = (msg.streak_count ?? 0) >= 3;
  const text = challenge
    ? `${msg.display_name} won ${msg.streak_count} ${msg.match_type} matches in a row 🔥 Who can beat them?`
    : `${msg.display_name} won 2 ${msg.match_type} matches in a row 🔥`;
  const accent = challenge
    ? 'text-orange-500 dark:text-orange-400'
    : 'text-amber-500 dark:text-amber-400';
  const bubbleRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const longPress = useLongPress(onTogglePicker);

  return (
    <div className="flex justify-start" data-msg-id={msg.id}>
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
          <ReactionPicker
            anchorRef={bubbleRef}
            alignRight={false}
            currentEmoji={findMyEmoji(reactions, currentUserId)}
            onPick={onToggleReaction}
          />
        )}
        <ReactionsBar
          reactions={reactions}
          currentUserId={currentUserId}
          onShowReactors={onShowReactors}
          barRef={pillRef}
        />
        {reactorsOpen && (
          <ReactorsPopover
            anchorRef={pillRef}
            alignRight={false}
            reactions={reactions}
          />
        )}
      </div>
    </div>
  );
}

function SystemTierUpRow({
  msg,
  reactions,
  currentUserId,
  pickerOpen,
  reactorsOpen,
  onTogglePicker,
  onShowReactors,
  onToggleReaction,
}: RowProps) {
  const tier = TIERS.find((t) => t.key === msg.tier_key);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const longPress = useLongPress(onTogglePicker);

  if (!tier) return null;

  // Color the bubble in the tier's accent — picks up red for Predator,
  // cyan for Diamond, amber for Gold, etc.
  const tierKey = tier.key as TierKey;
  const accentRgb = tierKeyToAccentRgb(tierKey);

  return (
    <div className="flex justify-start" data-msg-id={msg.id}>
      <div className="max-w-[88%] flex flex-col items-start gap-1">
        <div
          className="text-[9px] font-display uppercase tracking-widest"
          style={{ color: tier.toColor }}
        >
          System · Tier Up · {formatRelative(msg.created_at)}
        </div>
        <div
          ref={bubbleRef}
          {...longPress}
          className="rounded-2xl rounded-bl-md px-3 py-2 text-[12px] leading-snug select-none cursor-pointer flex items-center gap-2"
          style={{
            background: `rgba(${accentRgb}, 0.12)`,
            border: `1px solid rgba(${accentRgb}, 0.35)`,
            color: 'inherit',
          }}
        >
          <TierBadge
            status={{ kind: 'tier', tier }}
            size={22}
            showName={false}
            className="shrink-0"
          />
          <span className="text-zinc-900 dark:text-zinc-100">
            <strong>{msg.display_name}</strong> reached{' '}
            <span style={{ color: tier.toColor }} className="font-display tracking-wider uppercase">
              {tier.name}
            </span>{' '}
            in {msg.match_type}!
          </span>
        </div>
        {pickerOpen && (
          <ReactionPicker
            anchorRef={bubbleRef}
            alignRight={false}
            currentEmoji={findMyEmoji(reactions, currentUserId)}
            onPick={onToggleReaction}
          />
        )}
        <ReactionsBar
          reactions={reactions}
          currentUserId={currentUserId}
          onShowReactors={onShowReactors}
          barRef={pillRef}
        />
        {reactorsOpen && (
          <ReactorsPopover
            anchorRef={pillRef}
            alignRight={false}
            reactions={reactions}
          />
        )}
      </div>
    </div>
  );
}

function SystemStreakEndedRow({
  msg,
  reactions,
  currentUserId,
  breakerNames,
  pickerOpen,
  reactorsOpen,
  onTogglePicker,
  onShowReactors,
  onToggleReaction,
}: RowProps) {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const longPress = useLongPress(onTogglePicker);
  const breakerLabel =
    (msg.breaker_user_ids ?? [])
      .map((id) => breakerNames[id] ?? 'someone')
      .join(' & ') || 'someone';

  return (
    <div className="flex justify-start" data-msg-id={msg.id}>
      <div className="max-w-[88%] flex flex-col items-start gap-1">
        <div className="text-[9px] font-display uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
          System · Streak Broken · {formatRelative(msg.created_at)}
        </div>
        <div
          ref={bubbleRef}
          {...longPress}
          className="rounded-2xl rounded-bl-md px-3 py-2 text-[12px] leading-snug select-none cursor-pointer bg-zinc-200/60 dark:bg-zinc-800/60 text-zinc-800 dark:text-zinc-100 border border-zinc-300/60 dark:border-zinc-700/60"
        >
          <strong>{msg.display_name}</strong>'s {msg.streak_count}-win{' '}
          {msg.match_type} streak was ended by{' '}
          <strong>{breakerLabel}</strong> 💔
        </div>
        {pickerOpen && (
          <ReactionPicker
            anchorRef={bubbleRef}
            alignRight={false}
            currentEmoji={findMyEmoji(reactions, currentUserId)}
            onPick={onToggleReaction}
          />
        )}
        <ReactionsBar
          reactions={reactions}
          currentUserId={currentUserId}
          onShowReactors={onShowReactors}
          barRef={pillRef}
        />
        {reactorsOpen && (
          <ReactorsPopover
            anchorRef={pillRef}
            alignRight={false}
            reactions={reactions}
          />
        )}
      </div>
    </div>
  );
}

// Maps a tier key to its accent RGB triple, used inline in tier-up
// bubble styling (rgba()-friendly).
// Mock announcements rendered when ?preview=announcements is set on
// the home page. Covers every visual variant of the new system
// messages so styling can be reviewed without waiting for real
// matches to fire the trigger.
function buildPreviewAnnouncements(): ChatMsg[] {
  const now = Date.now();
  const ago = (mins: number) =>
    new Date(now - mins * 60_000).toISOString();
  return [
    {
      id: 'preview-tier-bronze',
      kind: 'system_tier_up',
      user_id: 'preview-user-1',
      body: null,
      match_type: 'singles',
      streak_count: null,
      tier_key: 'bronze',
      breaker_user_ids: null,
      created_at: ago(2),
      display_name: 'Alice',
      avatar_url: null,
    },
    {
      id: 'preview-tier-silver',
      kind: 'system_tier_up',
      user_id: 'preview-user-2',
      body: null,
      match_type: 'doubles',
      streak_count: null,
      tier_key: 'silver',
      breaker_user_ids: null,
      created_at: ago(3),
      display_name: 'Bob',
      avatar_url: null,
    },
    {
      id: 'preview-tier-gold',
      kind: 'system_tier_up',
      user_id: 'preview-user-3',
      body: null,
      match_type: 'singles',
      streak_count: null,
      tier_key: 'gold',
      breaker_user_ids: null,
      created_at: ago(5),
      display_name: 'Carol',
      avatar_url: null,
    },
    {
      id: 'preview-tier-diamond',
      kind: 'system_tier_up',
      user_id: 'preview-user-4',
      body: null,
      match_type: 'doubles',
      streak_count: null,
      tier_key: 'diamond',
      breaker_user_ids: null,
      created_at: ago(8),
      display_name: 'Dave',
      avatar_url: null,
    },
    {
      id: 'preview-tier-predator',
      kind: 'system_tier_up',
      user_id: 'preview-user-5',
      body: null,
      match_type: 'doubles',
      streak_count: null,
      tier_key: 'predator',
      breaker_user_ids: null,
      created_at: ago(12),
      display_name: 'Erin',
      avatar_url: null,
    },
    {
      id: 'preview-streak-singles',
      kind: 'system_streak_ended',
      user_id: 'preview-user-6',
      body: null,
      match_type: 'singles',
      streak_count: 4,
      tier_key: null,
      breaker_user_ids: ['preview-breaker-1'],
      created_at: ago(20),
      display_name: 'Frank',
      avatar_url: null,
    },
    {
      id: 'preview-streak-doubles',
      kind: 'system_streak_ended',
      user_id: 'preview-user-7',
      body: null,
      match_type: 'doubles',
      streak_count: 6,
      tier_key: null,
      breaker_user_ids: ['preview-breaker-1', 'preview-breaker-2'],
      created_at: ago(30),
      display_name: 'Gina',
      avatar_url: null,
    },
    {
      id: 'preview-banned',
      kind: 'system_user_banned',
      user_id: 'preview-user-banned',
      body: 'Hank banned by Boss Ken',
      match_type: null,
      streak_count: null,
      tier_key: null,
      breaker_user_ids: null,
      created_at: ago(45),
      display_name: 'Hank',
      avatar_url: null,
    },
    {
      id: 'preview-season-reset',
      kind: 'system_season_reset',
      user_id: 'preview-admin',
      body: 'Season 1 reset by Boss Ken',
      match_type: null,
      streak_count: null,
      tier_key: null,
      breaker_user_ids: null,
      created_at: ago(60),
      display_name: 'Boss Ken',
      avatar_url: null,
    },
  ];
}

function tierKeyToAccentRgb(key: TierKey): string {
  switch (key) {
    case 'bronze':   return '180, 95, 39';
    case 'silver':   return '160, 170, 185';
    case 'gold':     return '218, 165, 32';
    case 'diamond':  return '34, 211, 238';
    case 'predator': return '239, 68, 68';
  }
}

function UserMessageRow({
  msg,
  isMine,
  reactions,
  currentUserId,
  pickerOpen,
  reactorsOpen,
  onTogglePicker,
  onShowReactors,
  onToggleReaction,
  onUnsend,
}: RowProps) {
  const align = isMine ? 'justify-end' : 'justify-start';
  const bubbleClass = isMine
    ? 'bg-cyan2-500/15 text-zinc-900 dark:text-zinc-100 rounded-2xl rounded-br-md'
    : 'bg-zinc-200/70 dark:bg-zinc-800/60 text-zinc-900 dark:text-zinc-100 rounded-2xl rounded-bl-md';
  const headerColor = isMine
    ? 'text-cyan2-600 dark:text-cyan2-300'
    : 'text-zinc-600 dark:text-zinc-400';
  const bubbleRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const longPress = useLongPress(onTogglePicker);

  return (
    <div className={`flex ${align}`} data-msg-id={msg.id}>
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
          <ReactionPicker
            anchorRef={bubbleRef}
            alignRight={isMine}
            currentEmoji={findMyEmoji(reactions, currentUserId)}
            onPick={onToggleReaction}
            canUnsend={isMine && Date.now() - new Date(msg.created_at).getTime() < UNSEND_WINDOW_MS}
            onUnsend={onUnsend}
          />
        )}
        <ReactionsBar
          reactions={reactions}
          currentUserId={currentUserId}
          onShowReactors={onShowReactors}
          alignRight={isMine}
          barRef={pillRef}
        />
        {reactorsOpen && (
          <ReactorsPopover
            anchorRef={pillRef}
            alignRight={isMine}
            reactions={reactions}
          />
        )}
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
  onShowReactors,
  alignRight = false,
  barRef,
}: {
  reactions: Map<string, Reaction[]>;
  currentUserId: string | null;
  onShowReactors: () => void;
  alignRight?: boolean;
  barRef?: React.Ref<HTMLDivElement>;
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
      ref={barRef}
      className={`relative -mt-3 z-10 ${alignRight ? 'self-end mr-2' : 'self-start ml-2'}`}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={onShowReactors}
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 border shadow-sm transition ${
          myReaction
            ? 'bg-cyan2-500/15 border-cyan2-400/60'
            : 'bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 hover:border-cyan2-400/40'
        }`}
        aria-label={`${total} ${total === 1 ? 'reaction' : 'reactions'} — tap to see who reacted`}
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

// Compact popover listing each reactor + the emoji they used. Anchored
// to the reactions pill, position:fixed (escapes chat panel overflow).
// Defaults to below-the-pill so it visually attaches to the reaction
// it describes; flips above only if there isn't enough room below.
function ReactorsPopover({
  anchorRef,
  alignRight,
  reactions,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  alignRight: boolean;
  reactions: Map<string, Reaction[]>;
}) {
  const POPOVER_WIDTH = 220;
  const MIN_ROOM_BELOW = 120;
  const MAX_HEIGHT = 260;
  const PADDING = 8;

  const computePos = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const left = alignRight
      ? Math.max(PADDING, r.right - POPOVER_WIDTH)
      : Math.min(
          window.innerWidth - POPOVER_WIDTH - PADDING,
          Math.max(PADDING, r.left),
        );

    const spaceBelow = window.innerHeight - r.bottom - PADDING * 2;
    const spaceAbove = r.top - PADDING * 2;

    if (spaceBelow >= MIN_ROOM_BELOW || spaceBelow >= spaceAbove) {
      return {
        top: r.bottom + PADDING,
        left,
        maxHeight: Math.min(MAX_HEIGHT, spaceBelow),
      };
    }
    const h = Math.min(MAX_HEIGHT, spaceAbove);
    return { top: r.top - h - PADDING, left, maxHeight: h };
  }, [anchorRef, alignRight]);

  const [pos, setPos] = useState<
    { top: number; left: number; maxHeight: number } | null
  >(computePos);

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

  const rows = Array.from(reactions.entries()).flatMap(([emoji, list]) =>
    list.map((r) => ({ ...r, _emoji: emoji })),
  );

  if (!pos || rows.length === 0) return null;

  return (
    <div
      data-reactors-popover
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        width: POPOVER_WIDTH,
        maxHeight: pos.maxHeight,
        zIndex: 60,
      }}
      className="flex flex-col rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-lg overflow-hidden"
    >
      <div className="px-3 py-1.5 text-[10px] font-display uppercase tracking-widest text-zinc-500 dark:text-zinc-400 border-b border-zinc-200/60 dark:border-zinc-800/60 shrink-0">
        Reactions
      </div>
      <ul className="overflow-y-auto py-1">
        {rows.map((r) => (
          <li
            key={`${r.user_id}-${r._emoji}`}
            className="flex items-center gap-2 px-3 py-1"
          >
            {r.avatar_url ? (
              <img
                src={r.avatar_url}
                alt=""
                className="w-6 h-6 rounded-full object-cover border border-zinc-200 dark:border-zinc-700 shrink-0"
              />
            ) : (
              <div className="w-6 h-6 rounded-full bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 flex items-center justify-center text-[10px] font-semibold shrink-0">
                {r.display_name?.[0]?.toUpperCase() ?? '?'}
              </div>
            )}
            <span className="flex-1 text-xs text-zinc-900 dark:text-zinc-100 truncate">
              {r.display_name}
            </span>
            <span className="text-base leading-none shrink-0">{r._emoji}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Floating emoji palette shown after long-press. Uses position:fixed
// + computed coordinates anchored to the bubble so it isn't clipped
// by the chat panel's overflow boundary. Flips above/below depending
// on which side has more room.
function findMyEmoji(
  reactions: Map<string, Reaction[]>,
  currentUserId: string | null,
): string | null {
  if (!currentUserId) return null;
  for (const [emoji, list] of reactions) {
    if (list.some((r) => r.user_id === currentUserId)) return emoji;
  }
  return null;
}

function ReactionPicker({
  anchorRef,
  alignRight,
  currentEmoji,
  onPick,
  canUnsend = false,
  onUnsend,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  alignRight: boolean;
  currentEmoji: string | null;
  onPick: (emoji: string) => void;
  canUnsend?: boolean;
  onUnsend?: () => void;
}) {
  const PICKER_HEIGHT = 48;
  const PICKER_WIDTH_EST = 360;
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
      {REACTION_PALETTE.map((e) => {
        const selected = e === currentEmoji;
        return (
          <button
            key={e}
            type="button"
            onClick={() => onPick(e)}
            className={`inline-flex items-center justify-center w-8 h-8 rounded-full transition text-lg ${
              selected
                ? 'bg-cyan2-500/25 ring-2 ring-cyan2-400'
                : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
            aria-label={
              selected ? `Remove ${e} reaction` : `React with ${e}`
            }
            title={selected ? 'Tap to remove' : ''}
          >
            {e}
          </button>
        );
      })}
      {canUnsend && onUnsend && (
        <>
          <span className="w-px self-stretch my-1 bg-zinc-200 dark:bg-zinc-700" aria-hidden />
          <button
            type="button"
            onClick={onUnsend}
            className="inline-flex items-center justify-center w-8 h-8 rounded-full hover:bg-red-500/15 transition text-zinc-500 dark:text-zinc-400 hover:text-red-500"
            aria-label="Unsend message"
            title="Unsend"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 6h18" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <path d="M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" />
            </svg>
          </button>
        </>
      )}
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

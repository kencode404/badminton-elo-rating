import { useEffect, useRef, useState } from 'react';
import { searchPlayers } from '../lib/matches';
import { ANONYMOUS_ID } from '../lib/anonymous';
import type { Database } from '../lib/database.types';

type ProfileLite = Pick<Database['public']['Tables']['profiles']['Row'], 'id' | 'display_name' | 'avatar_url'>;

// Pinned chip representing the shared "Anonymous" player. Same id and
// display_name across all uses; can fill multiple slots in one match
// (e.g. two anonymous opponents in doubles). Matches that include it
// require admin approval before they settle.
const ANONYMOUS_PROFILE: ProfileLite = {
  id: ANONYMOUS_ID,
  display_name: 'Anonymous',
  avatar_url: null,
};

interface Props {
  label: string;
  max: number;
  selected: ProfileLite[];
  onChange: (next: ProfileLite[]) => void;
  excludeIds?: string[];   // ids that must not appear in suggestions (e.g. the current user, already-picked players on other team)
}

export function PlayerPicker({ label, max, selected, onChange, excludeIds = [] }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProfileLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Real players in selected/exclude must not repeat — but anonymous is
  // exempt (it can be picked multiple times) so we strip it out of the
  // exclude list passed to searchPlayers and skip dup-checking it.
  const exclude = [...excludeIds, ...selected.map((s) => s.id)].filter(
    (id) => id !== ANONYMOUS_ID,
  );
  const exhausted = selected.length >= max;
  // Anonymous chip appears in the dropdown when there's still room and
  // it's not filtered by the active search query (or when query is empty).
  const showAnonymous =
    !exhausted &&
    (query.trim() === '' ||
      'anonymous'.includes(query.trim().toLowerCase()));

  useEffect(() => {
    if (!open || exhausted) return;
    let active = true;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const data = await searchPlayers(query, exclude, 100);
        if (active) setResults(data);
      } catch {
        if (active) setResults([]);
      } finally {
        if (active) setLoading(false);
      }
    }, 180);
    return () => {
      active = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open, selected.length, exhausted]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function add(p: ProfileLite) {
    // Anonymous can occupy multiple slots; real players cannot repeat.
    if (exhausted) return;
    if (p.id !== ANONYMOUS_ID && selected.some((s) => s.id === p.id)) return;
    onChange([...selected, p]);
    setQuery('');
    if (selected.length + 1 >= max) {
      setOpen(false);
      inputRef.current?.blur();
    } else {
      inputRef.current?.focus();
    }
  }

  // Remove a single occurrence at the given index. For non-anonymous
  // entries id-equality is sufficient, but anonymous can appear twice
  // so we need the index to pick the right chip.
  function removeAt(index: number) {
    onChange(selected.filter((_, i) => i !== index));
  }

  return (
    <div ref={containerRef} className="relative">
      <span className="block text-[10px] font-display uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-1">
        {label} <span className="text-zinc-400 dark:text-zinc-600">({selected.length}/{max})</span>
      </span>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map((p, i) => (
            <span
              key={`${p.id}:${i}`}
              className={`inline-flex items-center gap-1.5 rounded-full pl-1 pr-2 py-0.5 text-xs border ${
                p.id === ANONYMOUS_ID
                  ? 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-200 border-amber-300/50 dark:border-amber-400/30'
                  : 'bg-cyan2-100 dark:bg-cyan2-500/15 text-cyan2-700 dark:text-cyan2-200 border-cyan2-300/50 dark:border-cyan2-400/30'
              }`}
            >
              <Avatar profile={p} size={18} />
              <span className="max-w-[8rem] truncate">{p.display_name}</span>
              <button
                type="button"
                onClick={() => removeAt(i)}
                className="opacity-70 hover:opacity-100 leading-none"
                aria-label={`Remove ${p.display_name}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder={exhausted ? 'Slot full' : 'Search by display name…'}
        disabled={exhausted}
        className="w-full px-3 py-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 disabled:opacity-50 focus:outline-none focus:border-cyan2-400 focus:ring-1 focus:ring-cyan2-400/40 transition"
      />

      {open && !exhausted && (
        <div className="absolute z-20 left-0 right-0 mt-1 max-h-80 overflow-y-auto overscroll-contain rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-lg">
          {showAnonymous && (
            <button
              type="button"
              onClick={() => add(ANONYMOUS_PROFILE)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm border-b border-zinc-100 dark:border-zinc-800 bg-amber-50/50 dark:bg-amber-500/5 hover:bg-amber-100 dark:hover:bg-amber-500/10 text-zinc-900 dark:text-zinc-100 transition"
              title="Placeholder for a missing/unsigned player. Match needs admin approval."
            >
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-200/70 dark:bg-amber-500/30 text-amber-700 dark:text-amber-200 text-xs shrink-0">
                ?
              </span>
              <span className="flex-1 truncate">Anonymous</span>
              <span className="text-[9px] font-display tracking-widest uppercase text-amber-600 dark:text-amber-300">
                Guest
              </span>
            </button>
          )}
          {loading ? (
            <div className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-500">Searching…</div>
          ) : results.length === 0 && !showAnonymous ? (
            <div className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-500">No players found.</div>
          ) : (
            results.map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => add(p)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-zinc-900 dark:text-zinc-100 hover:bg-cyan2-50 dark:hover:bg-cyan2-500/10 transition"
              >
                <Avatar profile={p} size={24} />
                <span className="truncate">{p.display_name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function Avatar({ profile, size }: { profile: ProfileLite; size: number }) {
  if (profile.avatar_url) {
    return (
      <img
        src={profile.avatar_url}
        alt=""
        className="rounded-full object-cover border border-zinc-200 dark:border-zinc-700 shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 flex items-center justify-center font-semibold shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.5 }}
    >
      {profile.display_name?.[0]?.toUpperCase() ?? '?'}
    </span>
  );
}

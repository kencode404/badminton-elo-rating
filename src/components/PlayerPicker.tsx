import { useEffect, useRef, useState } from 'react';
import { searchPlayers } from '../lib/matches';
import type { Database } from '../lib/database.types';

type ProfileLite = Pick<Database['public']['Tables']['profiles']['Row'], 'id' | 'display_name' | 'avatar_url'>;

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

  const exclude = [...excludeIds, ...selected.map((s) => s.id)];
  const exhausted = selected.length >= max;

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
    if (selected.some((s) => s.id === p.id) || exhausted) return;
    onChange([...selected, p]);
    setQuery('');
    if (selected.length + 1 >= max) {
      setOpen(false);
      inputRef.current?.blur();
    } else {
      inputRef.current?.focus();
    }
  }

  function remove(id: string) {
    onChange(selected.filter((s) => s.id !== id));
  }

  return (
    <div ref={containerRef} className="relative">
      <span className="block text-[10px] font-display uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-1">
        {label} <span className="text-zinc-400 dark:text-zinc-600">({selected.length}/{max})</span>
      </span>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selected.map((p) => (
            <span
              key={p.id}
              className="inline-flex items-center gap-1.5 rounded-full bg-cyan2-100 dark:bg-cyan2-500/15 text-cyan2-700 dark:text-cyan2-200 border border-cyan2-300/50 dark:border-cyan2-400/30 pl-1 pr-2 py-0.5 text-xs"
            >
              <Avatar profile={p} size={18} />
              <span className="max-w-[8rem] truncate">{p.display_name}</span>
              <button
                type="button"
                onClick={() => remove(p.id)}
                className="text-cyan2-700/70 dark:text-cyan2-200/70 hover:text-cyan2-700 dark:hover:text-cyan2-100 leading-none"
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
          {loading ? (
            <div className="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-500">Searching…</div>
          ) : results.length === 0 ? (
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

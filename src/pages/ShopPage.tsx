import { useCallback, useEffect, useState } from 'react';
import { CoinIcon } from '../components/CoinIcon';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { formatError } from '../lib/errors';

// Shop v1 — shard balance + two shield products.
//
// Iron Shield (60s): blocks 50% of your next ELO loss.
// Aura Shield (110s): blocks 100% of your next ELO loss.
//
// One shield slot per player, shared across modes. Buying is blocked
// while a shield is armed; the slot clears server-side when the
// shield is consumed by a loss (wins / unsettled matches keep it).

type ShieldKind = 'iron' | 'aura';

interface ShopItem {
  kind: ShieldKind;
  name: string;
  tagline: string;
  description: string;
  price: number;
  accent: string;   // tailwind text color class
  ring: string;     // tailwind ring/border tint
}

const ITEMS: ShopItem[] = [
  {
    kind: 'iron',
    name: 'Iron Shield',
    tagline: 'Half the sting.',
    description: 'Blocks 50% of your next ELO loss.',
    price: 60,
    accent: 'text-sky-400',
    ring: 'border-sky-500/40',
  },
  {
    kind: 'aura',
    name: 'Aura Shield',
    tagline: 'Walk away unscathed.',
    description: 'Blocks 100% of your next ELO loss.',
    price: 110,
    accent: 'text-violet-400',
    ring: 'border-violet-500/40',
  },
];

export function ShopPage() {
  const { user } = useAuth();
  const [shards, setShards] = useState<number | null>(null);
  const [armed, setArmed] = useState<ShieldKind | null>(null);
  const [busyKind, setBusyKind] = useState<ShieldKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('profiles')
      .select('shards, armed_shield')
      .eq('id', user.id)
      .maybeSingle();
    if (error) {
      setError(formatError(error));
      return;
    }
    setShards(data?.shards ?? 0);
    setArmed((data?.armed_shield as ShieldKind | null) ?? null);
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function buy(kind: ShieldKind) {
    setBusyKind(kind);
    setError(null);
    const { data, error } = await supabase.rpc('buy_shield', { p_kind: kind });
    setBusyKind(null);
    if (error) {
      setError(formatError(error));
      return;
    }
    setShards((data as number | null) ?? 0);
    setArmed(kind);
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="section-title text-base">Shop</div>
        {/* Live balance chip */}
        <div className="inline-flex items-center gap-1.5 text-[11px] font-display tracking-widest uppercase text-cyan2-500 dark:text-cyan2-300 bg-cyan2-500/5 border border-cyan2-400/30 rounded-md px-2 py-0.5">
          <CoinIcon size={14} />
          {shards === null ? '…' : shards.toLocaleString()}
        </div>
      </div>

      {armed && (
        <div
          className={`glass-panel px-4 py-3 flex items-center gap-3 ${
            armed === 'iron' ? 'border-sky-400/40' : 'border-violet-400/40'
          }`}
        >
          <div className="text-2xl" aria-hidden>
            {armed === 'iron' ? '🛡' : '✦'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-display tracking-widest uppercase text-zinc-500 dark:text-zinc-400">
              Armed
            </div>
            <div className="text-sm text-zinc-900 dark:text-zinc-100">
              {armed === 'iron' ? 'Iron Shield' : 'Aura Shield'} — triggers on
              your next loss
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/40 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      <section className="space-y-2">
        <div className="section-title text-xs">Shields</div>
        {ITEMS.map((item) => {
          const canAfford = (shards ?? 0) >= item.price;
          const isOwned = armed === item.kind;
          const blockedByOther = armed !== null && !isOwned;
          const buying = busyKind === item.kind;
          return (
            <article
              key={item.kind}
              className={`glass-panel p-4 border ${item.ring}`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`shrink-0 w-12 h-12 rounded-xl flex items-center justify-center text-2xl border ${item.ring}`}
                  style={{
                    background:
                      item.kind === 'iron'
                        ? 'linear-gradient(135deg, #0c4a6e 0%, #1e3a8a 100%)'
                        : 'linear-gradient(135deg, #312e81 0%, #4c1d95 100%)',
                  }}
                  aria-hidden
                >
                  {item.kind === 'iron' ? '🛡' : '✦'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <h3 className={`font-display text-sm uppercase tracking-widest ${item.accent}`}>
                      {item.name}
                    </h3>
                    {isOwned && (
                      <span className="text-[9px] font-display uppercase tracking-widest text-emerald-400 border border-emerald-400/50 px-1.5 py-0.5 rounded">
                        Armed
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-500 italic">
                    {item.tagline}
                  </p>
                  <p className="text-xs text-zinc-700 dark:text-zinc-300 mt-1.5">
                    {item.description}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => buy(item.kind)}
                disabled={buying || isOwned || blockedByOther || !canAfford}
                className={`mt-3 w-full rounded-lg py-2 font-display tracking-widest uppercase text-[11px] transition border ${
                  isOwned
                    ? 'border-emerald-400/50 text-emerald-400 bg-emerald-500/5'
                    : blockedByOther
                      ? 'border-zinc-700 text-zinc-500'
                      : canAfford
                        ? 'cosmic-button'
                        : 'border-zinc-700 text-zinc-500'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {isOwned ? (
                  '✓ Armed'
                ) : blockedByOther ? (
                  `Other shield armed`
                ) : !canAfford ? (
                  `Need ${item.price - (shards ?? 0)} more`
                ) : buying ? (
                  'Buying…'
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    Buy
                    <CoinIcon size={12} glow={false} />
                    {item.price}
                  </span>
                )}
              </button>
            </article>
          );
        })}
      </section>

    </div>
  );
}

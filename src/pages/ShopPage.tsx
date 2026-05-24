import { useState } from 'react';
import { CoinIcon } from '../components/CoinIcon';
import { ShieldIcon } from '../components/ShieldIcon';
import { useAuth } from '../lib/auth';
import { useBuyShield, useMyProfile } from '../lib/queries';
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
  const { data: profile, error: profileError } = useMyProfile(user?.id);
  const buyMutation = useBuyShield(user?.id);
  const [busyKind, setBusyKind] = useState<ShieldKind | null>(null);

  const shards = profile?.shards ?? null;
  const armed = profile?.armed_shield ?? null;
  const error = profileError
    ? formatError(profileError)
    : buyMutation.error
      ? formatError(buyMutation.error)
      : null;

  function buy(kind: ShieldKind) {
    setBusyKind(kind);
    buyMutation.mutate(kind, { onSettled: () => setBusyKind(null) });
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="section-title text-base">Shop</div>
        {/* Live balance chip */}
        <div className="inline-flex items-center gap-2 text-sm font-display tracking-widest uppercase text-cyan2-500 dark:text-cyan2-300 bg-cyan2-500/5 border border-cyan2-400/30 rounded-md px-2.5 py-1">
          <CoinIcon size={22} />
          {shards === null ? '…' : shards.toLocaleString()}
        </div>
      </div>

      {armed && (
        <div className="glass-panel px-4 py-3 flex items-center gap-3 border-cyan2-400/40">
          <ShieldIcon kind={armed} size={42} />
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
                <ShieldIcon kind={item.kind} size={56} className="shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-baseline gap-2 min-w-0">
                      <h3 className={`font-display text-sm uppercase tracking-widest truncate ${item.accent}`}>
                        {item.name}
                      </h3>
                      {isOwned && (
                        <span className="text-[9px] font-display uppercase tracking-widest text-emerald-400 border border-emerald-400/50 px-1.5 py-0.5 rounded shrink-0">
                          Armed
                        </span>
                      )}
                    </div>
                    {/* Price chip — always visible so the cost reads even
                        when the buy button is disabled */}
                    <span className="inline-flex items-center gap-1.5 text-sm font-display tracking-widest text-cyan2-500 dark:text-cyan2-300 shrink-0">
                      <CoinIcon size={18} glow={false} />
                      {item.price}
                    </span>
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
                  <span className="inline-flex items-center gap-2">
                    Buy
                    <CoinIcon size={18} glow={false} />
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

import { useState } from 'react';
import { CoinIcon } from '../components/CoinIcon';
import { useAuth } from '../lib/auth';
import {
  useBuyBooster,
  useBuyPet,
  useBuyShield,
  useMyProfile,
  type PetKind,
} from '../lib/queries';
import { formatError } from '../lib/errors';
import { ratingToTier, TIERS } from '../lib/tiers';

// Tier rank lookup: bronze=1, silver=2, gold=3, diamond=4, predator=5.
// Mirrors public.tier_rank() in supabase/migrations/0004_chat.sql so
// client gating matches what buy_pet enforces server-side.
const TIER_RANK: Record<string, number> = {
  bronze: 1,
  silver: 2,
  gold: 3,
  diamond: 4,
  predator: 5,
};

function effectiveTierRank(rating: number, games: number): number {
  if (games < 5) return 0;
  return TIER_RANK[ratingToTier(rating).key] ?? 0;
}

function tierName(rank: number): string {
  return (
    TIERS.find((t) => TIER_RANK[t.key] === rank)?.name ?? `tier ${rank}`
  );
}

// Shop v1 — shard balance + two shield products.
//
// Iron Shield (60s): blocks 50% of your next ELO loss.
// Aura Shield (110s): blocks 100% of your next ELO loss.
//
// One shield slot per player, shared across modes. Buying is blocked
// while a shield is armed; the slot clears server-side when the
// shield is consumed by a loss (wins / unsettled matches keep it).

// DB enum value — kept as 'iron'/'aura' so the existing armed_shield
// column and check constraint still match. The display labels below
// rebrand them to Titanium/Vibranium.
type ShieldKind = 'iron' | 'aura';

interface ShopItem {
  kind: ShieldKind;
  name: string;
  tagline: string;
  description: string;
  price: number;
  image: string;    // path under /public
  accent: string;   // tailwind text color class
  ring: string;     // tailwind ring/border tint
}

const ITEMS: ShopItem[] = [
  {
    kind: 'iron',
    name: 'Titanium Shield',
    tagline: 'Half the sting.',
    description: 'Blocks 50% of your next loss.',
    price: 60,
    image: '/Titanium-shield.png',
    accent: 'text-sky-400',
    ring: 'border-sky-500/40',
  },
  {
    kind: 'aura',
    name: 'Vibranium Shield',
    tagline: 'Walk away unscathed.',
    description: 'Blocks 100% of your next loss.',
    price: 110,
    image: '/Vibranium-shield.png',
    accent: 'text-violet-400',
    ring: 'border-violet-500/40',
  },
];


// ---------------------------------------------------------------------------
// Boosters
// ---------------------------------------------------------------------------

type BoosterKind = 'shuttle';

interface BoosterItem {
  kind: BoosterKind;
  name: string;
  tagline: string;
  description: string;
  price: number;
  image: string;
  accent: string;
  ring: string;
}

const BOOSTERS: BoosterItem[] = [
  {
    kind: 'shuttle',
    name: 'Shuttle Strike',
    tagline: 'Finish strong.',
    description: 'Adds +5 points to your next win. Losses keep it armed.',
    price: 50,
    image: '/Platinum-shuttlecock.png',
    accent: 'text-cyan2-300',
    ring: 'border-cyan2-400/40',
  },
];


// ---------------------------------------------------------------------------
// Pets — permanent unlocks. Same price for all four; each is a
// different color variant of the same dino sprite (from the
// dinoCharactersVersion1.1 bundle).
// ---------------------------------------------------------------------------

interface PetItem {
  kind: PetKind;
  name: string;
  tagline: string;
  // Effect rows shown on the card. Passive applies just for owning;
  // Active fires only when this pet is deployed. Kept in sync with
  // 0014_pet_effects.sql.
  passive: string;
  active: string; // '—' when the pet has no active effect
  gif: string;
  accent: string;
  price: number;
  requiredTier: number; // tier rank required to purchase
}

const PASSIVE_LINE = '+1 shard / day';

// Listed cheapest → most expensive so the grid reads like a ladder.
const PETS: PetItem[] = [
  {
    kind: 'vita',
    name: 'Vita',
    tagline: 'Earthy green friend.',
    passive: PASSIVE_LINE,
    active: '—',
    gif: '/dinoCharactersVersion1.1/gifs/DinoSprites_vita.gif',
    accent: 'text-emerald-400',
    price: 350,
    requiredTier: 2, // silver+
  },
  {
    kind: 'tard',
    name: 'Tard',
    tagline: 'Sunny yellow pal.',
    passive: PASSIVE_LINE,
    active: '+1 point / win',
    gif: '/dinoCharactersVersion1.1/gifs/DinoSprites_tard.gif',
    accent: 'text-amber-400',
    price: 500,
    requiredTier: 3, // gold+
  },
  {
    kind: 'doux',
    name: 'Doux',
    tagline: 'Cool blue companion.',
    passive: PASSIVE_LINE,
    active: '+2 points / win',
    gif: '/dinoCharactersVersion1.1/gifs/DinoSprites_doux.gif',
    accent: 'text-sky-400',
    price: 600,
    requiredTier: 4, // diamond+
  },
  {
    kind: 'mort',
    name: 'Mort',
    tagline: 'Fiery red runner.',
    passive: PASSIVE_LINE,
    active: '-20% loss',
    gif: '/dinoCharactersVersion1.1/gifs/DinoSprites_mort.gif',
    accent: 'text-rose-400',
    price: 700,
    requiredTier: 5, // predator
  },
];


// Idle-only sprite renderer — uses the sprite sheet PNG (not the
// GIF) and a CSS keyframe that steps through the first 4 frames
// (the breathing idle), skipping the walk/kick/hurt animations baked
// into the same sheet. Scales the 24×24 native sprite up via
// transform: scale so it stays pixel-crisp.
//
// Tap / click triggers the hurt animation (frames 13-16) for one
// cycle, then snaps back to idle. Reacts on both desktop click and
// phone touch since onClick fires for both.
function DinoIdle({ kind, scale = 3 }: { kind: PetKind; scale?: number }) {
  const NATIVE = 24;
  const HURT_MS = 400;
  const sheet = `/dinoCharactersVersion1.1/sheets/DinoSprites - ${kind}.png`;
  const [isHurt, setIsHurt] = useState(false);

  function react() {
    setIsHurt(true);
    window.setTimeout(() => setIsHurt(false), HURT_MS);
  }

  const animation = isHurt
    ? `dino-hurt ${HURT_MS}ms steps(4) 1`
    : 'dino-idle 0.6s steps(4) infinite';

  return (
    <div
      onClick={react}
      onTouchStart={react}
      role="button"
      aria-label={`Poke ${kind}`}
      style={{
        width: NATIVE * scale,
        height: NATIVE * scale,
        overflow: 'hidden',
        cursor: 'pointer',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <div
        // key forces React to remount the inner div when the
        // animation flips, so the CSS animation restarts cleanly
        // even if the user pokes mid-cycle.
        key={isHurt ? 'hurt' : 'idle'}
        style={{
          width: NATIVE,
          height: NATIVE,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          backgroundImage: `url("${sheet}")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: '0 0',
          imageRendering: 'pixelated',
          animation,
        }}
      />
    </div>
  );
}

export function ShopPage() {
  const { user } = useAuth();
  const { data: profile, error: profileError } = useMyProfile(user?.id);
  const buyShieldMutation = useBuyShield(user?.id);
  const buyBoosterMutation = useBuyBooster(user?.id);
  const buyPetMutation = useBuyPet(user?.id);
  const [busyKind, setBusyKind] = useState<
    ShieldKind | BoosterKind | PetKind | null
  >(null);

  const shards = profile?.shards ?? null;
  const armed = profile?.armed_shield ?? null;
  const armedBooster = profile?.armed_booster ?? null;
  const ownedPets = profile?.owned_pets ?? [];
  const equippedPet = profile?.equipped_pet ?? null;
  // Best tier across singles+doubles — matches the server-side gate
  // in buy_pet (uses greatest(singles_tier, doubles_tier)).
  const bestTierRank = profile
    ? Math.max(
        effectiveTierRank(
          profile.singles_rating,
          profile.singles_games_played,
        ),
        effectiveTierRank(
          profile.doubles_rating,
          profile.doubles_games_played,
        ),
      )
    : 0;
  const error = profileError
    ? formatError(profileError)
    : buyShieldMutation.error
      ? formatError(buyShieldMutation.error)
      : buyBoosterMutation.error
        ? formatError(buyBoosterMutation.error)
        : buyPetMutation.error
          ? formatError(buyPetMutation.error)
          : null;

  function buy(kind: ShieldKind) {
    setBusyKind(kind);
    buyShieldMutation.mutate(kind, { onSettled: () => setBusyKind(null) });
  }

  function buyBooster(kind: BoosterKind) {
    setBusyKind(kind);
    buyBoosterMutation.mutate(kind, { onSettled: () => setBusyKind(null) });
  }

  function buyPet(kind: PetKind) {
    setBusyKind(kind);
    buyPetMutation.mutate(kind, { onSettled: () => setBusyKind(null) });
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
                <ShieldArt kind={item.kind} image={item.image} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className={`font-display text-sm uppercase tracking-widest truncate min-w-0 ${item.accent}`}>
                      {item.name}
                    </h3>
                    {/* Price chip — flips to "Armed" badge when this shield
                        is the currently armed one. */}
                    {isOwned ? (
                      <span className="inline-flex items-center text-[10px] font-display tracking-widest uppercase text-emerald-400 border border-emerald-400/50 px-2 py-0.5 rounded shrink-0">
                        Armed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-sm font-display tracking-widest text-cyan2-500 dark:text-cyan2-300 shrink-0">
                        <CoinIcon size={18} glow={false} />
                        {item.price}
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

      <section className="space-y-2">
        <div className="section-title text-xs">Boosters</div>
        {BOOSTERS.map((item) => {
          const canAfford = (shards ?? 0) >= item.price;
          const isOwned = armedBooster === item.kind;
          const blockedByOther = armedBooster !== null && !isOwned;
          const buying = busyKind === item.kind;
          return (
            <article
              key={item.kind}
              className={`glass-panel p-4 border ${item.ring}`}
            >
              <div className="flex items-start gap-3">
                <img
                  src={item.image}
                  alt=""
                  className="w-14 h-14 object-contain shrink-0"
                  aria-hidden
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className={`font-display text-sm uppercase tracking-widest truncate min-w-0 ${item.accent}`}>
                      {item.name}
                    </h3>
                    {isOwned ? (
                      <span className="inline-flex items-center text-[10px] font-display tracking-widest uppercase text-emerald-400 border border-emerald-400/50 px-2 py-0.5 rounded shrink-0">
                        Armed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-sm font-display tracking-widest text-cyan2-500 dark:text-cyan2-300 shrink-0">
                        <CoinIcon size={18} glow={false} />
                        {item.price}
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
                onClick={() => buyBooster(item.kind)}
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
                  `Other booster armed`
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

      <section className="space-y-2">
        <div className="section-title text-xs">Pets</div>
        <div className="grid grid-cols-2 gap-2">
          {PETS.map((pet) => {
            const owned = ownedPets.includes(pet.kind);
            const equipped = equippedPet === pet.kind;
            const canAfford = (shards ?? 0) >= pet.price;
            const tierLocked = bestTierRank < pet.requiredTier;
            const busy = busyKind === pet.kind;
            return (
              <article
                key={pet.kind}
                className="glass-panel p-3 flex flex-col items-center gap-2"
              >
                <DinoIdle kind={pet.kind} scale={3} />
                <div className="text-center w-full">
                  <h3
                    className={`font-display text-sm uppercase tracking-widest ${pet.accent}`}
                  >
                    {pet.name}
                  </h3>
                  <p className="text-[10px] text-zinc-500 dark:text-zinc-500 italic leading-tight">
                    {pet.tagline}
                  </p>
                  <div className="mt-1.5 space-y-0.5 text-[10px] leading-tight">
                    <div className="flex items-baseline gap-2">
                      <span className="font-display tracking-widest uppercase text-zinc-500 dark:text-zinc-500 shrink-0 w-14">
                        Passive
                      </span>
                      <span className="text-cyan2-500 dark:text-cyan2-300">
                        {pet.passive}
                      </span>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="font-display tracking-widest uppercase text-zinc-500 dark:text-zinc-500 shrink-0 w-14">
                        Active
                      </span>
                      <span
                        className={
                          pet.active === '—'
                            ? 'text-zinc-500 dark:text-zinc-500'
                            : 'text-emerald-500 dark:text-emerald-400'
                        }
                      >
                        {pet.active}
                      </span>
                    </div>
                  </div>
                </div>
                {owned ? (
                  <div
                    className={`w-full rounded-lg py-1.5 font-display tracking-widest uppercase text-[10px] text-center border ${
                      equipped
                        ? 'border-emerald-400/50 text-emerald-400 bg-emerald-500/5'
                        : 'border-zinc-700 text-zinc-400'
                    }`}
                  >
                    {equipped ? '✓ Equipped' : '✓ Owned'}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => buyPet(pet.kind)}
                    disabled={busy || tierLocked || !canAfford}
                    className={`w-full rounded-lg py-1.5 font-display tracking-widest uppercase text-[10px] transition border ${
                      tierLocked
                        ? 'border-amber-500/40 text-amber-500 bg-amber-500/5'
                        : canAfford
                          ? 'cosmic-button'
                          : 'border-zinc-700 text-zinc-500'
                    } disabled:opacity-60 disabled:cursor-not-allowed`}
                  >
                    {tierLocked ? (
                      `🔒 ${tierName(pet.requiredTier)}${pet.requiredTier < 5 ? '+' : ''}`
                    ) : !canAfford ? (
                      `Need ${pet.price - (shards ?? 0)}`
                    ) : busy ? (
                      'Buying…'
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <CoinIcon size={14} glow={false} />
                        {pet.price}
                      </span>
                    )}
                  </button>
                )}
              </article>
            );
          })}
        </div>
      </section>

    </div>
  );
}

// Per-shield artwork. Titanium is rendered smaller — it's the lower
// tier, so the size relationship reinforces hierarchy. Vibranium gets
// a purple→blue halo that scales/fades on a 2.4s loop plus a gentle
// bob on the shield itself.
function ShieldArt({ kind, image }: { kind: ShieldKind; image: string }) {
  if (kind === 'iron') {
    return (
      <img
        src={image}
        alt=""
        className="w-12 h-12 object-contain shrink-0"
        aria-hidden
      />
    );
  }
  return (
    <div className="relative w-16 h-16 shrink-0 flex items-center justify-center">
      {/* Purple→blue halo, scales up well beyond the shield silhouette
          and fades on loop. Negative inset gives it room to grow
          without being clipped by the image bounds. */}
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          inset: '-10px',
          background:
            'radial-gradient(circle, rgba(139, 92, 246, 0.7) 0%, rgba(59, 130, 246, 0.4) 40%, transparent 70%)',
          filter: 'blur(8px)',
          animation: 'vibranium-halo 2.4s ease-in-out infinite',
        }}
        aria-hidden
      />
      <img
        src={image}
        alt=""
        className="relative w-16 h-16 object-contain"
        aria-hidden
      />
    </div>
  );
}

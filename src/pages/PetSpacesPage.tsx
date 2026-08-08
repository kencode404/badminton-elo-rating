import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import {
  useClaimPetDaily,
  useEquipPet,
  useMyProfile,
  type PetKind,
} from '../lib/queries';
import { CoinIcon } from '../components/CoinIcon';

// Pet Spaces — dedicated page accessed from /profile.
//
// Layout:
//   * top "Equip" thumbnail strip — small icons of every pet the
//     player owns plus an "unequip" option. Tapping swaps which pet
//     is displayed on the leaderboard.
//   * playground room — an open space where the equipped pet wanders
//     around. Multiple motion modes (idle / kick / walk / sneak /
//     crouch) cycle randomly. Tapping the sprite directly triggers
//     the hurt reaction; tapping empty floor is ignored.
//
// previewMode (?preview=tiers) seeds all 4 pets owned + Mort
// equipped, with local equip swapping so the design can be inspected
// without any real purchases.

const PET_ORDER: PetKind[] = ['vita', 'tard', 'doux', 'mort'];
const NATIVE_PX = 24;

// Effect rates — kept in sync with public.claim_pet_daily() and
// public._settle_match_elo() in 0014_pet_effects.sql.
//
// Passive: every owned pet gives +1 shard/day. Stacks.
// Active (only the deployed pet):
//   vita — none
//   tard — +1 point on every win
//   doux — +2 points on every win
//   mort — keeps 80% of every loss (20% protection)
const PET_PASSIVE_RATE = 1; // shards / day per owned pet
function activeEffectFor(kind: PetKind | null): string | null {
  if (kind === 'tard') return '+1 point / win';
  if (kind === 'doux') return '+2 points / win';
  if (kind === 'mort') return '-20% loss';
  return null;
}

interface FlyingCoin {
  id: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  delay: number;
}

let flyingCoinCounter = 0;

export function PetSpacesPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const previewMode = searchParams.get('preview') === 'tiers';
  const { data: profile } = useMyProfile(user?.id);
  const equipMutation = useEquipPet(user?.id);
  const claimMutation = useClaimPetDaily(user?.id);
  const [flyingCoins, setFlyingCoins] = useState<FlyingCoin[]>([]);

  // Preview keeps its own equipped state so visitors can tap-swap
  // without touching the DB.
  const [previewEquipped, setPreviewEquipped] = useState<PetKind | null>(
    'mort',
  );

  const ownedPets: PetKind[] = previewMode
    ? ['vita', 'tard', 'doux', 'mort']
    : (profile?.owned_pets ?? []);
  const equippedPet: PetKind | null = previewMode
    ? previewEquipped
    : (profile?.equipped_pet ?? null);

  function setEquip(kind: PetKind | null) {
    if (previewMode) {
      setPreviewEquipped(kind);
      return;
    }
    equipMutation.mutate(kind);
  }

  // Pending pet shards = owned-pet count × whole days since last
  // payout. Computed client-side so the basket updates the moment
  // the day rolls over (no server call needed to display).
  const pendingShards = (() => {
    if (previewMode) return 6;
    if (!profile || ownedPets.length === 0) return 0;
    const last = new Date(profile.pets_last_payout_at).getTime();
    const daysSince = Math.floor((Date.now() - last) / (24 * 60 * 60 * 1000));
    return Math.max(0, daysSince * ownedPets.length);
  })();

  // Spawn 6 staggered shard icons that fly from the dragon-nest egg
  // to the Shop tab in the bottom nav, then disappear. Fires on both
  // real claim and preview (preview skips the RPC). Positions are
  // measured at click time so it works regardless of layout.
  function fireFlyEffect() {
    const source = document.querySelector(
      '[data-shard-source]',
    ) as HTMLElement | null;
    const target = document.querySelector(
      'a[href="/shop"]',
    ) as HTMLElement | null;
    if (!source || !target) return;
    const COIN_HALF = 10; // ~half of the 20px coin so the centre aligns
    const srcRect = source.getBoundingClientRect();
    const tgtRect = target.getBoundingClientRect();
    const fromX = srcRect.left + srcRect.width / 2 - COIN_HALF;
    const fromY = srcRect.top + srcRect.height / 2 - COIN_HALF;
    const toX = tgtRect.left + tgtRect.width / 2 - COIN_HALF;
    const toY = tgtRect.top + tgtRect.height / 2 - COIN_HALF;
    const coins: FlyingCoin[] = Array.from({ length: 6 }, (_, i) => {
      flyingCoinCounter += 1;
      return {
        id: flyingCoinCounter,
        fromX,
        fromY,
        toX,
        toY,
        delay: i * 70,
      };
    });
    setFlyingCoins((prev) => [...prev, ...coins]);
    // Auto-cleanup after the longest animation (700ms + last delay).
    window.setTimeout(() => {
      const ids = new Set(coins.map((c) => c.id));
      setFlyingCoins((prev) => prev.filter((c) => !ids.has(c.id)));
    }, 1500);
  }

  function collect() {
    if (pendingShards <= 0) return;
    fireFlyEffect();
    if (previewMode) return;
    claimMutation.mutate();
  }

  const ordered = PET_ORDER.filter((k) => ownedPets.includes(k));

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] font-mono tracking-[0.3em] uppercase text-cyan2-500 dark:text-cyan2-300">
            ▣ Companions
          </div>
          <h1 className="font-display tracking-[0.2em] uppercase text-base text-zinc-900 dark:text-zinc-100 mt-1">
            Pet Spaces
          </h1>
        </div>
        <Link
          to="/profile"
          className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-cyan2-500 transition uppercase tracking-widest font-display"
        >
          ← Back
        </Link>
      </div>

      {previewMode && (
        <div className="text-[10px] font-display tracking-widest uppercase text-cyan2-500 dark:text-cyan2-300 bg-cyan2-500/5 border border-cyan2-400/30 rounded-md px-3 py-2">
          Preview · click thumbnails to swap. Tap the pet to poke it.
        </div>
      )}

      {ownedPets.length === 0 ? (
        <section className="glass-panel p-6 text-center">
          <div className="text-3xl mb-2 text-cyan2-400" aria-hidden>
            ◇
          </div>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            You don't own any pets yet. Buy one from the{' '}
            <Link to="/shop" className="text-cyan2-500 dark:text-cyan2-300 underline">
              Shop
            </Link>{' '}
            to fill your room.
          </p>
        </section>
      ) : (
        <>
        <section className="glass-panel p-4 space-y-3">
          <PetEffectSummary owned={ordered} deployed={equippedPet} />

          {/* Deploy selector strip — choose which owned pet appears
              on the leaderboard. All owned pets still roam the room
              below; the deployed one gets an emerald glow. */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-display tracking-widest uppercase text-zinc-500 dark:text-zinc-400 mr-1">
              Deploy:
            </span>
            <PetThumb
              empty
              active={equippedPet === null}
              onClick={() => setEquip(null)}
            />
            {ordered.map((kind) => (
              <PetThumb
                key={kind}
                kind={kind}
                active={equippedPet === kind}
                onClick={() => setEquip(kind)}
              />
            ))}
          </div>

          {/* Playground — every owned pet wanders independently +
              the dragon-nest egg sits in the bottom-right corner. */}
          <PetPlayground
            pets={ordered}
            deployed={equippedPet}
          />
        </section>
        <NestEgg
          pending={pendingShards}
          busy={claimMutation.isPending}
          onSell={collect}
        />
        </>
      )}

      {/* Flying shard overlay — fixed-positioned so the coins travel
          in viewport coordinates regardless of any scroll/layout.
          Each coin self-cleans via the parent timer; pointer-events
          off so clicks underneath still register. */}
      {flyingCoins.map((c) => (
        <div
          key={c.id}
          aria-hidden
          className="fixed top-0 left-0 pointer-events-none z-[100]"
          style={
            {
              '--from-x': `${c.fromX}px`,
              '--from-y': `${c.fromY}px`,
              '--to-x': `${c.toX}px`,
              '--to-y': `${c.toY}px`,
              animation: `shard-fly 700ms ${c.delay}ms cubic-bezier(0.4, 0, 0.6, 1) forwards`,
            } as React.CSSProperties
          }
        >
          <CoinIcon size={20} glow={false} />
        </div>
      ))}
    </div>
  );
}

// Pet effect summary — passive total + the deployed pet's active
// effect (only the deployed pet contributes here; others sit idle).
function PetEffectSummary({
  owned,
  deployed,
}: {
  owned: PetKind[];
  deployed: PetKind | null;
}) {
  const dailyTotal = owned.length * PET_PASSIVE_RATE;
  const active = activeEffectFor(deployed);
  return (
    <div className="rounded-lg border border-cyan2-400/30 bg-cyan2-500/5 px-3 py-2 space-y-1">
      <div className="text-[10px] font-display tracking-widest uppercase text-zinc-500 dark:text-zinc-400">
        Pet Effects
      </div>
      <div className="flex items-center justify-between text-xs text-zinc-700 dark:text-zinc-300">
        <span>Passive · daily</span>
        <span className="inline-flex items-center gap-1.5 font-display text-cyan2-500 dark:text-cyan2-300">
          <CoinIcon size={14} glow={false} />+{dailyTotal} / day
        </span>
      </div>
      <div className="flex items-center justify-between text-xs text-zinc-700 dark:text-zinc-300">
        <span>
          Active ·{' '}
          <span className="text-zinc-500 dark:text-zinc-500">
            {deployed ? deployed : 'none deployed'}
          </span>
        </span>
        <span className="font-display text-emerald-500 dark:text-emerald-400">
          {active ?? '—'}
        </span>
      </div>
    </div>
  );
}

// Thumbnail in the equip-selector strip. Shows frame 0 of the sprite
// (or an ✕ glyph for the "none" / unequip slot). Emerald ring when
// this is the currently equipped choice.
function PetThumb({
  kind,
  empty,
  active,
  onClick,
}: {
  kind?: PetKind;
  empty?: boolean;
  active: boolean;
  onClick: () => void;
}) {
  const ring = active
    ? 'border-emerald-400 ring-1 ring-emerald-400/40'
    : 'border-zinc-300 dark:border-zinc-700 opacity-70 hover:opacity-100';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={empty ? 'Unequip' : `Equip ${kind}`}
      className={`relative w-9 h-9 rounded-md overflow-hidden border bg-zinc-100 dark:bg-zinc-900 transition ${ring}`}
    >
      {empty ? (
        <span className="absolute inset-0 flex items-center justify-center text-zinc-500 dark:text-zinc-500 text-xs">
          ✕
        </span>
      ) : (
        <div
          className="absolute"
          style={{
            left: 6,
            top: 6,
            width: NATIVE_PX,
            height: NATIVE_PX,
            backgroundImage: `url("/dinoCharactersVersion1.1/sheets/DinoSprites - ${kind}.png")`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: '0 0',
            imageRendering: 'pixelated',
          }}
        />
      )}
    </button>
  );
}

// Wandering playground. Pet picks a random destination, picks one of
// three move modes (50% walk / 25% sneak / 25% crouch), walks there
// with the matching duration + animation, idles a beat, and
// occasionally throws in a one-shot kick burst before the next
// trip. Tapping the sprite triggers a one-shot hurt animation;
// tapping empty floor is ignored.
type WalkMode = 'walk' | 'sneak' | 'crouch';
type IdleAction = 'idle' | 'kick';

function PetPlayground({
  pets,
  deployed,
}: {
  pets: PetKind[];
  deployed: PetKind | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Matches PlaygroundLandscape viewBox y where the metal floor
  // starts. The taller room gives the pets more space to roam.
  const ROOM_HEIGHT_PX = 360;
  const FLOOR_TOP_PX = 200;
  const FLOOR_HEIGHT_PX = ROOM_HEIGHT_PX - FLOOR_TOP_PX;
  return (
    <div
      ref={containerRef}
      className="relative rounded-lg border border-cyan2-400/30 overflow-hidden"
      style={{
        height: ROOM_HEIGHT_PX,
        // Cabin wall — extends full width on any screen
        background: 'linear-gradient(180deg, #0f172a 0%, #020617 100%)',
      }}
    >
      {/* Window — fixed 10:3 aspect, centered. Sized so the bottom
          sits just above the metal floor (14 top + 174 = 188 ≤ 200
          floor top). Caps at 580px wide so the planets stay round
          on desktop. */}
      <div
        className="absolute pointer-events-none"
        style={{
          top: 14,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(96%, 580px)',
          aspectRatio: '10 / 3',
        }}
      >
        <SpaceWindow />
      </div>

      {/* Floor — metal strip, full width so dinos always have ground */}
      <div
        className="absolute inset-x-0 bottom-0 pointer-events-none"
        style={{
          height: FLOOR_HEIGHT_PX,
          background:
            'linear-gradient(180deg, #1e293b 0%, #0a0a14 100%)',
          borderTop: '1px solid rgba(103, 232, 249, 0.4)',
        }}
      />
      {/* Floor perspective grid lines */}
      <div
        className="absolute inset-x-0 bottom-0 pointer-events-none"
        style={{
          height: FLOOR_HEIGHT_PX,
          backgroundImage:
            'repeating-linear-gradient(180deg, transparent 0, transparent 17px, rgba(103, 232, 249, 0.08) 17px, rgba(103, 232, 249, 0.08) 18px)',
        }}
      />
      {/* Scattered wall stars/rivets so the wide area isn't flat */}
      <div
        className="absolute inset-x-0 top-0 pointer-events-none"
        style={{
          height: FLOOR_TOP_PX,
          backgroundImage:
            'radial-gradient(circle at 5% 30%, rgba(255,255,255,0.7) 0, transparent 1.2px), radial-gradient(circle at 95% 25%, rgba(255,255,255,0.7) 0, transparent 1.2px), radial-gradient(circle at 2% 60%, rgba(255,255,255,0.5) 0, transparent 1px), radial-gradient(circle at 98% 60%, rgba(255,255,255,0.5) 0, transparent 1px)',
        }}
      />
      {pets.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-[10px] font-display tracking-widest uppercase text-zinc-500 dark:text-zinc-500">
            No pet available
          </span>
        </div>
      ) : (
        pets.map((p) => (
          <Wanderer
            key={p}
            kind={p}
            isDeployed={deployed === p}
            containerRef={containerRef}
            floorTopPx={FLOOR_TOP_PX}
          />
        ))
      )}

    </div>
  );
}

// Dragon nest tucked in the bottom-right corner of the playground.
// Tiny egg + tiny label + count badge; pulse halo + wiggle shake
// only when there are eggs to sell. Tap = fire the fly-effect +
// sell. Sprite has data-shard-source so the parent's fireFlyEffect
// can find it.
// Spaceship window — fixed 5:2 aspect SVG that fills its parent
// container (which is the centered window cutout). Aspect-preserving
// preserveAspectRatio so planets stay round on any screen width.
function SpaceWindow() {
  return (
    <svg
      className="w-full h-full"
      preserveAspectRatio="xMidYMid meet"
      viewBox="0 0 500 200"
      aria-hidden
    >
      <defs>
        <radialGradient id="space-view" cx="0.5" cy="0.45" r="0.9">
          <stop offset="0%" stopColor="#1e1b4b" />
          <stop offset="60%" stopColor="#0a0a2e" />
          <stop offset="100%" stopColor="#020617" />
        </radialGradient>
        {/* Earth-y blue planet — atmosphere + ocean ramp */}
        <radialGradient id="planet-blue" cx="0.35" cy="0.35" r="0.75">
          <stop offset="0%" stopColor="#dbeafe" />
          <stop offset="30%" stopColor="#60a5fa" />
          <stop offset="65%" stopColor="#1d4ed8" />
          <stop offset="100%" stopColor="#172554" />
        </radialGradient>
        {/* Ringed amber planet (Saturn-style) */}
        <radialGradient id="planet-amber" cx="0.32" cy="0.32" r="0.75">
          <stop offset="0%" stopColor="#fed7aa" />
          <stop offset="50%" stopColor="#c2410c" />
          <stop offset="100%" stopColor="#431407" />
        </radialGradient>
        {/* Distant nebula tint */}
        <radialGradient id="nebula" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#a855f7" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#a855f7" stopOpacity="0" />
        </radialGradient>
        <clipPath id="window-clip">
          <rect x="6" y="6" width="488" height="188" rx="26" />
        </clipPath>
      </defs>

      {/* Window opening (clipped so planets/stars don't escape) */}
      <rect x="6" y="6" width="488" height="188" rx="26" fill="url(#space-view)" />
      <g clipPath="url(#window-clip)" display="none">
        {/* Faint purple nebula off-center */}
        <ellipse cx="180" cy="90" rx="140" ry="80" fill="url(#nebula)" />

        {/* Stars — varied sizes + opacities for depth */}
        <g fill="#ffffff">
          <circle cx="40" cy="30" r="0.9" opacity="0.85" />
          <circle cx="75" cy="58" r="0.6" opacity="0.55" />
          <circle cx="118" cy="36" r="1.2" opacity="0.95" />
          <circle cx="158" cy="55" r="0.7" opacity="0.7" />
          <circle cx="208" cy="30" r="0.5" opacity="0.6" />
          <circle cx="250" cy="64" r="0.9" opacity="0.85" />
          <circle cx="302" cy="40" r="0.8" opacity="0.7" />
          <circle cx="360" cy="52" r="1.1" opacity="0.9" />
          <circle cx="412" cy="36" r="0.7" opacity="0.7" />
          <circle cx="456" cy="58" r="0.5" opacity="0.55" />
          <circle cx="34" cy="120" r="0.7" opacity="0.65" />
          <circle cx="92" cy="148" r="0.6" opacity="0.55" />
          <circle cx="172" cy="160" r="0.8" opacity="0.7" />
          <circle cx="240" cy="120" r="0.5" opacity="0.5" />
          <circle cx="328" cy="150" r="0.7" opacity="0.65" />
          <circle cx="400" cy="130" r="0.8" opacity="0.7" />
          <circle cx="460" cy="160" r="0.6" opacity="0.55" />
        </g>

        {/* Faint comet streak */}
        <line
          x1="320"
          y1="150"
          x2="390"
          y2="120"
          stroke="#67e8f9"
          strokeWidth="0.6"
          strokeOpacity="0.55"
          strokeLinecap="round"
        />
        <circle cx="392" cy="119" r="1.4" fill="#ecfeff" />

        {/* Big blue planet (left) */}
        <circle cx="120" cy="105" r="36" fill="url(#planet-blue)" />
        {/* Atmospheric edge glow */}
        <circle
          cx="120"
          cy="105"
          r="40"
          fill="none"
          stroke="#60a5fa"
          strokeWidth="1"
          strokeOpacity="0.4"
        />
        {/* Faint cloud bands */}
        <g stroke="#ffffff" strokeOpacity="0.12" fill="none">
          <path d="M 92 92 Q 120 80 148 92" strokeWidth="2.5" />
          <path d="M 90 116 Q 120 108 150 116" strokeWidth="2.5" />
        </g>

        {/* Small moon orbiting blue planet */}
        <circle cx="174" cy="76" r="6" fill="#e2e8f0" />
        <circle cx="172" cy="74" r="2" fill="#cbd5e1" opacity="0.6" />

        {/* Ringed amber planet (right) — back half of ring drawn
            first so the planet body overlays the front half. */}
        <g transform="rotate(-12 360 100)">
          <path
            d="M 318 100 A 42 7 0 0 1 402 100"
            fill="none"
            stroke="#fb923c"
            strokeWidth="1.4"
            strokeOpacity="0.6"
          />
        </g>
        <circle cx="360" cy="100" r="24" fill="url(#planet-amber)" />
        {/* Subtle banding on planet */}
        <g stroke="#7c2d12" strokeOpacity="0.35" fill="none">
          <path d="M 338 100 Q 360 96 382 100" strokeWidth="1" />
          <path d="M 340 110 Q 360 107 380 110" strokeWidth="1" />
        </g>
        <g transform="rotate(-12 360 100)">
          {/* Ring front half (in front of planet) */}
          <path
            d="M 318 100 A 42 7 0 0 0 402 100"
            fill="none"
            stroke="#fb923c"
            strokeWidth="1.4"
            strokeOpacity="0.85"
          />
        </g>
      </g>

      {/* Window frame — cyan accent, double-stroke for depth */}
      <rect x="6" y="6" width="488" height="188" rx="26" fill="#020617" />
      <g clipPath="url(#window-clip)">
        <image
          href="/space-window-deep-space.png"
          x="-4"
          y="2"
          width="508"
          height="196"
          preserveAspectRatio="none"
          className="space-window-photo"
        />
      </g>
      <rect
        x="6"
        y="6"
        width="488"
        height="188"
        rx="26"
        fill="none"
        stroke="#67e8f9"
        strokeWidth="2.5"
        strokeOpacity="0.55"
      />
      <rect
        x="10"
        y="10"
        width="480"
        height="180"
        rx="22"
        fill="none"
        stroke="#22d3ee"
        strokeWidth="0.7"
        strokeOpacity="0.3"
      />
    </svg>
  );
}

function NestEgg({
  pending,
  busy,
  onSell,
}: {
  pending: number;
  busy: boolean;
  onSell: () => void;
}) {
  const hasPending = pending > 0;
  return (
    <button
      type="button"
      onClick={onSell}
      disabled={busy || !hasPending}
      aria-label={
        hasPending
          ? `Sell ${pending} dragon egg${pending === 1 ? '' : 's'}`
          : 'No eggs to sell yet'
      }
      className={`fixed right-4 z-[8] flex flex-col items-center gap-0 bg-transparent p-0 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/80 rounded-full ${
        hasPending
          ? 'cursor-pointer hover:scale-105 active:scale-95'
          : 'opacity-50 cursor-not-allowed'
      }`}
      style={{ bottom: 'calc(6rem + env(safe-area-inset-bottom))' }}
    >
      <div className="relative w-32 h-32 flex items-center justify-center">
        {hasPending && (
          <div
            className="absolute rounded-full pointer-events-none"
            style={{
              inset: '-8px',
              background:
                'radial-gradient(circle, rgba(96, 165, 250, 0.7) 0%, rgba(59, 130, 246, 0.4) 40%, transparent 70%)',
              filter: 'blur(8px)',
              animation: 'dragon-egg-halo 2.4s ease-in-out infinite',
            }}
            aria-hidden
          />
        )}
        <img
          src="/dragon-egg.png"
          alt=""
          data-shard-source
          className="relative w-28 h-28 object-contain"
          style={
            hasPending
              ? {
                  animation:
                    'dragon-egg-shake 2.4s ease-in-out infinite',
                  transformOrigin: '50% 80%',
                }
              : undefined
          }
          aria-hidden
        />
        {hasPending && (
          <span className="absolute top-0 right-0 text-[10px] font-display tracking-widest text-amber-500 dark:text-amber-300 bg-zinc-900/90 border border-amber-400/50 rounded-full min-w-[22px] h-[22px] flex items-center justify-center px-1 z-10">
            {pending > 99 ? '99+' : pending}
          </span>
        )}
      </div>
      <span
        className={`-mt-1 text-[10px] font-display tracking-widest uppercase ${
          hasPending
            ? 'text-amber-500 dark:text-amber-300'
            : 'text-zinc-500 dark:text-zinc-500'
        }`}
      >
        {busy ? 'Selling…' : hasPending ? 'Tap to sell' : 'Empty'}
      </span>
    </button>
  );
}

// A single roaming dino. Owns its own wander state, drag state, and
// hurt timer so multiple Wanderers in the same room behave
// independently. The deployed pet gets an emerald glow.
function Wanderer({
  kind,
  isDeployed,
  containerRef,
  floorTopPx,
}: {
  kind: PetKind;
  isDeployed: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  // Min Y (in container pixels) where the dino is allowed to stand.
  // Wandering targets clamp to this; drag is free but releasing
  // above this Y triggers a fall back down to the floor.
  floorTopPx: number;
}) {
  // A slightly smaller sprite gives the expanded room a more
  // zoomed-out feel and leaves more room for each pet to wander.
  const SCALE = 2.5;
  const SPRITE_PX = NATIVE_PX * SCALE;
  // Travel times — walk is the slow stroll, sneak/crouch are the
  // faster variants. Both bumped slower overall vs. v1; the gap
  // between them is kept (sneak/crouch still faster than walk).
  const SLOW_MS = 4000;
  const FAST_MS = 3000;
  const HURT_MS = 400;
  const KICK_MS = 360;
  // Initial spawn: feet on the floor line.
  const SPAWN_Y = Math.max(0, floorTopPx - SPRITE_PX);
  const posRef = useRef({ x: 20, y: SPAWN_Y });
  const [pos, setPos] = useState({ x: 20, y: SPAWN_Y });
  const [walkMode, setWalkMode] = useState<WalkMode | null>(null);
  const [idleAction, setIdleAction] = useState<IdleAction>('idle');
  const [facingLeft, setFacingLeft] = useState(false);
  const [isHurt, setIsHurt] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isDropping, setIsDropping] = useState(false);
  const isHurtRef = useRef(false);
  const isDraggingRef = useRef(false);
  const isDroppingRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  isHurtRef.current = isHurt;
  isDraggingRef.current = isDragging;
  isDroppingRef.current = isDropping;

  useEffect(() => {
    let timer: number | undefined;

    function pickTarget() {
      const c = containerRef.current;
      if (!c) return null;
      const maxX = Math.max(0, c.clientWidth - SPRITE_PX);
      // Y is the TOP of the sprite. Feet sit at y + SPRITE_PX.
      // Highest stand position: feet exactly on the floor line
      //   → top y = floorTopPx − SPRITE_PX
      // Lowest stand position: feet at the bottom of the room
      //   → top y = clientHeight − SPRITE_PX
      const minY = Math.max(0, floorTopPx - SPRITE_PX);
      const maxY = Math.max(minY, c.clientHeight - SPRITE_PX);
      return {
        x: Math.random() * maxX,
        y: minY + Math.random() * (maxY - minY),
      };
    }

    function pickWalkMode(): WalkMode {
      const r = Math.random();
      if (r < 0.5) return 'walk';
      if (r < 0.75) return 'sneak';
      return 'crouch';
    }

    function startWalk() {
      if (
        isHurtRef.current ||
        isDraggingRef.current ||
        isDroppingRef.current
      ) {
        timer = window.setTimeout(startWalk, 500);
        return;
      }
      const t = pickTarget();
      if (!t) {
        timer = window.setTimeout(startWalk, 500);
        return;
      }
      const mode = pickWalkMode();
      const dur = mode === 'walk' ? SLOW_MS : FAST_MS;
      setFacingLeft(t.x < posRef.current.x);
      posRef.current = t;
      setPos(t);
      setIdleAction('idle');
      setWalkMode(mode);
      timer = window.setTimeout(arrive, dur);
    }

    function arrive() {
      setWalkMode(null);
      const pauseMs = 900 + Math.random() * 2200;
      // 30% chance to play a one-shot kick partway through the pause
      if (Math.random() < 0.3 && pauseMs > KICK_MS + 400) {
        const kickAfter = 250 + Math.random() * (pauseMs - KICK_MS - 400);
        timer = window.setTimeout(() => {
          setIdleAction('kick');
          timer = window.setTimeout(() => {
            setIdleAction('idle');
            const remainder = Math.max(
              300,
              pauseMs - kickAfter - KICK_MS,
            );
            timer = window.setTimeout(startWalk, remainder);
          }, KICK_MS);
        }, kickAfter);
      } else {
        timer = window.setTimeout(startWalk, pauseMs);
      }
    }

    const initial = pickTarget();
    if (initial) {
      posRef.current = initial;
      setPos(initial);
    }
    timer = window.setTimeout(startWalk, 500);

    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [kind, SPRITE_PX]);

  // Press/drag interaction: pressing the sprite triggers hurt and
  // captures the pointer; moving while held drags the dino directly
  // (clamped to the room); releasing ends the drag and lets hurt
  // linger one more cycle before wandering resumes.
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    e.preventDefault();
    const target = e.currentTarget;
    const rect = target.getBoundingClientRect();
    dragOffsetRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      // ignore — pointer capture not always available
    }
    // Cancel any walk-in-progress so the CSS transition doesn't
    // fight pointer-driven position updates.
    setWalkMode(null);
    setIsHurt(true);
    setIsDragging(true);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!isDraggingRef.current) return;
    const c = containerRef.current;
    if (!c) return;
    const containerRect = c.getBoundingClientRect();
    let x = e.clientX - containerRect.left - dragOffsetRef.current.x;
    let y = e.clientY - containerRect.top - dragOffsetRef.current.y;
    const maxX = Math.max(0, c.clientWidth - SPRITE_PX);
    const maxY = Math.max(0, c.clientHeight - SPRITE_PX);
    x = Math.max(0, Math.min(x, maxX));
    y = Math.max(0, Math.min(y, maxY));
    posRef.current = { x, y };
    setPos({ x, y });
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!isDraggingRef.current) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    setIsDragging(false);

    // If released above the legal stand range (feet above the
    // floor line), drop down with a gravity-like transition. Same
    // bounds the wander loop uses — minY = floor line minus the
    // sprite height.
    const c = containerRef.current;
    const minY = Math.max(0, floorTopPx - SPRITE_PX);
    if (c && posRef.current.y < minY) {
      const maxY = Math.max(minY, c.clientHeight - SPRITE_PX);
      const dropY = minY + Math.random() * (maxY - minY);
      const dropped = { x: posRef.current.x, y: dropY };
      posRef.current = dropped;
      setPos(dropped);
      setIsDropping(true);
      // Drop duration + small linger; then resume idle.
      const DROP_MS = 600;
      window.setTimeout(() => {
        setIsDropping(false);
        setIsHurt(false);
      }, DROP_MS + 80);
    } else {
      // Released inside the floor band — normal hurt linger.
      window.setTimeout(() => setIsHurt(false), HURT_MS);
    }
  }

  let animation: string;
  if (isDragging) {
    // Loop hurt continuously while the player is dragging.
    animation = 'dino-hurt 0.4s steps(4) infinite';
  } else if (isHurt) {
    animation = `dino-hurt ${HURT_MS}ms steps(4) 1`;
  } else if (walkMode === 'walk') {
    animation = 'dino-move 0.7s steps(6) infinite';
  } else if (walkMode === 'sneak') {
    animation = 'dino-sneak 0.5s steps(4) infinite';
  } else if (walkMode === 'crouch') {
    animation = 'dino-crouch 0.5s steps(3) infinite';
  } else if (idleAction === 'kick') {
    animation = `dino-kick ${KICK_MS}ms steps(3) 1`;
  } else {
    animation = 'dino-idle 0.6s steps(4) infinite';
  }

  const walkDur =
    walkMode === 'walk' ? SLOW_MS : walkMode ? FAST_MS : 0;
  const transition = isDropping
    ? // Gravity-feel fall: starts gentle and accelerates toward
      // the floor. cubic-bezier(0.55, 0, 0.85, 0.25) is the
      // "ease-in" used widely for drop animations.
      'top 600ms cubic-bezier(0.55, 0, 0.85, 0.25)'
    : walkMode && !isDragging
      ? `left ${walkDur}ms linear, top ${walkDur}ms linear`
      : 'none';

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="button"
      aria-label={`Drag ${kind} to play`}
      className={`absolute select-none ${
        isDragging ? 'cursor-grabbing' : 'cursor-grab'
      }`}
      style={{
        left: pos.x,
        top: pos.y,
        width: SPRITE_PX,
        height: SPRITE_PX,
        transition,
        // scaleX flips horizontally based on facing direction; keep
        // it on the wrapper so the deployed glow doesn't get flipped.
        transform: facingLeft ? 'scaleX(-1)' : 'scaleX(1)',
        // Deployed pet floats above the others when overlapping.
        zIndex: isDeployed ? 5 : 1,
        WebkitTapHighlightColor: 'transparent',
        // 'none' lets touch-drag work without browser scrolling
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        // Soft emerald halo when this is the leaderboard pet.
        filter: isDeployed
          ? 'drop-shadow(0 0 6px rgba(52, 211, 153, 0.85)) drop-shadow(0 0 2px rgba(52, 211, 153, 0.85))'
          : 'none',
      }}
    >
      <div
        // Key remounts the inner div whenever the active animation
        // category changes so one-shot animations (hurt, kick)
        // restart cleanly from frame 1. Drag state is separate so
        // the looped-hurt during drag and the one-shot hurt on
        // release each get their own clean lifecycle.
        key={
          isDragging
            ? 'drag'
            : isHurt
                ? 'hurt'
                : walkMode
                  ? `walk-${walkMode}`
                  : `idle-${idleAction}`
          }
          style={{
            width: NATIVE_PX,
            height: NATIVE_PX,
            transform: `scale(${SCALE})`,
            transformOrigin: 'top left',
            backgroundImage: `url("/dinoCharactersVersion1.1/sheets/DinoSprites - ${kind}.png")`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: '0 0',
            imageRendering: 'pixelated',
            animation,
          }}
        />
    </div>
  );
}

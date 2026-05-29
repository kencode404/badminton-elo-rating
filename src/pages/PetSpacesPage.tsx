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
        <section className="glass-panel p-4 space-y-3">
          <PetNestBasket
            pending={pendingShards}
            busy={claimMutation.isPending}
            onCollect={collect}
          />

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

          {/* Playground — every owned pet wanders independently */}
          <PetPlayground pets={ordered} deployed={equippedPet} />
        </section>
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

// Pet nest basket — your pets lay eggs over time (passive income).
// The whole basket is the sell-eggs button: trade all eggs for
// shards 1:1 (server enforces via claim_pet_daily). Eggs visually
// scatter inside the basket; up to 8 distinct sprites, then a
// "+N" count to keep the layout tight.
function PetNestBasket({
  pending,
  busy,
  onCollect,
}: {
  pending: number;
  busy: boolean;
  onCollect: () => void;
}) {
  const hasPending = pending > 0;
  return (
    <button
      type="button"
      onClick={onCollect}
      disabled={busy || !hasPending}
      className={`relative w-full rounded-lg border px-3 py-3 transition text-left ${
        hasPending
          ? 'border-amber-400/60 bg-gradient-to-b from-amber-500/10 to-amber-700/10 hover:from-amber-500/15 hover:to-amber-700/15 cursor-pointer'
          : 'border-zinc-300 dark:border-zinc-700 bg-zinc-100/30 dark:bg-zinc-900/40 cursor-not-allowed opacity-70'
      }`}
    >
      <div className="flex items-center gap-3">
        {/* Dragon egg with a growing blue halo behind it. Egg count
            is shown as a small badge instead of multiple sprites. */}
        <div className="relative shrink-0 w-24 h-24 flex items-center justify-center">
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
            className={`relative w-20 h-20 object-contain ${
              hasPending ? '' : 'opacity-40'
            }`}
            aria-hidden
          />
          {pending > 0 && (
            <span className="absolute top-0 right-0 text-[10px] font-display tracking-widest text-amber-500 dark:text-amber-300 bg-zinc-900/85 border border-amber-400/50 rounded-full min-w-[20px] h-5 flex items-center justify-center px-1 z-10">
              {pending > 99 ? '99+' : pending}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-display tracking-widest uppercase text-zinc-500 dark:text-zinc-400">
            Dragon Nest
          </div>
          {hasPending ? (
            <>
              <div className="text-[11px] text-zinc-700 dark:text-zinc-300">
                <span className="font-display text-amber-500 dark:text-amber-400">
                  {pending}
                </span>{' '}
                egg{pending === 1 ? '' : 's'} ready
              </div>
              <div className="inline-flex items-center gap-1.5 mt-1 text-[11px] font-display tracking-widest uppercase text-amber-500 dark:text-amber-300">
                {busy ? 'Selling…' : 'Sell for'}
                <CoinIcon size={14} glow={false} />
                {pending}
              </div>
            </>
          ) : (
            <div className="text-[11px] text-zinc-500 dark:text-zinc-500 mt-0.5">
              Empty nest · check back tomorrow
            </div>
          )}
        </div>
      </div>
    </button>
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
  return (
    <div
      ref={containerRef}
      className="relative rounded-lg border border-cyan2-400/30 overflow-hidden"
      style={{
        height: 260,
        background:
          'linear-gradient(180deg, rgba(34, 211, 238, 0.06) 0%, rgba(15, 23, 42, 0.65) 100%)',
      }}
    >
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
          />
        ))
      )}
    </div>
  );
}

// A single roaming dino. Owns its own wander state, drag state, and
// hurt timer so multiple Wanderers in the same room behave
// independently. The deployed pet gets an emerald glow.
function Wanderer({
  kind,
  isDeployed,
  containerRef,
}: {
  kind: PetKind;
  isDeployed: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const SCALE = 3;
  const SPRITE_PX = NATIVE_PX * SCALE;
  // Travel times — walk is the slow stroll, sneak/crouch are the
  // faster variants. Both bumped slower overall vs. v1; the gap
  // between them is kept (sneak/crouch still faster than walk).
  const SLOW_MS = 4000;
  const FAST_MS = 3000;
  const HURT_MS = 400;
  const KICK_MS = 360;
  const posRef = useRef({ x: 20, y: 20 });
  const [pos, setPos] = useState({ x: 20, y: 20 });
  const [walkMode, setWalkMode] = useState<WalkMode | null>(null);
  const [idleAction, setIdleAction] = useState<IdleAction>('idle');
  const [facingLeft, setFacingLeft] = useState(false);
  const [isHurt, setIsHurt] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const isHurtRef = useRef(false);
  const isDraggingRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  isHurtRef.current = isHurt;
  isDraggingRef.current = isDragging;

  useEffect(() => {
    let timer: number | undefined;

    function pickTarget() {
      const c = containerRef.current;
      if (!c) return null;
      const maxX = Math.max(0, c.clientWidth - SPRITE_PX);
      const maxY = Math.max(0, c.clientHeight - SPRITE_PX);
      return { x: Math.random() * maxX, y: Math.random() * maxY };
    }

    function pickWalkMode(): WalkMode {
      const r = Math.random();
      if (r < 0.5) return 'walk';
      if (r < 0.75) return 'sneak';
      return 'crouch';
    }

    function startWalk() {
      if (isHurtRef.current || isDraggingRef.current) {
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
    // Brief hurt linger after release before normal wander resumes.
    window.setTimeout(() => setIsHurt(false), HURT_MS);
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
  const transition =
    walkMode && !isDragging
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

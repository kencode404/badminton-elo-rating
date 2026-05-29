import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { TierBadge } from '../components/TierBadge';
import { ratingStatus, TIERS } from '../lib/tiers';
import { PastSeasonRow } from '../components/PastSeasonRow';
import { PeakTiers } from '../components/PeakTiers';
import { supabase } from '../lib/supabase';
import { AvatarCropModal } from '../components/AvatarCropModal';
import type { Database } from '../lib/database.types';

type Profile = Database['public']['Tables']['profiles']['Row'];

export function ProfilePage() {
  const { user, signOut } = useAuth();
  const [searchParams] = useSearchParams();
  const previewMode = searchParams.get('preview') === 'tiers';
  const [profile, setProfile] = useState<Profile | null>(null);
  const [winCounts, setWinCounts] = useState<{ singles: number; doubles: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);

  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  type SnapshotRow = {
    season_number: number;
    archived_at: string;
    singles_rating: number;
    doubles_rating: number;
    singles_games_played: number;
    doubles_games_played: number;
    singles_wins: number;
    doubles_wins: number;
    singles_rank: number | null;
    doubles_rank: number | null;
  };
  const [snapshots, setSnapshots] = useState<SnapshotRow[] | null>(null);

  // ?preview=tiers also seeds three mock past-season snapshots so the
  // new Past Seasons Record layout can be inspected before any reset
  // has actually run.
  const displayedSnapshots: SnapshotRow[] | null = previewMode
    ? [
        {
          season_number: 3,
          archived_at: new Date().toISOString(),
          singles_rating: 1310,
          doubles_rating: 1480,
          singles_games_played: 22,
          doubles_games_played: 28,
          singles_wins: 14,
          doubles_wins: 19,
          singles_rank: 4,
          doubles_rank: 1,
        },
        {
          season_number: 2,
          archived_at: new Date().toISOString(),
          singles_rating: 1180,
          doubles_rating: 1260,
          singles_games_played: 18,
          doubles_games_played: 24,
          singles_wins: 9,
          doubles_wins: 14,
          singles_rank: 9,
          doubles_rank: 5,
        },
        {
          season_number: 1,
          archived_at: new Date().toISOString(),
          singles_rating: 1095,
          doubles_rating: 1140,
          singles_games_played: 12,
          doubles_games_played: 16,
          singles_wins: 5,
          doubles_wins: 7,
          singles_rank: 17,
          doubles_rank: 12,
        },
        ...(snapshots ?? []),
      ]
    : snapshots;

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true);
    supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setError(error.message);
        else setProfile(data);
        setLoading(false);
      });
    supabase
      .rpc('get_user_win_counts', { p_user_id: user.id })
      .then(({ data }) => {
        if (!active) return;
        const row = (data ?? [])[0] as
          | { singles_wins: number; doubles_wins: number }
          | undefined;
        setWinCounts({
          singles: row?.singles_wins ?? 0,
          doubles: row?.doubles_wins ?? 0,
        });
      });
    supabase
      .from('season_snapshots')
      .select(
        'season_number, archived_at, singles_rating, doubles_rating, singles_games_played, doubles_games_played, singles_wins, doubles_wins, singles_rank, doubles_rank',
      )
      .eq('user_id', user.id)
      .order('season_number', { ascending: false })
      .limit(5)
      .then(({ data }) => {
        if (!active) return;
        setSnapshots((data ?? []) as SnapshotRow[]);
      });
    return () => {
      active = false;
    };
  }, [user]);

  async function saveName() {
    if (!user || !profile) return;
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === profile.display_name) {
      setEditingName(false);
      return;
    }
    setSavingName(true);
    setError(null);
    const { data, error } = await supabase
      .from('profiles')
      .update({ display_name: trimmed })
      .eq('id', user.id)
      .select()
      .maybeSingle();
    setSavingName(false);
    if (error) {
      setError(error.message);
      return;
    }
    if (data) setProfile(data);
    setEditingName(false);
  }

  function onFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    setError(null);
    setPendingFile(file);
  }

  async function uploadCroppedBlob(blob: Blob) {
    if (!user) return;
    setUploadingAvatar(true);
    setError(null);
    try {
      const path = `${user.id}/avatar.jpg`;
      const { error: uploadErr } = await supabase.storage
        .from('avatars')
        .upload(path, blob, {
          contentType: 'image/jpeg',
          upsert: true,
          cacheControl: '3600',
        });
      if (uploadErr) throw uploadErr;

      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
      const url = `${pub.publicUrl}?v=${Date.now()}`;

      const { data, error: updateErr } = await supabase
        .from('profiles')
        .update({ avatar_url: url })
        .eq('id', user.id)
        .select()
        .maybeSingle();
      if (updateErr) throw updateErr;
      if (data) setProfile(data);
      setPendingFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadingAvatar(false);
    }
  }

  const displayName =
    profile?.display_name ??
    (user?.user_metadata?.display_name as string | undefined) ??
    user?.email?.split('@')[0] ??
    'Player';

  return (
    <div className="p-4 space-y-4">
      <section className="glass-panel p-6 text-center">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadingAvatar}
          className="relative mx-auto block w-24 h-24 rounded-2xl overflow-hidden border border-cyan2-400/40 group"
          style={{
            background: 'linear-gradient(135deg, #18181b 0%, #27272a 100%)',
            boxShadow: '0 0 18px rgba(34, 211, 238, 0.4)',
          }}
          aria-label="Change avatar"
        >
          {profile?.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="flex items-center justify-center w-full h-full text-3xl text-white" aria-hidden>
              ◆
            </span>
          )}
          <span
            className="absolute inset-0 bg-black/55 text-white text-[10px] uppercase tracking-widest font-display flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
          >
            Change
          </span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onFileSelected}
        />

        {editingName ? (
          <div className="mt-4 flex flex-col gap-2 max-w-xs mx-auto">
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              maxLength={15}
              className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-center text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-cyan2-400 focus:ring-1 focus:ring-cyan2-400/40"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={saveName}
                disabled={savingName}
                className="cosmic-button flex-1 text-xs"
              >
                {savingName ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => setEditingName(false)}
                className="cosmic-button-ghost flex-1 text-xs"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setNameDraft(profile?.display_name ?? displayName);
              setEditingName(true);
            }}
            className="mt-4 inline-flex items-center gap-2 group"
          >
            <h2 className="font-display tracking-[0.2em] text-base text-zinc-900 dark:text-zinc-100 uppercase">
              {displayName}
            </h2>
            <span className="text-cyan2-500 dark:text-cyan2-300 text-xs opacity-60 group-hover:opacity-100 transition" aria-hidden>
              ✎
            </span>
          </button>
        )}
        <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-1">{user?.email}</p>
        <div className="flex justify-center">
          <PeakTiers profile={profile} size="sm" />
        </div>
      </section>

      {error && (
        <div className="text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/40 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      <section className="glass-panel p-5">
        <div className="section-title mb-3">Current Season</div>
        {loading ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-500">Loading…</p>
        ) : profile ? (
          <div className="grid grid-cols-2 gap-3">
            <Stat
              label="Doubles"
              rating={profile.doubles_rating}
              games={profile.doubles_games_played}
              wins={winCounts?.doubles ?? 0}
            />
            <Stat
              label="Singles"
              rating={profile.singles_rating}
              games={profile.singles_games_played}
              wins={winCounts?.singles ?? 0}
            />
          </div>
        ) : (
          <p className="text-sm text-zinc-500 dark:text-zinc-500">
            No profile found. Run the database migration if you haven't yet.
          </p>
        )}
      </section>

      <Link
        to="/pets"
        className="glass-panel w-full p-4 flex items-center justify-between border-cyan2-400/40 dark:border-cyan2-500/30 border-dashed hover:border-cyan2-400/80 transition group"
      >
        <div className="flex items-center gap-3">
          <span
            className="w-9 h-9 rounded-lg flex items-center justify-center border border-cyan2-400/40 overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, #0e2f53 0%, #18181b 100%)',
            }}
            aria-hidden
          >
            {profile?.equipped_pet ? (
              <div
                style={{
                  width: 24,
                  height: 24,
                  backgroundImage: `url("/dinoCharactersVersion1.1/sheets/DinoSprites - ${profile.equipped_pet}.png")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: '0 0',
                  imageRendering: 'pixelated',
                  animation: 'dino-idle 0.6s steps(4) infinite',
                }}
              />
            ) : (
              <span className="text-cyan2-400/70 text-base leading-none">◇</span>
            )}
          </span>
          <div className="text-left">
            <div className="font-display uppercase tracking-widest text-cyan2-500 dark:text-cyan2-300 text-sm">
              Pet Spaces
            </div>
            <div className="text-[10px] text-zinc-500 dark:text-zinc-500 uppercase tracking-widest mt-0.5">
              Equip & play
            </div>
          </div>
        </div>
        <span className="text-zinc-400 dark:text-zinc-600 group-hover:text-cyan2-400 transition" aria-hidden>
          →
        </span>
      </Link>

      {previewMode && (
        <section className="glass-panel p-5">
          <div className="text-[10px] font-display tracking-widest uppercase text-cyan2-500 dark:text-cyan2-300 bg-cyan2-500/5 border border-cyan2-400/30 rounded-md px-3 py-2 mb-3">
            Preview · mock per-tier stat cards
          </div>
          <div className="grid grid-cols-2 gap-3">
            {TIERS.map((t, i) => {
              // Park each preview rating in the middle of its bracket so
              // the progress bar shows ~50% for every card.
              const next = TIERS[i + 1];
              const previewRating = next
                ? Math.round((t.minRating + next.minRating - 1) / 2)
                : t.minRating + 80;
              return (
                <Stat
                  key={t.key}
                  label={t.name}
                  rating={previewRating}
                  games={20}
                  wins={12}
                />
              );
            })}
            <Stat label="Placement" rating={1000} games={2} wins={1} />
          </div>
        </section>
      )}

      <section className="glass-panel p-5">
        <div className="section-title mb-3">Past Seasons Record</div>
        {displayedSnapshots === null ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-500">Loading…</p>
        ) : displayedSnapshots.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            No archived seasons yet.
          </p>
        ) : (
          <ul className="space-y-3">
            {displayedSnapshots.map((s) => (
              <PastSeasonRow key={s.season_number} snapshot={s} />
            ))}
          </ul>
        )}
      </section>

      {profile?.is_admin && (
        <Link
          to="/admin"
          className="glass-panel w-full p-4 flex items-center justify-between border-red-400/40 dark:border-red-500/30 border-dashed hover:border-red-400/80 transition group"
        >
          <div className="flex items-center gap-3">
            <span
              className="w-9 h-9 rounded-lg flex items-center justify-center text-red-500 dark:text-red-400 border border-red-400/40"
              style={{
                background: 'linear-gradient(135deg, #2a0d0d 0%, #18181b 100%)',
              }}
              aria-hidden
            >
              ⚙
            </span>
            <div className="text-left">
              <div className="font-display uppercase tracking-widest text-red-500 dark:text-red-400 text-sm">
                Apex Command
              </div>
              <div className="text-[10px] text-zinc-500 dark:text-zinc-500 uppercase tracking-widest mt-0.5">
                Admin Access
              </div>
            </div>
          </div>
          <span className="text-zinc-400 dark:text-zinc-600 group-hover:text-red-400 transition" aria-hidden>
            →
          </span>
        </Link>
      )}

      <Link
        to="/scoring-guide"
        className="glass-panel w-full p-4 flex items-center justify-between hover:border-cyan2-400/60 transition group"
      >
        <div className="flex items-center gap-3">
          <span
            className="w-9 h-9 rounded-lg flex items-center justify-center text-cyan2-500 dark:text-cyan2-300 border border-cyan2-400/40"
            style={{
              background: 'linear-gradient(135deg, #18181b 0%, #27272a 100%)',
            }}
            aria-hidden
          >
            ?
          </span>
          <div className="text-left">
            <div className="text-[10px] font-display uppercase tracking-widest text-cyan2-500 dark:text-cyan2-300">
              Help
            </div>
            <div className="text-sm text-zinc-900 dark:text-zinc-100">
              How ratings work
            </div>
          </div>
        </div>
        <span className="text-zinc-400 dark:text-zinc-600 group-hover:text-cyan2-500 transition" aria-hidden>
          →
        </span>
      </Link>

      <button
        type="button"
        onClick={() => signOut()}
        className="cosmic-button-ghost w-full text-sm"
      >
        Sign out
      </button>

      {pendingFile && (
        <AvatarCropModal
          file={pendingFile}
          onCancel={() => setPendingFile(null)}
          onConfirm={uploadCroppedBlob}
          saving={uploadingAvatar}
        />
      )}
    </div>
  );
}


function Stat({
  label,
  rating,
  games,
  wins,
}: {
  label: string;
  rating: number;
  games: number;
  wins: number;
}) {
  const winRate = games > 0 ? Math.round((wins / games) * 100) : null;
  const status = ratingStatus(rating, games);
  // After placement, the card picks up the tier's accent border + a
  // soft tier-tinted background so the card matches what the player
  // sees on the leaderboard. Placement cards stay neutral.
  const tintStyle: React.CSSProperties =
    status.kind === 'tier'
      ? {
          borderColor: status.tier.rowBorder,
          background: `linear-gradient(135deg, ${status.tier.rowBg} 0%, transparent 60%)`,
        }
      : {};
  return (
    <div
      className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3"
      style={tintStyle}
    >
      <div className="text-[10px] font-display uppercase tracking-wider text-cyan2-500 dark:text-cyan2-300">
        {label}
      </div>
      <div className="font-display text-2xl mt-1 text-zinc-900 dark:text-zinc-100">{rating}</div>
      <div className="mt-1">
        <TierBadge status={status} size={20} showName />
      </div>
      <div className="text-[10px] text-zinc-500 dark:text-zinc-500 mt-1 uppercase tracking-wider">
        {games} games
      </div>
      <div className="text-[10px] text-zinc-700 dark:text-zinc-300 mt-0.5 font-display tracking-wider">
        {winRate !== null ? `${wins} wins · ${winRate}% rate` : '— no games'}
      </div>
    </div>
  );
}


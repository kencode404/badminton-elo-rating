import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { AvatarCropModal } from '../components/AvatarCropModal';
import type { Database } from '../lib/database.types';

type Profile = Database['public']['Tables']['profiles']['Row'];

export function ProfilePage() {
  const { user, signOut } = useAuth();
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
              maxLength={40}
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
      </section>

      {error && (
        <div className="text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/40 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      <section className="glass-panel p-5">
        <div className="section-title mb-3">Ratings</div>
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

      <section className="glass-panel p-5">
        <div className="section-title mb-3">Match History</div>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Past matches and rating changes will appear here.
        </p>
      </section>

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
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3">
      <div className="text-[10px] font-display uppercase tracking-wider text-cyan2-500 dark:text-cyan2-300">
        {label}
      </div>
      <div className="font-display text-2xl mt-1 text-zinc-900 dark:text-zinc-100">{rating}</div>
      <div className="text-[10px] text-zinc-500 dark:text-zinc-500 mt-0.5 uppercase tracking-wider">
        {games} games
      </div>
      <div className="text-[10px] text-zinc-700 dark:text-zinc-300 mt-1 font-display tracking-wider">
        {winRate !== null ? `${wins}W · ${winRate}%` : '— no games'}
      </div>
    </div>
  );
}

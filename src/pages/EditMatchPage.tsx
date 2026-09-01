import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { updateMatchOnlineOrQueue } from '../lib/matches';
import { getQueuedMatchEdit } from '../lib/offline';
import { PlayerPicker } from '../components/PlayerPicker';
import { ANONYMOUS_ID } from '../lib/anonymous';
import { formatError } from '../lib/errors';
import type { Database, MatchType, Team } from '../lib/database.types';

type ProfileLite = Pick<
  Database['public']['Tables']['badminton_profiles']['Row'],
  'id' | 'display_name' | 'avatar_url'
>;

export function EditMatchPage() {
  const { matchId } = useParams<{ matchId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [matchType, setMatchType] = useState<MatchType | null>(null);
  const [partner, setPartner] = useState<ProfileLite[]>([]);
  const [opponents, setOpponents] = useState<ProfileLite[]>([]);
  const [scoreA, setScoreA] = useState('');
  const [scoreB, setScoreB] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hadQueuedEdit, setHadQueuedEdit] = useState(false);

  // Load match + participants. Prefer a locally-queued edit (set by an
  // earlier offline submission for this match) over the server state.
  useEffect(() => {
    if (!matchId || !user) return;
    let active = true;

    async function load() {
      const { data: match, error: mErr } = await supabase
        .from('badminton_matches')
        .select('id, match_type, created_by, status, score_a, score_b')
        .eq('id', matchId!)
        .maybeSingle();
      if (!active) return;
      if (mErr) {
        setError(formatError(mErr));
        setLoading(false);
        return;
      }
      if (!match) {
        setError('Match not found');
        setLoading(false);
        return;
      }
      if (match.created_by !== user!.id) {
        setError('Only the match creator can edit it');
        setLoading(false);
        return;
      }
      if (match.status !== 'pending') {
        setError('Match is no longer pending — cannot edit');
        setLoading(false);
        return;
      }

      setMatchType(match.match_type as MatchType);

      const { data: parts } = await supabase
        .from('badminton_match_participants')
        .select(
          'user_id, team, confirmation, profiles:user_id(id, display_name, avatar_url)',
        )
        .eq('match_id', matchId!);
      if (!active) return;

      // Guard: a REAL player (not anonymous) besides the creator
      // already accepted → block. Anonymous's auto-acceptance doesn't
      // count — matches the server-side guard in update_pending_match.
      const externalAccepted = (parts ?? []).some(
        (p) =>
          (p as { user_id: string; confirmation: string }).user_id !==
            user!.id &&
          (p as { user_id: string }).user_id !== ANONYMOUS_ID &&
          (p as { confirmation: string }).confirmation === 'accepted',
      );
      if (externalAccepted) {
        setError(
          'Cannot edit — another player has already accepted this match',
        );
        setLoading(false);
        return;
      }

      type Joined = {
        user_id: string;
        team: Team;
        profiles: ProfileLite | null;
      };
      const flat = (parts ?? []) as unknown as Joined[];
      const serverPartner = flat
        .filter((p) => p.team === 'A' && p.user_id !== user!.id)
        .map((p) => p.profiles)
        .filter((p): p is ProfileLite => Boolean(p));
      const serverOpps = flat
        .filter((p) => p.team === 'B')
        .map((p) => p.profiles)
        .filter((p): p is ProfileLite => Boolean(p));

      // Overlay any locally-queued edit so the user sees their pending
      // changes even offline.
      const queued = await getQueuedMatchEdit(matchId!);
      if (!active) return;
      if (queued) {
        setHadQueuedEdit(true);
        setScoreA(String(queued.score_a));
        setScoreB(String(queued.score_b));
        if (queued.partner_id) {
          // Look up the queued partner's profile from server data or
          // a separate fetch.
          const all = [...serverPartner, ...serverOpps];
          const found = all.find((p) => p.id === queued.partner_id);
          if (found) setPartner([found]);
          else {
            const { data: prof } = await supabase
              .from('badminton_profiles')
              .select('id, display_name, avatar_url')
              .eq('id', queued.partner_id)
              .maybeSingle();
            if (prof) setPartner([prof]);
          }
        } else {
          setPartner([]);
        }
        if (queued.opponent_ids.length > 0) {
          const allKnown = new Map<string, ProfileLite>();
          for (const p of [...serverPartner, ...serverOpps]) allKnown.set(p.id, p);
          const missing = queued.opponent_ids.filter((id) => !allKnown.has(id));
          if (missing.length > 0) {
            const { data: profs } = await supabase
              .from('badminton_profiles')
              .select('id, display_name, avatar_url')
              .in('id', missing);
            for (const p of (profs ?? []) as ProfileLite[]) allKnown.set(p.id, p);
          }
          setOpponents(
            queued.opponent_ids
              .map((id) => allKnown.get(id))
              .filter((p): p is ProfileLite => Boolean(p)),
          );
        }
      } else {
        setScoreA(String(match.score_a));
        setScoreB(String(match.score_b));
        setPartner(serverPartner);
        setOpponents(serverOpps);
      }
      setLoading(false);
    }

    load();
    return () => {
      active = false;
    };
  }, [matchId, user]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user || !matchId || !matchType) return;
    setError(null);

    const a = Number(scoreA);
    const b = Number(scoreB);
    if (!Number.isInteger(a) || !Number.isInteger(b)) {
      setError('Scores must be whole numbers');
      return;
    }
    if (a === b) {
      setError('Scores cannot be tied');
      return;
    }
    if (a < 0 || b < 0) {
      setError('Scores cannot be negative');
      return;
    }
    if (matchType === 'singles' && opponents.length !== 1) {
      setError('Pick 1 opponent');
      return;
    }
    if (matchType === 'doubles' && (partner.length !== 1 || opponents.length !== 2)) {
      setError('Pick 1 partner and 2 opponents');
      return;
    }

    setSubmitting(true);
    try {
      const participantNames = [
        ...partner.map((p) => p.display_name),
        ...opponents.map((p) => p.display_name),
      ];
      const result = await updateMatchOnlineOrQueue(
        {
          matchId,
          partnerId: matchType === 'doubles' ? partner[0]?.id ?? null : null,
          opponentIds: opponents.map((p) => p.id),
          scoreA: a,
          scoreB: b,
        },
        participantNames,
      );
      if (result.kind === 'queued') {
        navigate('/record?edit_queued=1', { replace: true });
      } else {
        navigate('/record', { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update match');
    } finally {
      setSubmitting(false);
    }
  }

  if (!user) return null;
  const excludeIds = [user.id];

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="section-title text-base">Edit Match</div>
        <button
          type="button"
          onClick={() => navigate('/record')}
          className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-cyan2-500 transition uppercase tracking-widest font-display"
        >
          ← Back
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-500">Loading…</p>
      ) : error && !matchType ? (
        <div className="text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/40 rounded-md px-3 py-2">
          {error}
        </div>
      ) : (
        <>
          {hadQueuedEdit && (
            <div className="text-[10px] font-display tracking-widest uppercase text-amber-500 dark:text-amber-400 bg-amber-500/5 border border-amber-400/30 rounded-md px-3 py-2">
              Editing your previously queued offline edit
            </div>
          )}

          <div className="text-[10px] font-display uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
            Match type:{' '}
            <span className="text-cyan2-500 dark:text-cyan2-300">
              {matchType}
            </span>{' '}
            (not editable)
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <section className="glass-panel p-4 space-y-3">
              <div className="text-[11px] font-display uppercase tracking-widest text-cyan2-500 dark:text-cyan2-300">
                Your Team
              </div>
              {matchType === 'doubles' && (
                <PlayerPicker
                  label="Partner"
                  max={1}
                  selected={partner}
                  onChange={setPartner}
                  excludeIds={[...excludeIds, ...opponents.map((o) => o.id)]}
                />
              )}
              <PlayerPicker
                label={matchType === 'singles' ? 'Opponent' : 'Opponents'}
                max={matchType === 'singles' ? 1 : 2}
                selected={opponents}
                onChange={setOpponents}
                excludeIds={[...excludeIds, ...partner.map((p) => p.id)]}
              />
            </section>

            <section className="glass-panel p-4">
              <div className="text-[11px] font-display uppercase tracking-widest text-cyan2-500 dark:text-cyan2-300 mb-3">
                Score
              </div>
              <div className="flex items-center gap-3">
                <ScoreInput label="Your Team" value={scoreA} onChange={setScoreA} />
                <span className="font-display text-2xl text-zinc-400 dark:text-zinc-600">:</span>
                <ScoreInput label="Opponent Team" value={scoreB} onChange={setScoreB} />
              </div>
              <p className="text-[10px] text-zinc-500 dark:text-zinc-500 mt-2">
                Higher score wins. No ties.
              </p>
            </section>

            {error && (
              <div className="text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/40 rounded-md px-3 py-2">
                {error}
              </div>
            )}

            <button type="submit" disabled={submitting} className="cosmic-button w-full">
              {submitting ? 'Saving…' : 'Save changes'}
            </button>

            <p className="text-[11px] text-zinc-500 dark:text-zinc-500 text-center">
              Editing resets the lineup. You stay accepted; everyone else
              starts pending.
            </p>
          </form>
        </>
      )}
    </div>
  );
}

function ScoreInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex-1">
      <span className="block text-[10px] font-display uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-1 text-center">
        {label}
      </span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-center font-display text-3xl py-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-cyan2-400 focus:ring-1 focus:ring-cyan2-400/40 transition"
      />
    </label>
  );
}

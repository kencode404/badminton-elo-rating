import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { createMatch } from '../lib/matches';
import { PlayerPicker } from '../components/PlayerPicker';
import type { Database, MatchType } from '../lib/database.types';

type ProfileLite = Pick<Database['public']['Tables']['profiles']['Row'], 'id' | 'display_name' | 'avatar_url'>;

export function NewMatchPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [matchType, setMatchType] = useState<MatchType>('doubles');
  const [partner, setPartner] = useState<ProfileLite[]>([]);
  const [opponents, setOpponents] = useState<ProfileLite[]>([]);
  const [scoreA, setScoreA] = useState('');
  const [scoreB, setScoreB] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function changeType(t: MatchType) {
    setMatchType(t);
    setPartner([]);
    setOpponents([]);
    setError(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setError(null);

    const a = Number(scoreA);
    const b = Number(scoreB);
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isInteger(a) || !Number.isInteger(b)) {
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
      await createMatch({
        matchType,
        creatorId: user.id,
        partnerId: matchType === 'doubles' ? partner[0]?.id : undefined,
        opponentIds: opponents.map((p) => p.id),
        scoreA: a,
        scoreB: b,
      });
      navigate('/record', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record match');
    } finally {
      setSubmitting(false);
    }
  }

  if (!user) return null;
  const excludeIds = [user.id];

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="section-title text-base">New Match</div>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-cyan2-500 transition uppercase tracking-widest font-display"
        >
          ← Back
        </button>
      </div>

      <div className="flex glass-panel p-1">
        {(['doubles', 'singles'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => changeType(t)}
            className={`flex-1 py-2 rounded-lg text-xs font-display tracking-wider uppercase transition ${
              matchType === t
                ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                : 'text-zinc-500 dark:text-zinc-400'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <section className="glass-panel p-4 space-y-3">
          <div className="text-[11px] font-display uppercase tracking-widest text-cyan2-500 dark:text-cyan2-300">
            Team A (you)
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
            <ScoreInput label="Team A" value={scoreA} onChange={setScoreA} />
            <span className="font-display text-2xl text-zinc-400 dark:text-zinc-600">:</span>
            <ScoreInput label="Team B" value={scoreB} onChange={setScoreB} />
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
          {submitting ? 'Submitting…' : 'Submit for confirmation'}
        </button>

        <p className="text-[11px] text-zinc-500 dark:text-zinc-500 text-center">
          Other players will be asked to confirm. Ratings update only after everyone accepts.
        </p>
      </form>
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

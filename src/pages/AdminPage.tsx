import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { formatError } from '../lib/errors';
import { ANONYMOUS_ID } from '../lib/anonymous';
import type { Database, MatchType, Team } from '../lib/database.types';

type Profile = Database['public']['Tables']['profiles']['Row'];
type ProfileLite = Pick<
  Profile,
  | 'id'
  | 'display_name'
  | 'avatar_url'
  | 'is_admin'
  | 'is_banned'
  | 'banned_at'
  | 'banned_reason'
>;

const RESET_PHRASE = 'RESET SEASON';

// Admin control panel — gated behind profile.is_admin. The whole page
// has a "system maintenance" / blueprint look: monospace status pills,
// dashed borders, sci-fi headers. Three modules:
//   1) Season Reset — type-to-confirm, archives + zeroes the season.
//   2) Ban User — search + reason + ban button.
//   3) Banned Roster — banned profiles + Unban button per row.
export function AdminPage() {
  const { user } = useAuth();
  const [me, setMe] = useState<Profile | null>(null);
  const [loadingMe, setLoadingMe] = useState(true);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoadingMe(true);
    supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        setMe(data ?? null);
        setLoadingMe(false);
      });
    return () => {
      active = false;
    };
  }, [user]);

  if (loadingMe) {
    return (
      <div className="p-4">
        <p className="text-sm text-zinc-500 dark:text-zinc-500">Loading…</p>
      </div>
    );
  }

  if (!me?.is_admin) {
    return <Navigate to="/profile" replace />;
  }

  return (
    <div
      className="p-4 space-y-4"
      style={{
        backgroundImage:
          'repeating-linear-gradient(0deg, rgba(34, 211, 238, 0.04) 0 1px, transparent 1px 32px), repeating-linear-gradient(90deg, rgba(34, 211, 238, 0.04) 0 1px, transparent 1px 32px)',
      }}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] font-mono tracking-[0.3em] uppercase text-cyan2-500 dark:text-cyan2-300">
            ▣ System Control
          </div>
          <h1 className="font-display tracking-[0.2em] uppercase text-base text-zinc-900 dark:text-zinc-100 mt-1">
            Apex Command
          </h1>
        </div>
        <Link
          to="/profile"
          className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-cyan2-500 transition uppercase tracking-widest font-display"
        >
          ← Back
        </Link>
      </div>

      <div className="text-[10px] font-mono tracking-widest uppercase text-zinc-500 dark:text-zinc-400 flex flex-wrap gap-3">
        <span>
          OPERATOR:{' '}
          <span className="text-cyan2-500 dark:text-cyan2-300">
            {me.display_name}
          </span>
        </span>
        <span>STATUS: <span className="text-emerald-500">ONLINE</span></span>
        <span>CLEARANCE: <span className="text-cyan2-500 dark:text-cyan2-300">FULL</span></span>
      </div>

      <AnonymousApprovalCard />
      <SeasonResetCard />
      <BanUserCard adminId={me.id} />
      <BannedRosterCard />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Anonymous-match approval — matches that include the "Anonymous" guest
// player don't auto-settle. They land in status='awaiting_admin' and
// wait for one admin to approve (runs ELO) or reject. Existence of this
// gate is the abuse-prevention layer for the anonymous feature.
// ---------------------------------------------------------------------------

interface PendingAnon {
  match_id: string;
  match_type: MatchType;
  score_a: number;
  score_b: number;
  created_at: string;
  creator_name: string;
  team_a: { user_id: string; display_name: string }[];
  team_b: { user_id: string; display_name: string }[];
}

function AnonymousApprovalCard() {
  const [rows, setRows] = useState<PendingAnon[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    // Fetch awaiting_admin matches. The migration's RLS update lets
    // admins read these even when they're not participants.
    const { data: matches, error: e1 } = await supabase
      .from('matches')
      .select('id, match_type, score_a, score_b, played_at, created_by')
      .eq('status', 'awaiting_admin')
      .order('played_at', { ascending: false });
    if (e1) {
      setError(formatError(e1));
      return;
    }
    if (!matches || matches.length === 0) {
      setRows([]);
      return;
    }
    const ids = matches.map((m) => m.id);
    const creatorIds = Array.from(new Set(matches.map((m) => m.created_by)));

    const [{ data: parts, error: e2 }, { data: profs, error: e3 }] =
      await Promise.all([
        supabase
          .from('match_participants')
          .select('match_id, user_id, team, profiles:user_id(display_name)')
          .in('match_id', ids),
        supabase
          .from('profiles')
          .select('id, display_name')
          .in('id', creatorIds),
      ]);
    if (e2 || e3) {
      setError(formatError(e2 ?? e3));
      return;
    }

    type PartRow = {
      match_id: string;
      user_id: string;
      team: Team;
      profiles: { display_name: string } | null;
    };
    const partsCast = (parts ?? []) as unknown as PartRow[];
    const creatorMap = new Map(
      (profs ?? []).map((p) => [p.id, p.display_name]),
    );

    const built: PendingAnon[] = matches.map((m) => {
      const mine = partsCast.filter((p) => p.match_id === m.id);
      const map = (team: Team) =>
        mine
          .filter((p) => p.team === team)
          .map((p) => ({
            user_id: p.user_id,
            display_name:
              p.user_id === ANONYMOUS_ID
                ? 'Anonymous'
                : p.profiles?.display_name ?? 'Unknown',
          }));
      return {
        match_id: m.id,
        match_type: m.match_type as MatchType,
        score_a: m.score_a,
        score_b: m.score_b,
        created_at: m.played_at,
        creator_name: creatorMap.get(m.created_by) ?? 'Unknown',
        team_a: map('A'),
        team_b: map('B'),
      };
    });
    setRows(built);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(matchId: string, action: 'approve' | 'reject') {
    setBusyId(matchId);
    setError(null);
    const fn =
      action === 'approve' ? 'approve_anonymous_match' : 'reject_anonymous_match';
    const { error } = await supabase.rpc(fn, { p_match_id: matchId });
    setBusyId(null);
    if (error) {
      setError(formatError(error));
      return;
    }
    await load();
  }

  return (
    <section className="glass-panel p-5 border-amber-400/40 dark:border-amber-500/30 border-dashed">
      <div className="text-[10px] font-mono tracking-widest uppercase text-amber-500 dark:text-amber-400 mb-1">
        ⚠ MODULE: ANON-MATCH-REVIEW
      </div>
      <h2 className="section-title mb-2 text-amber-500 dark:text-amber-400">
        Pending Approval
      </h2>
      <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-3">
        Matches that include the Anonymous guest player don't auto-
        settle. Approve to run ELO and confirm; reject to discard with
        no rating change. Anonymous's own rating never moves.
      </p>

      {error && (
        <div className="text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/40 rounded-md px-3 py-2 mb-3">
          {error}
        </div>
      )}

      {rows === null ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs font-mono tracking-widest uppercase text-zinc-500 dark:text-zinc-500">
          No matches awaiting approval.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((m) => (
            <li
              key={m.match_id}
              className="rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-2 space-y-2"
            >
              <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-widest">
                <span className="text-cyan2-500 dark:text-cyan2-300">
                  {m.match_type}
                </span>
                <span className="text-zinc-500">
                  by {m.creator_name} · {formatDateTime(m.created_at)}
                </span>
              </div>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-xs">
                <TeamCell players={m.team_a} />
                <div className="font-display text-lg text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                  {m.score_a}
                  <span className="text-zinc-400 mx-1">:</span>
                  {m.score_b}
                </div>
                <TeamCell players={m.team_b} alignRight />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => act(m.match_id, 'reject')}
                  disabled={busyId === m.match_id}
                  className="flex-1 rounded-lg border border-red-400/40 dark:border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 font-display tracking-widest uppercase text-[11px] py-2 transition disabled:opacity-50"
                >
                  {busyId === m.match_id ? '…' : 'Reject'}
                </button>
                <button
                  type="button"
                  onClick={() => act(m.match_id, 'approve')}
                  disabled={busyId === m.match_id}
                  className="flex-1 rounded-lg border border-emerald-400/60 dark:border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-display tracking-widest uppercase text-[11px] py-2 transition disabled:opacity-50"
                >
                  {busyId === m.match_id ? '…' : 'Approve'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TeamCell({
  players,
  alignRight = false,
}: {
  players: { user_id: string; display_name: string }[];
  alignRight?: boolean;
}) {
  return (
    <div
      className={`space-y-0.5 ${alignRight ? 'text-right' : ''}`}
    >
      {players.map((p, i) => (
        <div
          key={`${p.user_id}:${i}`}
          className={
            p.user_id === ANONYMOUS_ID
              ? 'text-amber-600 dark:text-amber-300 truncate'
              : 'text-zinc-900 dark:text-zinc-100 truncate'
          }
        >
          {p.display_name}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Season reset
// ---------------------------------------------------------------------------

function SeasonResetCard() {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  async function runReset() {
    if (confirmText.trim().toUpperCase() !== RESET_PHRASE) return;
    setResetting(true);
    setError(null);
    const { data, error } = await supabase.rpc('reset_season');
    setResetting(false);
    if (error) {
      setError(formatError(error));
      return;
    }
    setDone((data as number | null) ?? null);
    setOpen(false);
    setConfirmText('');
  }

  return (
    <section className="glass-panel p-5 border-red-400/40 dark:border-red-500/30 border-dashed">
      <div className="text-[10px] font-mono tracking-widest uppercase text-red-500 dark:text-red-400 mb-1">
        ⚠ MODULE: SEASON-RESET
      </div>
      <h2 className="section-title mb-2 text-red-500 dark:text-red-400">
        Season Reset
      </h2>
      <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-3">
        Archives every player's current ratings into a past-season
        snapshot, opens a new season, and resets the club to 1000
        with 0 games. Banned players are reset behind the scenes
        but stay banned. Stale streak/tier announcements in chat
        are cleared.
        <strong className="text-red-500 dark:text-red-400"> This cannot be undone.</strong>
      </p>

      {done !== null && (
        <div className="text-[10px] font-mono tracking-widest uppercase text-emerald-500 bg-emerald-500/5 border border-emerald-500/30 rounded-md px-3 py-2 mb-3">
          ✓ SEASON {done} OPENED
        </div>
      )}

      {error && (
        <div className="text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/40 rounded-md px-3 py-2 mb-3">
          {error}
        </div>
      )}

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full rounded-lg border border-red-400/60 dark:border-red-500/40 bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 font-display tracking-widest uppercase text-xs py-2 transition"
        >
          Reset Season…
        </button>
      ) : (
        <div className="space-y-2">
          <label
            htmlFor="reset-confirm"
            className="text-[10px] font-display tracking-widest uppercase text-zinc-600 dark:text-zinc-400 block"
          >
            Type <span className="text-red-500 dark:text-red-400">{RESET_PHRASE}</span> to confirm:
          </label>
          <input
            id="reset-confirm"
            autoFocus
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            disabled={resetting}
            spellCheck={false}
            autoComplete="off"
            className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-900 dark:text-zinc-100 font-mono focus:outline-none focus:border-red-400 focus:ring-1 focus:ring-red-400/40 disabled:opacity-50"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setConfirmText('');
              }}
              disabled={resetting}
              className="flex-1 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-display tracking-widest uppercase text-xs py-2 transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={runReset}
              disabled={
                resetting ||
                confirmText.trim().toUpperCase() !== RESET_PHRASE
              }
              className="flex-1 rounded-lg border border-red-400/60 dark:border-red-500/40 bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 font-display tracking-widest uppercase text-xs py-2 transition disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {resetting ? 'Resetting…' : 'Confirm Reset'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Ban user
// ---------------------------------------------------------------------------

function BanUserCard({ adminId }: { adminId: string }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<ProfileLite[]>([]);
  const [target, setTarget] = useState<ProfileLite | null>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Search profiles by display name. Excludes admin self and already
  // banned users (those have their own roster below).
  useEffect(() => {
    let active = true;
    const trimmed = search.trim();
    if (trimmed.length < 1) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url, is_admin, is_banned, banned_at, banned_reason')
        .ilike('display_name', `%${trimmed}%`)
        .eq('is_banned', false)
        .eq('is_admin', false)
        .eq('is_anonymous', false)
        .neq('id', adminId)
        .order('display_name')
        .limit(20);
      if (active) setResults((data ?? []) as ProfileLite[]);
    }, 200);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [search, adminId]);

  async function ban() {
    if (!target) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    const { error } = await supabase.rpc('ban_user', {
      p_target_id: target.id,
      p_reason: reason.trim() || null,
    });
    setSubmitting(false);
    if (error) {
      setError(formatError(error));
      return;
    }
    setSuccess(`${target.display_name} has been banned.`);
    setTarget(null);
    setSearch('');
    setReason('');
  }

  return (
    <section className="glass-panel p-5 border-amber-400/40 dark:border-amber-500/30 border-dashed">
      <div className="text-[10px] font-mono tracking-widest uppercase text-amber-500 dark:text-amber-400 mb-1">
        ⚠ MODULE: ACCESS-REVOKE
      </div>
      <h2 className="section-title mb-2 text-amber-500 dark:text-amber-400">
        Ban User
      </h2>
      <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-3">
        Banned players are removed from the leaderboard and player
        picker, force-signed-out, and shown a banned message on
        login. Profile + match history is preserved; lift the ban
        below to restore.
      </p>

      {error && (
        <div className="text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/40 rounded-md px-3 py-2 mb-3">
          {error}
        </div>
      )}
      {success && (
        <div className="text-[10px] font-mono tracking-widest uppercase text-emerald-500 bg-emerald-500/5 border border-emerald-500/30 rounded-md px-3 py-2 mb-3">
          ✓ {success}
        </div>
      )}

      {target ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-lg border border-amber-400/40 dark:border-amber-500/30 bg-amber-500/5 px-3 py-2">
            <Avatar profile={target} />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-zinc-900 dark:text-zinc-100 truncate">
                {target.display_name}
              </div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">
                Selected
              </div>
            </div>
            <button
              type="button"
              onClick={() => setTarget(null)}
              className="text-[10px] font-display uppercase tracking-widest text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition"
            >
              Clear
            </button>
          </div>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional)"
            maxLength={200}
            className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400/40 transition"
          />
          <button
            type="button"
            onClick={ban}
            disabled={submitting}
            className="w-full rounded-lg border border-amber-400/60 dark:border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 font-display tracking-widest uppercase text-xs py-2 transition disabled:opacity-50"
          >
            {submitting ? 'Banning…' : `Ban ${target.display_name}`}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search a player to ban…"
            className="w-full px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400/40 transition"
          />
          {results.length > 0 && (
            <ul className="space-y-1 max-h-64 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800 p-1">
              {results.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setTarget(p)}
                    className="w-full flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 transition text-left"
                  >
                    <Avatar profile={p} size={32} />
                    <span className="flex-1 text-sm text-zinc-900 dark:text-zinc-100 truncate">
                      {p.display_name}
                    </span>
                    {p.is_admin && (
                      <span className="text-[9px] font-mono uppercase tracking-widest text-cyan2-500">
                        ADMIN
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {search.trim() && results.length === 0 && (
            <p className="text-[11px] text-zinc-500 dark:text-zinc-500 px-2 py-1">
              No matches.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Banned roster
// ---------------------------------------------------------------------------

function BannedRosterCard() {
  const [rows, setRows] = useState<ProfileLite[] | null>(null);
  const [unbanning, setUnbanning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    supabase
      .from('profiles')
      .select('id, display_name, avatar_url, is_admin, is_banned, banned_at, banned_reason')
      .eq('is_banned', true)
      .order('banned_at', { ascending: false })
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setError(formatError(error));
        else setRows((data ?? []) as ProfileLite[]);
      });
    return () => {
      active = false;
    };
  }, [version]);

  async function unban(id: string) {
    setUnbanning(id);
    setError(null);
    const { error } = await supabase.rpc('unban_user', { p_target_id: id });
    setUnbanning(null);
    if (error) {
      setError(formatError(error));
      return;
    }
    setVersion((v) => v + 1);
  }

  return (
    <section className="glass-panel p-5 border-zinc-300 dark:border-zinc-700 border-dashed">
      <div className="text-[10px] font-mono tracking-widest uppercase text-zinc-500 dark:text-zinc-400 mb-1">
        ▣ MODULE: BANNED-ROSTER
      </div>
      <h2 className="section-title mb-3">Banned Roster</h2>

      {error && (
        <div className="text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/40 rounded-md px-3 py-2 mb-3">
          {error}
        </div>
      )}

      {rows === null ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs font-mono tracking-widest uppercase text-zinc-500 dark:text-zinc-500">
          No active bans.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-3 rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-2"
            >
              <Avatar profile={p} />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-zinc-900 dark:text-zinc-100 truncate">
                  {p.display_name}
                </div>
                <div className="text-[10px] text-zinc-500 dark:text-zinc-500 truncate">
                  {p.banned_reason ?? 'No reason given'} ·{' '}
                  {p.banned_at ? formatDateTime(p.banned_at) : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => unban(p.id)}
                disabled={unbanning === p.id}
                className="text-[10px] font-display uppercase tracking-widest px-3 py-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 transition disabled:opacity-50"
              >
                {unbanning === p.id ? 'Lifting…' : 'Unban'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function Avatar({
  profile,
  size = 36,
}: {
  profile: ProfileLite;
  size?: number;
}) {
  const dim = `${size}px`;
  if (profile.avatar_url) {
    return (
      <img
        src={profile.avatar_url}
        alt=""
        className="rounded-full object-cover border border-zinc-200 dark:border-zinc-700 shrink-0"
        style={{ width: dim, height: dim }}
      />
    );
  }
  return (
    <div
      className="rounded-full bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 flex items-center justify-center font-semibold shrink-0"
      style={{ width: dim, height: dim }}
    >
      {profile.display_name?.[0]?.toUpperCase() ?? '?'}
    </div>
  );
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Offline support for two flows:
//   1) Roster cache  — every successful searchPlayers() result mirrors
//      into IndexedDB. If a future call fails (offline), the picker
//      reads the cache instead. So you can record matches in a gym
//      basement with no signal as long as you've loaded the picker
//      at least once on the network.
//   2) Match queue   — recordMatchOnlineOrQueue() wraps the insert.
//      Offline / network failure → the payload is persisted into the
//      queue and flushPendingMatches() retries when connectivity
//      returns (online event + AppShell mount).
//
// Raw IndexedDB API (no idb dep) — small enough to keep inline.

const DB_NAME = 'badminton-offline';
const DB_VERSION = 2;
const STORE_ROSTER = 'roster';
const STORE_QUEUE = 'match_queue';
const STORE_EDIT_QUEUE = 'match_edit_queue';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_ROSTER)) {
        db.createObjectStore(STORE_ROSTER, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        db.createObjectStore(STORE_QUEUE, {
          keyPath: 'id',
          autoIncrement: true,
        });
      }
      if (!db.objectStoreNames.contains(STORE_EDIT_QUEUE)) {
        // Keyed by match_id so a newer edit overwrites an older
        // queued edit for the same match.
        db.createObjectStore(STORE_EDIT_QUEUE, { keyPath: 'match_id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function txComplete(t: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('Transaction aborted'));
  });
}

// ---------------------------------------------------------------------------
// Roster cache
// ---------------------------------------------------------------------------

export interface CachedProfile {
  id: string;
  display_name: string;
  avatar_url: string | null;
}

export async function cacheRoster(profiles: CachedProfile[]): Promise<void> {
  if (profiles.length === 0) return;
  const db = await openDB();
  const t = db.transaction(STORE_ROSTER, 'readwrite');
  const s = t.objectStore(STORE_ROSTER);
  for (const p of profiles) {
    s.put({
      id: p.id,
      display_name: p.display_name,
      avatar_url: p.avatar_url,
    });
  }
  await txComplete(t);
}

export async function getCachedRoster(): Promise<CachedProfile[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE_ROSTER, 'readonly')
      .objectStore(STORE_ROSTER)
      .getAll();
    r.onsuccess = () => resolve((r.result ?? []) as CachedProfile[]);
    r.onerror = () => reject(r.error);
  });
}

// ---------------------------------------------------------------------------
// Match queue
// ---------------------------------------------------------------------------

export interface QueuedMatchInput {
  type: 'singles' | 'doubles';
  creatorId: string;
  partnerId: string | null;
  opponentIds: string[];
  scoreA: number;
  scoreB: number;
  // Snapshot at queue time so the eventual match.played_at reflects
  // when it was actually played, not when it eventually flushes.
  playedAt: string;
  // For UI hints in the queued banner. Not sent to the server.
  participantNames: string[];
  queuedAt: string;
}

export interface QueuedMatch extends QueuedMatchInput {
  id: number;
}

export async function queueMatch(input: QueuedMatchInput): Promise<void> {
  const db = await openDB();
  const t = db.transaction(STORE_QUEUE, 'readwrite');
  t.objectStore(STORE_QUEUE).add(input);
  await txComplete(t);
}

export async function getQueuedMatches(): Promise<QueuedMatch[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE_QUEUE, 'readonly')
      .objectStore(STORE_QUEUE)
      .getAll();
    r.onsuccess = () => resolve((r.result ?? []) as QueuedMatch[]);
    r.onerror = () => reject(r.error);
  });
}

export async function deleteQueuedMatch(id: number): Promise<void> {
  const db = await openDB();
  const t = db.transaction(STORE_QUEUE, 'readwrite');
  t.objectStore(STORE_QUEUE).delete(id);
  await txComplete(t);
}

// ---------------------------------------------------------------------------
// Match edit queue
// ---------------------------------------------------------------------------

export interface QueuedMatchEdit {
  match_id: string;
  partner_id: string | null;
  opponent_ids: string[];
  score_a: number;
  score_b: number;
  // Display names of all participants (creator + partner + opponents)
  // captured at queue time. Used by the Pending list to show the
  // edited lineup before the edit has flushed.
  participant_names: string[];
  queued_at: string;
}

// Newer edits overwrite older queued edits for the same match.
export async function queueMatchEdit(edit: QueuedMatchEdit): Promise<void> {
  const db = await openDB();
  const t = db.transaction(STORE_EDIT_QUEUE, 'readwrite');
  t.objectStore(STORE_EDIT_QUEUE).put(edit);
  await txComplete(t);
}

export async function getQueuedMatchEdits(): Promise<QueuedMatchEdit[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE_EDIT_QUEUE, 'readonly')
      .objectStore(STORE_EDIT_QUEUE)
      .getAll();
    r.onsuccess = () => resolve((r.result ?? []) as QueuedMatchEdit[]);
    r.onerror = () => reject(r.error);
  });
}

export async function getQueuedMatchEdit(
  matchId: string,
): Promise<QueuedMatchEdit | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE_EDIT_QUEUE, 'readonly')
      .objectStore(STORE_EDIT_QUEUE)
      .get(matchId);
    r.onsuccess = () => resolve((r.result ?? null) as QueuedMatchEdit | null);
    r.onerror = () => reject(r.error);
  });
}

export async function deleteQueuedMatchEdit(matchId: string): Promise<void> {
  const db = await openDB();
  const t = db.transaction(STORE_EDIT_QUEUE, 'readwrite');
  t.objectStore(STORE_EDIT_QUEUE).delete(matchId);
  await txComplete(t);
}

// ---------------------------------------------------------------------------
// Heuristics
// ---------------------------------------------------------------------------

export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

// Fetch failures from supabase-js typically surface as TypeError /
// "Failed to fetch" / "NetworkError when attempting to fetch".
export function looksLikeNetworkError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof TypeError) return true;
  const msg = (err as { message?: string }).message ?? '';
  return /failed to fetch|networkerror|network request failed|load failed/i.test(
    msg,
  );
}

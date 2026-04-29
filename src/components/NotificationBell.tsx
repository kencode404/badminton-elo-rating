// Pending-confirmation notification bell.
// Subscribes via Supabase Realtime to match_participants for the current user.
// Shows a popup when the user enters the app with pending items, or when a new
// invitation arrives while online.
//
// TODO: wire to AuthContext once auth pages are implemented. For now this is
// a visual stub that always shows a 0 badge.

export function NotificationBell() {
  const pendingCount = 0;
  return (
    <button
      type="button"
      aria-label={`${pendingCount} pending match confirmations`}
      className="relative rounded-lg w-9 h-9 flex items-center justify-center bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 hover:border-cyan2-400 transition active:scale-90"
    >
      <span aria-hidden className="text-base text-zinc-700 dark:text-zinc-200">✉</span>
      {pendingCount > 0 && (
        <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-cyan2-400 text-zinc-900 text-[10px] flex items-center justify-center font-bold">
          {pendingCount}
        </span>
      )}
    </button>
  );
}

export function HomePage() {
  return (
    <div className="p-4 space-y-4">
      <section className="rounded-xl bg-white dark:bg-court-900/40 shadow p-4">
        <h2 className="font-semibold text-lg mb-1">Welcome</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Track your singles and doubles ratings. Record matches, get them confirmed by all
          participants, and watch your rank move on the leaderboard.
        </p>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-court-700 text-white p-4">
          <div className="text-xs uppercase opacity-80">Singles rating</div>
          <div className="text-3xl font-bold mt-1">1200</div>
        </div>
        <div className="rounded-xl bg-court-900 text-white p-4">
          <div className="text-xs uppercase opacity-80">Doubles rating</div>
          <div className="text-3xl font-bold mt-1">1200</div>
        </div>
      </section>
    </div>
  );
}

export function HomePage() {
  return (
    <div className="p-4 space-y-4">
      <section className="glass-panel p-5 relative overflow-hidden">
        <div className="absolute -top-6 -right-6 text-7xl opacity-5 dark:opacity-10 select-none" aria-hidden>
          ◆
        </div>
        <h2 className="font-display tracking-[0.15em] text-base text-zinc-900 dark:text-zinc-100 mb-1">
          WELCOME, COMMANDER
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
          Track your singles & doubles ratings. Record matches, await all-player
          confirmation, and ascend the leaderboard.
        </p>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <div className="glass-panel p-4 panel-stripe pl-6">
          <div className="text-[10px] font-display uppercase tracking-wider text-cyan2-500 dark:text-cyan2-300">
            Singles
          </div>
          <div className="font-display text-3xl mt-1 text-zinc-900 dark:text-zinc-100">1200</div>
          <div className="text-[10px] text-zinc-500 dark:text-zinc-500 mt-1 tracking-wider uppercase">
            Rating
          </div>
        </div>
        <div className="glass-panel p-4 panel-stripe pl-6">
          <div className="text-[10px] font-display uppercase tracking-wider text-cyan2-500 dark:text-cyan2-300">
            Doubles
          </div>
          <div className="font-display text-3xl mt-1 text-zinc-900 dark:text-zinc-100">1200</div>
          <div className="text-[10px] text-zinc-500 dark:text-zinc-500 mt-1 tracking-wider uppercase">
            Rating
          </div>
        </div>
      </section>

      <section className="glass-panel p-5">
        <div className="section-title mb-4">Quick Action</div>
        <div className="grid grid-cols-2 gap-3">
          <button className="cosmic-button text-sm">
            <span aria-hidden>◈</span> Record
          </button>
          <button className="cosmic-button-ghost text-sm">
            <span aria-hidden>✦</span> Ranks
          </button>
        </div>
      </section>
    </div>
  );
}

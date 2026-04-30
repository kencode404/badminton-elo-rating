export function ShopPage() {
  return (
    <div className="p-4 space-y-4">
      <div className="section-title text-base">Shop</div>

      <section className="glass-panel p-7 text-center relative overflow-hidden">
        <div className="absolute -top-6 -right-6 text-7xl opacity-5 dark:opacity-10 select-none" aria-hidden>
          ✦
        </div>
        <div
          className="mx-auto w-16 h-16 rounded-2xl flex items-center justify-center text-2xl text-white border border-cyan2-400/40 mb-4"
          style={{
            background: 'linear-gradient(135deg, #18181b 0%, #27272a 100%)',
            boxShadow: '0 0 18px rgba(34, 211, 238, 0.4)',
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 7h14l-1 13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 7Z" />
            <path d="M9 7V5a3 3 0 0 1 6 0v2" />
          </svg>
        </div>

        <div className="text-[10px] font-display uppercase tracking-widest text-cyan2-500 dark:text-cyan2-300 mb-1">
          Coming Soon
        </div>
        <h2 className="font-display tracking-[0.15em] text-base text-zinc-900 dark:text-zinc-100 uppercase mb-2">
          Avatar Gear
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
          Earn frames, badges, and effects from match wins to dress up your profile.
          Stay tuned.
        </p>
      </section>

      <section className="glass-panel p-5">
        <div className="section-title mb-3">Planned</div>
        <ul className="space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
          <li className="flex items-start gap-2">
            <span className="text-cyan2-500 dark:text-cyan2-300 mt-0.5">◆</span>
            Profile frames unlocked by rating tiers
          </li>
          <li className="flex items-start gap-2">
            <span className="text-cyan2-500 dark:text-cyan2-300 mt-0.5">◆</span>
            Badges for milestones (10 wins, doubles streak, etc.)
          </li>
          <li className="flex items-start gap-2">
            <span className="text-cyan2-500 dark:text-cyan2-300 mt-0.5">◆</span>
            Animated effects on the leaderboard for top players
          </li>
        </ul>
      </section>
    </div>
  );
}

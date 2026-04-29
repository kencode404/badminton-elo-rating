export function RecordMatchPage() {
  return (
    <div className="p-4 space-y-4">
      <div className="section-title text-base">Record Match</div>

      <section className="glass-panel p-5">
        <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
          Match recording form goes here. After submission, all participants must confirm
          before the result is finalized and ratings update.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-[11px] font-display uppercase tracking-wider bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700">
            <span aria-hidden className="text-cyan2-500 dark:text-cyan2-300">◆</span> Singles
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-[11px] font-display uppercase tracking-wider bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700">
            <span aria-hidden className="text-cyan2-500 dark:text-cyan2-300">◈</span> Doubles
          </span>
        </div>
      </section>

      <button className="cosmic-button w-full" disabled>
        <span aria-hidden>◈</span> Coming Soon
      </button>
    </div>
  );
}

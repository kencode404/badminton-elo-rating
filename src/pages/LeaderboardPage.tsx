import { useState } from 'react';

type Tab = 'singles' | 'doubles';

export function LeaderboardPage() {
  const [tab, setTab] = useState<Tab>('singles');

  return (
    <div className="p-4 space-y-4">
      <div className="section-title text-base mb-1">Leaderboard</div>

      <div className="flex glass-panel p-1">
        {(['singles', 'doubles'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-lg text-xs font-display tracking-wider uppercase transition ${
              tab === t
                ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                : 'text-zinc-500 dark:text-zinc-400'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <ol className="space-y-2">
        <li className="glass-panel p-6 text-center">
          <div className="text-3xl mb-2 text-cyan2-400" aria-hidden>
            ✦
          </div>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            No combatants registered. Once members sign up, rankings will appear here.
          </p>
        </li>
      </ol>
    </div>
  );
}

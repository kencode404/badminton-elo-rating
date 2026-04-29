import { useState } from 'react';

type Tab = 'singles' | 'doubles';

export function LeaderboardPage() {
  const [tab, setTab] = useState<Tab>('singles');

  return (
    <div className="p-4 space-y-4">
      <div className="flex rounded-full bg-court-100 dark:bg-court-900/50 p-1">
        {(['singles', 'doubles'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-full text-sm font-medium capitalize transition ${
              tab === t
                ? 'bg-court-700 text-white'
                : 'text-court-700 dark:text-court-100'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <ol className="space-y-2">
        <li className="rounded-lg bg-white dark:bg-court-900/40 p-3 text-sm text-gray-500">
          Leaderboard entries will appear here once players are registered.
        </li>
      </ol>
    </div>
  );
}

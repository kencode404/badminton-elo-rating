import { ClubChat } from '../components/ClubChat';

export function HomePage() {
  return (
    <div className="p-4 space-y-4">
      <section className="glass-panel p-5 relative overflow-hidden">
        <div className="absolute -top-6 -right-6 text-7xl opacity-5 dark:opacity-10 select-none" aria-hidden>
          ◆
        </div>
        <h2 className="font-display tracking-[0.15em] text-base text-zinc-900 dark:text-zinc-100 mb-1">
          WELCOME, PLAYER
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
          Track your singles & doubles ratings. Record matches, await all-player
          confirmation, and ascend the leaderboard.
        </p>
      </section>

      <ClubChat />
    </div>
  );
}

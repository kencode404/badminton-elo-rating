import { Link } from 'react-router-dom';

export function ScoringGuidePage() {
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="section-title text-base">Scoring Guide</div>
        <Link
          to="/profile"
          className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-cyan2-500 transition uppercase tracking-widest font-display"
        >
          ← Back
        </Link>
      </div>

      <section className="glass-panel p-5">
        <h2 className="font-display tracking-[0.15em] text-sm text-zinc-900 dark:text-zinc-100 uppercase mb-2">
          What's a rating?
        </h2>
        <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
          A number that measures your skill. The higher it is, the stronger you
          are compared to other players. Win more often than expected → it goes
          up. Lose more than expected → it drops.
        </p>
        <ul className="mt-3 space-y-1.5 text-sm text-zinc-700 dark:text-zinc-300">
          <li className="flex items-start gap-2">
            <span className="text-cyan2-500 dark:text-cyan2-300 mt-0.5">◆</span>
            Everyone starts at <strong>1200</strong>.
          </li>
          <li className="flex items-start gap-2">
            <span className="text-cyan2-500 dark:text-cyan2-300 mt-0.5">◆</span>
            Singles and doubles ratings are <strong>completely separate</strong>. A great singles player can be average at doubles.
          </li>
        </ul>
      </section>

      <section className="glass-panel p-5">
        <h2 className="font-display tracking-[0.15em] text-sm text-zinc-900 dark:text-zinc-100 uppercase mb-2">
          How a match changes your rating
        </h2>
        <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed mb-3">
          Before the match, the system predicts how likely each side is to win
          based on the rating gap.
        </p>
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 space-y-2">
          <div className="flex items-start gap-3">
            <span className="text-emerald-500 mt-0.5">↑</span>
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              <strong>You win when you weren't expected to</strong> → big gain.
            </p>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-zinc-500 mt-0.5">→</span>
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              <strong>You win when you were expected to</strong> → small gain.
            </p>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-red-400 mt-0.5">↓</span>
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              <strong>You lose to a much weaker opponent</strong> → big drop.
            </p>
          </div>
        </div>
      </section>

      <section className="glass-panel p-5">
        <h2 className="font-display tracking-[0.15em] text-sm text-zinc-900 dark:text-zinc-100 uppercase mb-2">
          Score margin matters
        </h2>
        <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed mb-3">
          A bigger win earns the winner more rating. <strong>The loser's drop
          is the same regardless of margin</strong> — close games and blowouts
          punish the loser identically. So go all out to win by a lot.
        </p>
        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-zinc-500 dark:text-zinc-500 border-b border-zinc-200 dark:border-zinc-800">
                <th className="text-left font-display uppercase tracking-widest text-[10px] px-2 py-1.5">
                  Score
                </th>
                <th className="text-right font-display uppercase tracking-widest text-[10px] px-2 py-1.5">
                  Winner
                </th>
                <th className="text-right font-display uppercase tracking-widest text-[10px] px-2 py-1.5">
                  Loser
                </th>
              </tr>
            </thead>
            <tbody className="text-zinc-700 dark:text-zinc-300 font-display">
              <tr className="border-b border-zinc-200/50 dark:border-zinc-800/50">
                <td className="px-2 py-1.5">21–19</td>
                <td className="px-2 py-1.5 text-right text-emerald-600 dark:text-emerald-400">+12</td>
                <td className="px-2 py-1.5 text-right text-red-500 dark:text-red-400">−12</td>
              </tr>
              <tr className="border-b border-zinc-200/50 dark:border-zinc-800/50">
                <td className="px-2 py-1.5">21–15</td>
                <td className="px-2 py-1.5 text-right text-emerald-600 dark:text-emerald-400">+14</td>
                <td className="px-2 py-1.5 text-right text-red-500 dark:text-red-400">−12</td>
              </tr>
              <tr className="border-b border-zinc-200/50 dark:border-zinc-800/50">
                <td className="px-2 py-1.5">21–10</td>
                <td className="px-2 py-1.5 text-right text-emerald-600 dark:text-emerald-400">+17</td>
                <td className="px-2 py-1.5 text-right text-red-500 dark:text-red-400">−12</td>
              </tr>
              <tr>
                <td className="px-2 py-1.5">21–2</td>
                <td className="px-2 py-1.5 text-right text-emerald-600 dark:text-emerald-400">+22</td>
                <td className="px-2 py-1.5 text-right text-red-500 dark:text-red-400">−12</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-500 mt-2">
          Numbers shown for two evenly-rated players. Real values depend on the rating gap.
        </p>
      </section>

      <section className="glass-panel p-5">
        <h2 className="font-display tracking-[0.15em] text-sm text-zinc-900 dark:text-zinc-100 uppercase mb-2">
          Your first 10 games
        </h2>
        <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
          Brand-new players are <strong>provisional</strong> for their first 10
          games (per mode). During this time your rating moves about{' '}
          <strong>1.7× faster</strong> in either direction. This lets the system
          find your real level quickly instead of leaving you stuck at 1200.
        </p>
      </section>

      <section className="glass-panel p-5">
        <h2 className="font-display tracking-[0.15em] text-sm text-zinc-900 dark:text-zinc-100 uppercase mb-2">
          Doubles
        </h2>
        <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
          Your team's strength is the <strong>average</strong> of you and your
          partner's doubles ratings. Both partners gain or lose the same amount
          for that match. You can lift a weaker partner's rating quickly — and
          they can drag you down too.
        </p>
      </section>

      <section className="glass-panel p-5">
        <h2 className="font-display tracking-[0.15em] text-sm text-zinc-900 dark:text-zinc-100 uppercase mb-2">
          Confirmation rules
        </h2>
        <ul className="space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
          <li className="flex items-start gap-2">
            <span className="text-cyan2-500 dark:text-cyan2-300 mt-0.5">◆</span>
            When someone records a match, all other players must accept it
            before ratings update.
          </li>
          <li className="flex items-start gap-2">
            <span className="text-cyan2-500 dark:text-cyan2-300 mt-0.5">◆</span>
            If anyone rejects, the match is dropped and no ratings change.
          </li>
          <li className="flex items-start gap-2">
            <span className="text-cyan2-500 dark:text-cyan2-300 mt-0.5">◆</span>
            Pending matches expire after <strong>7 days</strong> if not all confirmed.
          </li>
        </ul>
      </section>
    </div>
  );
}

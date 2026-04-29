import { NavLink, Outlet } from 'react-router-dom';
import { ThemeToggle } from './ThemeToggle';
import { NotificationBell } from './NotificationBell';

const navItems = [
  { to: '/', label: 'Home', glyph: '◆' },
  { to: '/leaderboard', label: 'Ranks', glyph: '✦' },
  { to: '/record', label: 'Record', glyph: '◈' },
  { to: '/profile', label: 'Profile', glyph: '✧' },
];

export function AppShell() {
  return (
    <div className="min-h-dvh flex flex-col cosmic-bg starfield">
      <header className="sticky top-0 z-10 px-4 py-3 bg-white/80 dark:bg-[#0a0a0c]/85 backdrop-blur-sm border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center justify-between">
          <h1 className="font-display tracking-[0.2em] text-base flex items-center gap-2 text-zinc-900 dark:text-zinc-100">
            <span aria-hidden className="text-cyan2-500 dark:text-cyan2-300">◆</span>
            <span>BADMINTON ELO</span>
          </h1>
          <div className="flex items-center gap-1">
            <NotificationBell />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex-1 pb-24 relative z-0">
        <Outlet />
      </main>

      <nav
        className="fixed bottom-3 inset-x-3 grid grid-cols-4 glass-panel overflow-hidden"
        aria-label="Bottom navigation"
      >
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `relative flex flex-col items-center justify-center py-2.5 text-[11px] font-semibold tracking-wide transition ${
                isActive
                  ? 'text-cyan2-500 dark:text-cyan2-300'
                  : 'text-zinc-500 dark:text-zinc-400'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span
                    className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-cyan2-400"
                    style={{ boxShadow: '0 0 8px rgba(34, 211, 238, 0.7)' }}
                    aria-hidden
                  />
                )}
                <span
                  className={`text-lg mb-0.5 ${isActive ? 'text-cyan2-400' : ''}`}
                  aria-hidden
                >
                  {item.glyph}
                </span>
                <span className="uppercase text-[10px]">{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

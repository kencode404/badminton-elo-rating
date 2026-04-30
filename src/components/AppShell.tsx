import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { ThemeToggle } from './ThemeToggle';
import { NotificationBell } from './NotificationBell';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
}

const navItems: NavItem[] = [
  { to: '/', label: 'Home', icon: <HomeIcon /> },
  { to: '/leaderboard', label: 'Ranks', icon: <span className="text-lg leading-none">✦</span> },
  { to: '/record', label: 'Record', icon: <span className="text-lg leading-none">◈</span> },
  { to: '/profile', label: 'Profile', icon: <UserIcon /> },
];

export function AppShell() {
  return (
    <div className="min-h-dvh flex flex-col cosmic-bg starfield">
      <header
        className="sticky top-0 z-10 px-4 pb-3 bg-white/80 dark:bg-[#0a0a0c]/85 backdrop-blur-sm border-b border-zinc-200 dark:border-zinc-800"
        style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }}
      >
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
        className="fixed inset-x-3 grid grid-cols-4 glass-panel overflow-hidden"
        style={{ bottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
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
                  className={`mb-0.5 flex items-center justify-center h-5 ${
                    isActive ? 'text-cyan2-400' : ''
                  }`}
                  aria-hidden
                >
                  {item.icon}
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

function HomeIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5 10v9.5a.5.5 0 0 0 .5.5h13a.5.5 0 0 0 .5-.5V10" />
      <path d="M10 20v-5a2 2 0 0 1 2-2 2 2 0 0 1 2 2v5" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 20.5v-1a5.5 5.5 0 0 1 5.5-5.5h4a5.5 5.5 0 0 1 5.5 5.5v1" />
    </svg>
  );
}

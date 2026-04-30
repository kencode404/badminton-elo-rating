import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { ThemeToggle } from './ThemeToggle';
import { NotificationBell } from './NotificationBell';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
}

const sideNav: NavItem[] = [
  { to: '/', label: 'Home', icon: <HomeIcon /> },
  { to: '/leaderboard', label: 'Ranks', icon: <RanksIcon /> },
];

const sideNavRight: NavItem[] = [
  { to: '/shop', label: 'Shop', icon: <ShopIcon /> },
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

      <main className="flex-1 pb-28 relative z-0">
        <Outlet />
      </main>

      <nav
        className="fixed inset-x-3 grid grid-cols-5 glass-panel"
        style={{
          bottom: 'calc(0.75rem + env(safe-area-inset-bottom))',
          overflow: 'visible',
        }}
        aria-label="Bottom navigation"
      >
        {sideNav.map((item) => (
          <FlatTab key={item.to} item={item} />
        ))}
        <CenterMatchTab />
        {sideNavRight.map((item) => (
          <FlatTab key={item.to} item={item} />
        ))}
      </nav>
    </div>
  );
}

function FlatTab({ item }: { item: NavItem }) {
  return (
    <NavLink
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
  );
}

function CenterMatchTab() {
  return (
    <NavLink
      to="/record"
      className={({ isActive }) =>
        `relative flex flex-col items-center justify-end py-2.5 text-[11px] font-semibold tracking-wide ${
          isActive
            ? 'text-cyan2-500 dark:text-cyan2-300'
            : 'text-zinc-500 dark:text-zinc-400'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <span
            className="absolute left-1/2 -translate-x-1/2 -top-6 w-14 h-14 rounded-full flex items-center justify-center text-white border transition active:scale-95"
            style={{
              background: 'linear-gradient(135deg, #18181b 0%, #27272a 100%)',
              borderColor: isActive ? 'rgba(103, 232, 249, 0.9)' : 'rgba(34, 211, 238, 0.45)',
              boxShadow: isActive
                ? '0 0 22px rgba(34, 211, 238, 0.7)'
                : '0 0 14px rgba(34, 211, 238, 0.4)',
            }}
            aria-hidden
          >
            <MatchIcon />
          </span>
          <span className="uppercase text-[10px] mt-1">Match</span>
        </>
      )}
    </NavLink>
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

function RanksIcon() {
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
      <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" />
      <path d="M17 5h2a2 2 0 0 1-2 4" />
      <path d="M7 5H5a2 2 0 0 0 2 4" />
      <path d="M9 14v2a3 3 0 0 1-3 3" />
      <path d="M15 14v2a3 3 0 0 0 3 3" />
      <path d="M6 20h12" />
    </svg>
  );
}

function MatchIcon() {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {/* shuttlecock shaft (cork → feather end) on a smash diagonal */}
      <path d="M17 7 L10.5 13.5" />
      {/* feather flare: V opening behind the shaft */}
      <path d="M8.5 11.5 L10.5 13.5 L12.5 15.5" />
      <path d="M7.5 14.5 L10.5 13.5 L9.5 16.5" />
      {/* cork (heavy hitting end) */}
      <circle cx="17" cy="7" r="1.9" fill="currentColor" stroke="none" />
      {/* motion / speed lines trailing the smash */}
      <path d="M3 20 L5.5 17.5" />
      <path d="M2.5 16 L4 14.5" />
      <path d="M5 21.5 L6.5 20" />
    </svg>
  );
}

function ShopIcon() {
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
      <path d="M5 7h14l-1 13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 7Z" />
      <path d="M9 7V5a3 3 0 0 1 6 0v2" />
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

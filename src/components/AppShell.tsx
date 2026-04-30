import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { ThemeToggle } from './ThemeToggle';
import { NotificationBell } from './NotificationBell';
import { useChatUnread } from '../lib/chat';

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
  // Call useChatUnread once at the shell level — calling it inside each
  // FlatTab would create multiple Realtime channels with the same name
  // and Supabase rejects the duplicate subscriptions.
  const chatUnread = useChatUnread();

  return (
    <div className="min-h-dvh flex flex-col cosmic-bg starfield">
      <header
        className="sticky top-0 z-10 px-4 pb-3 bg-white/80 dark:bg-[#0a0a0c]/85 backdrop-blur-sm border-b border-zinc-200 dark:border-zinc-800"
        style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }}
      >
        <div className="flex items-center justify-between">
          <h1 className="font-display tracking-[0.2em] text-base flex items-center gap-2 text-zinc-900 dark:text-zinc-100">
            <img
              src="/shuttlecock.png"
              alt=""
              width={22}
              height={22}
              className="dark:invert"
              aria-hidden
            />
            <span>BADMINTON ELO</span>
          </h1>
          <div className="flex items-center gap-1">
            <NotificationBell />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main
        className="flex-1 relative z-0"
        style={{ paddingBottom: 'calc(7.5rem + env(safe-area-inset-bottom))' }}
      >
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
          <FlatTab key={item.to} item={item} unreadCount={item.to === '/' ? chatUnread : 0} />
        ))}
        <CenterMatchTab />
        {sideNavRight.map((item) => (
          <FlatTab key={item.to} item={item} unreadCount={item.to === '/' ? chatUnread : 0} />
        ))}
      </nav>
    </div>
  );
}

function FlatTab({ item, unreadCount }: { item: NavItem; unreadCount: number }) {
  const showHomeBadge = unreadCount > 0;
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
            className={`mb-0.5 flex items-center justify-center h-5 relative ${
              isActive ? 'text-cyan2-400' : ''
            }`}
            aria-hidden
          >
            {item.icon}
            {showHomeBadge && (
              <span
                className="absolute -top-1 -right-2 min-w-[14px] h-[14px] px-1 rounded-full bg-cyan2-400 text-zinc-900 text-[9px] flex items-center justify-center font-bold"
                style={{ boxShadow: '0 0 6px rgba(34, 211, 238, 0.7)' }}
              >
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </span>
          <span className="uppercase text-[10px]">{item.label}</span>
        </>
      )}
    </NavLink>
  );
}

function CenterMatchTab() {
  // Rounder 16-spike comic burst (less jagged variation than before).
  // Outer radius 50%, inner radius 40%.
  const burstClip =
    'polygon(50% 0%, 58% 11%, 69% 4%, 72% 17%, 85% 15%, 83% 28%, 96% 31%, 89% 42%, 100% 50%, 89% 58%, 96% 69%, 83% 72%, 85% 85%, 72% 83%, 69% 96%, 58% 89%, 50% 100%, 42% 89%, 31% 96%, 28% 83%, 15% 85%, 17% 72%, 4% 69%, 11% 58%, 0% 50%, 11% 42%, 4% 31%, 17% 28%, 15% 15%, 28% 17%, 31% 4%, 42% 11%)';
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
            className="absolute left-1/2 -translate-x-1/2 -top-9 w-[76px] h-[76px] transition active:scale-95"
            style={{
              filter: isActive
                ? 'drop-shadow(0 0 14px rgba(34,211,238,0.9)) drop-shadow(0 0 4px rgba(34,211,238,0.7))'
                : 'drop-shadow(0 0 10px rgba(34,211,238,0.55)) drop-shadow(0 0 3px rgba(34,211,238,0.5))',
            }}
            aria-hidden
          >
            {/* cyan outer 'stroke' — the burst silhouette in cyan */}
            <span
              className="absolute inset-0"
              style={{
                clipPath: burstClip,
                background: isActive ? '#67e8f9' : '#22d3ee',
              }}
            />
            {/* dark fill, slightly inset to leave a thin cyan rim */}
            <span
              className="absolute inset-[2px]"
              style={{
                clipPath: burstClip,
                background: 'linear-gradient(135deg, #0f0f12 0%, #27272a 100%)',
              }}
            />
            {/* SMASH! text — on top of both, NOT clipped, fully visible */}
            <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span
                className="font-display italic font-black tracking-tight leading-none text-cyan2-300 select-none"
                style={{
                  fontSize: '13px',
                  textShadow:
                    '0 0 6px rgba(34,211,238,0.7), 0 1px 0 rgba(0,0,0,0.6)',
                  transform: 'rotate(-6deg)',
                }}
              >
                SMASH!
              </span>
            </span>
          </span>
          <span className="relative z-10 uppercase text-[10px] mt-1">Match</span>
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

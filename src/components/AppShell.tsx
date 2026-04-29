import { NavLink, Outlet } from 'react-router-dom';
import { ThemeToggle } from './ThemeToggle';
import { NotificationBell } from './NotificationBell';

const navItems = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/leaderboard', label: 'Ranks', icon: 'trophy' },
  { to: '/record', label: 'Record', icon: 'plus' },
  { to: '/profile', label: 'Profile', icon: 'user' },
];

export function AppShell() {
  return (
    <div className="min-h-dvh flex flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 bg-court-700 dark:bg-court-900 text-white shadow-md">
        <h1 className="font-bold tracking-wide">Badminton ELO</h1>
        <div className="flex items-center gap-2">
          <NotificationBell />
          <ThemeToggle />
        </div>
      </header>

      <main className="flex-1 court-bg pb-20">
        <Outlet />
      </main>

      <nav className="fixed bottom-0 inset-x-0 grid grid-cols-4 border-t border-court-200 dark:border-court-800 bg-white/90 dark:bg-shuttle-dark/90 backdrop-blur">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center py-3 text-xs ${
                isActive
                  ? 'text-court-700 dark:text-court-500 font-semibold'
                  : 'text-gray-500 dark:text-gray-400'
              }`
            }
          >
            <span className="text-lg" aria-hidden>
              {iconFor(item.icon)}
            </span>
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function iconFor(name: string): string {
  switch (name) {
    case 'home':
      return '\u{1F3E0}';
    case 'trophy':
      return '\u{1F3C6}';
    case 'plus':
      return '➕';
    case 'user':
      return '\u{1F464}';
    default:
      return '';
  }
}

import { useTheme } from './ThemeProvider';

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
      className="rounded-lg w-9 h-9 flex items-center justify-center bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 hover:border-cyan2-400 transition active:scale-90"
    >
      <span aria-hidden className="text-base text-zinc-700 dark:text-zinc-200">
        {theme === 'light' ? '\u{263E}' : '\u{2600}'}
      </span>
    </button>
  );
}

import { useTheme } from './ThemeProvider';

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
      className="rounded-full px-2 py-1 text-sm hover:bg-white/10 transition"
    >
      {theme === 'light' ? '\u{1F311}' : '☀️'}
    </button>
  );
}

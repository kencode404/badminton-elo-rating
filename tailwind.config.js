/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        court: {
          50: '#f0fdf4',
          100: '#dcfce7',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
          900: '#14532d',
          950: '#052e16',
        },
        shuttle: {
          light: '#f8fafc',
          dark: '#0f172a',
        },
      },
      animation: {
        'shuttle-spin': 'shuttle-spin 1.5s linear infinite',
        'shuttle-arc': 'shuttle-arc 1.2s ease-in-out',
      },
      keyframes: {
        'shuttle-spin': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        'shuttle-arc': {
          '0%': { transform: 'translate(-100%, 50%) rotate(0deg)' },
          '50%': { transform: 'translate(0, -80%) rotate(180deg)' },
          '100%': { transform: 'translate(100%, 50%) rotate(360deg)' },
        },
      },
    },
  },
  plugins: [],
};

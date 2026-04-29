/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Quicksand', 'system-ui', 'sans-serif'],
        display: ['Orbitron', 'Quicksand', 'sans-serif'],
      },
      colors: {
        cyan2: {
          100: '#cffafe',
          200: '#a5f3fc',
          300: '#67e8f9',
          400: '#22d3ee',
          500: '#06b6d4',
          600: '#0891b2',
        },
        periwinkle: {
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
        },
        cosmic: {
          50: '#eef2ff',
          100: '#e0e7ff',
          400: '#6366f1',
          700: '#3730a3',
          800: '#1e1b4b',
          900: '#0c0a36',
          950: '#05031f',
        },
        nebula: {
          violet: '#7c3aed',
          rose: '#be185d',
          azure: '#0ea5e9',
          teal: '#0d9488',
        },
      },
      boxShadow: {
        'glow-cyan': '0 0 20px rgba(34, 211, 238, 0.55), 0 0 40px rgba(34, 211, 238, 0.25)',
        'glow-cyan-soft': '0 0 12px rgba(103, 232, 249, 0.45)',
        'glow-violet': '0 0 24px rgba(129, 140, 248, 0.5)',
        glass: '0 8px 32px -8px rgba(12, 10, 54, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
        'glass-light': '0 8px 24px -8px rgba(99, 102, 241, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.6)',
      },
      backgroundImage: {
        'cosmic-button': 'linear-gradient(135deg, #06b6d4 0%, #6366f1 100%)',
        'cosmic-button-soft': 'linear-gradient(135deg, #67e8f9 0%, #a5b4fc 100%)',
      },
      animation: {
        twinkle: 'twinkle 2.4s ease-in-out infinite',
        'twinkle-slow': 'twinkle 3.6s ease-in-out infinite',
        float: 'float 4s ease-in-out infinite',
        'float-slow': 'float 6s ease-in-out infinite',
        'pulse-glow': 'pulseGlow 2.5s ease-in-out infinite',
        'pop-in': 'pop-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
        'border-shimmer': 'borderShimmer 6s linear infinite',
      },
      keyframes: {
        twinkle: {
          '0%, 100%': { opacity: '0.35', transform: 'scale(0.85)' },
          '50%': { opacity: '1', transform: 'scale(1.1)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 12px rgba(34, 211, 238, 0.4)' },
          '50%': { boxShadow: '0 0 24px rgba(34, 211, 238, 0.7)' },
        },
        'pop-in': {
          '0%': { transform: 'scale(0.92) translateY(8px)', opacity: '0' },
          '100%': { transform: 'scale(1) translateY(0)', opacity: '1' },
        },
        borderShimmer: {
          '0%, 100%': { borderColor: 'rgba(34, 211, 238, 0.45)' },
          '50%': { borderColor: 'rgba(129, 140, 248, 0.65)' },
        },
      },
    },
  },
  plugins: [],
};

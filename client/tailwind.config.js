/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'], mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'] },
      colors: {
        ink: { 950: '#070b14', 900: '#0b1220', 850: '#0f172a', 800: '#131c2e', 700: '#1c2740', 600: '#2a3756', 500: '#3b4a6b' },
        alarm: { DEFAULT: '#ef4444', soft: '#fecaca' },
      },
      keyframes: {
        pulseRing: { '0%': { boxShadow: '0 0 0 0 rgba(239,68,68,.55)' }, '100%': { boxShadow: '0 0 0 14px rgba(239,68,68,0)' } },
        slideIn: { '0%': { opacity: 0, transform: 'translateY(-6px)' }, '100%': { opacity: 1, transform: 'none' } },
      },
      animation: { pulseRing: 'pulseRing 1.4s ease-out infinite', slideIn: 'slideIn .25s ease-out' },
    },
  },
  plugins: [],
};

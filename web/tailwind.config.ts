import type { Config } from 'tailwindcss';

// Carry the existing VSHORT cinematic tokens into Tailwind so the SPA stays
// on-brand: deep-black canvas, three per-context accents, Inter.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#06060a',
        surface: '#0c0c12',
        ink: '#eeeef5',
        muted: 'rgba(238,238,245,0.55)',
        line: 'rgba(255,255,255,0.08)',
        scripts: '#00d4ff',
        story: '#b400ff',
        vshort: '#ff5c2b',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      borderRadius: { xl2: '14px' },
      keyframes: {
        'fade-up': { '0%': { opacity: '0', transform: 'translateY(10px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        'pulse-ring': { '0%,100%': { boxShadow: '0 0 0 0 rgba(255,92,43,0.5)' }, '50%': { boxShadow: '0 0 0 8px rgba(255,92,43,0)' } },
      },
      animation: {
        'fade-up': 'fade-up .5s cubic-bezier(.22,1,.36,1) both',
        'pulse-ring': 'pulse-ring 2.4s ease-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;

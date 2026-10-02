/**
 * -----------------------------------------------------------------------------
 *  tailwind.config.js — the Gramrosh design system
 * -----------------------------------------------------------------------------
 *  Mobile-first, zero-waste: every colour the UI uses is declared here so no
 *  one-off hex values leak into components (and so dark-mode/white-label
 *  re-theming is a single file change).
 *
 *  `leaf`  — the organic green (primary actions, trust)
 *  `honey` — the harvest amber (price, sale, accents)
 *  `soil`  — warm neutrals for text and surfaces (never pure #000 on cream)
 * -----------------------------------------------------------------------------
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        leaf: {
          50: '#f2f9f1',
          100: '#e0f1de',
          200: '#c2e3c0',
          300: '#93cd93',
          400: '#5fae62',
          500: '#3d9142',
          600: '#2c7432',
          700: '#255c2a',
          800: '#204a24',
          900: '#1b3d1f',
          950: '#0c210f',
        },
        honey: {
          50: '#fdf9ed',
          100: '#faf0cc',
          200: '#f4de94',
          300: '#edc55c',
          400: '#e7ac35',
          500: '#de9220',
          600: '#c57119',
          700: '#a45218',
          800: '#86411a',
          900: '#6e3618',
          950: '#3f1b0a',
        },
        soil: {
          50: '#faf8f5',
          100: '#f2ede6',
          200: '#e3d9cc',
          300: '#d0bfab',
          400: '#bba088',
          500: '#ab886e',
          600: '#9e7160',
          700: '#835b50',
          800: '#6c4a44',
          900: '#583e39',
          950: '#30201e',
        },
        cream: '#fffdf8',
      },
      fontFamily: {
        // System stacks only — no web-font round trip, which is the single
        // biggest mobile latency win for a BD audience on 3G.
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'Noto Sans', 'sans-serif'],
        // Bengali needs its own stack: Noto Sans Bengali ships with Android and
        // falls back to the OS Bangla font elsewhere.
        bangla: ['"Noto Sans Bengali"', '"Hind Siliguri"', 'Bangla', 'Kalpurush', 'sans-serif'],
        display: ['Georgia', '"Times New Roman"', 'serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(48, 32, 30, 0.04), 0 8px 24px -12px rgba(48, 32, 30, 0.16)',
        drawer: '-8px 0 40px -12px rgba(48, 32, 30, 0.28)',
        pop: '0 12px 40px -8px rgba(48, 32, 30, 0.3)',
      },
      keyframes: {
        'slide-in-right': { from: { transform: 'translateX(100%)' }, to: { transform: 'translateX(0)' } },
        'fade-in': { from: { opacity: 0 }, to: { opacity: 1 } },
        'rise-in': { from: { opacity: 0, transform: 'translateY(8px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
        'pulse-soft': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.55 } },
        marquee: { from: { transform: 'translateX(0)' }, to: { transform: 'translateX(-50%)' } },
      },
      animation: {
        'slide-in-right': 'slide-in-right 260ms cubic-bezier(0.32, 0.72, 0, 1)',
        'fade-in': 'fade-in 180ms ease-out',
        'rise-in': 'rise-in 260ms ease-out',
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
        marquee: 'marquee 28s linear infinite',
      },
      // Sticky header (64px) + announcement bar; used for scroll-margin on
      // anchor targets so nothing hides behind them.
      spacing: { header: '4rem' },
    },
  },
  plugins: [],
};

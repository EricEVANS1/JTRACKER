// Colours come from CSS variables (src/theme/colors.css) so one set of class
// names serves both themes: the variables switch when <html> has .dark.
const PALETTES = ['slate', 'gray', 'zinc', 'red', 'orange', 'amber', 'yellow', 'green', 'emerald', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'rose'];
const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];
const themedColors = Object.fromEntries(
  PALETTES.map((palette) => [
    palette,
    Object.fromEntries(SHADES.map((shade) => [shade, `rgb(var(--jt-${palette}-${shade}) / <alpha-value>)`])),
  ]),
);

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ...themedColors,
        white: 'rgb(var(--jt-white) / <alpha-value>)',
        // Brand colours from the icon system; the same in both themes.
        brand: {
          ink: '#10172D',
          navy: '#141C31',
          tile: '#202D64',
          violet: '#7768F6',
          mint: '#6AF0C2',
        },
      },
      // Dashboard loading states, and the offer-received celebration
      // (src/components/OfferCelebration.tsx).
      keyframes: {
        // Dashboard loading states.
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        // A segment sliding across: work in progress, with no claim of how much is done.
        'indeterminate': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(250%)' },
        },
        'offer-fade': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'offer-pop': {
          '0%': { opacity: '0', transform: 'translateY(12px) scale(0.94)' },
          '60%': { opacity: '1', transform: 'translateY(0) scale(1.02)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'offer-glow': {
          '0%': { transform: 'scale(0.8)', opacity: '0.7' },
          '100%': { transform: 'scale(1.9)', opacity: '0' },
        },
        // Each piece flies out along --offer-x/--offer-y and spins by --offer-r.
        'offer-confetti': {
          '0%': { opacity: '0', transform: 'translate(0, 0) rotate(0deg) scale(0.6)' },
          '12%': { opacity: '1' },
          '100%': {
            opacity: '0',
            transform: 'translate(var(--offer-x), var(--offer-y)) rotate(var(--offer-r)) scale(1)',
          },
        },
      },
      animation: {
        'fade-in': 'fade-in 250ms ease-out both',
        'indeterminate': 'indeterminate 1.2s ease-in-out infinite',
        'offer-fade': 'offer-fade 200ms ease-out both',
        'offer-pop': 'offer-pop 420ms cubic-bezier(0.2, 0.9, 0.3, 1.2) both',
        'offer-glow': 'offer-glow 1.4s ease-out 2 both',
        'offer-confetti': 'offer-confetti 1.3s cubic-bezier(0.15, 0.6, 0.35, 1) both',
      },
    },
  },
  plugins: [],
}
